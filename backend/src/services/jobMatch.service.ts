import { env } from '../config/env';
import mongoose from 'mongoose';
import { ApiError } from '../middleware/errors';
import { Job, JobDoc } from '../models/Job';
import { Resume, ResumeDoc } from '../models/Resume';
import { SavedJob } from '../models/SavedJob';
import { User } from '../models/User';
import { AiEngineError, engineFetch } from './aiEngine';
import { listSourceStatus, SourceStatus } from './jobDiscovery.service';

/**
 * Candidate-facing matching.
 *
 * The weighted score itself is produced by the deterministic local engine
 * (`/jobs/match`); this service assembles resume evidence and candidate-entered
 * preferences, merges the
 * engine result with the stored real vacancies and applies transparent
 * filters. The final percentage is an explainable relevance estimate, never a
 * probability of hiring, and nothing here can auto-reject a candidate.
 */

export interface MatchFilters {
  resumeId?: string;
  level?: string;
  arrangement?: string;
  location?: string;
  search?: string;
  minScore?: number;
  savedOnly?: boolean;
}

interface EngineRole {
  role: string;
  matchingSkills: string[];
  coverage: number;
  note?: string;
}

interface EngineMatch {
  jobId: string;
  score: number;
  requiredSkills: string[];
  preferredSkills: string[];
  requirementsConfidence: string;
  level: string;
  minExperienceYears?: number | null;
  matchingSkills: string[];
  missingSkills: string[];
  missingPreferredSkills: string[];
  components: Record<string, { value: number | null; weight: number }>;
  explanation?: string[];
  learningPath?: { skill: string; action: string }[];
  gapNote?: string;
  scoreNote?: string;
}

interface EngineResult {
  skills: { skill: string; categories?: string[]; evidence?: unknown }[];
  roles: EngineRole[];
  matches: EngineMatch[];
}

export interface MatchedJob extends EngineMatch {
  title: string;
  company: string;
  location: string;
  arrangement: string;
  provider: string;
  sourceKey: string;
  sourceCompany: string;
  sourceLastCheckedAt: Date | null;
  sourceStatus: 'never' | 'ok' | 'error';
  url: string | null;
  applyUrl: string | null;
  linkKind: string;
  linkLabel: string;
  linkVerified: boolean;
  linkReason: string;
  saved: boolean;
}

export interface MatchResponse {
  selectedResumeId: string | null;
  availableResumes: { id: string; name: string }[];
  discoveryEnabled: boolean;
  resumeMissing: boolean;
  interviewEvidenceUsed: boolean;
  generatedAt: string;
  preferences: Record<string, unknown>;
  skills: EngineResult['skills'];
  roles: EngineRole[];
  sources: SourceStatus[];
  matches: MatchedJob[];
}

const ENGINE_DESCRIPTION_CHARS = 1200;

export async function getCandidateResume(userId: string, resumeId?: string): Promise<ResumeDoc | null> {
  if (resumeId) {
    if (!mongoose.isValidObjectId(resumeId)) throw new ApiError(404, 'Resume not found.');
    const resume = await Resume.findOne({ _id: resumeId, user: userId });
    if (!resume) throw new ApiError(404, 'Resume not found.');
    return resume;
  }
  return Resume.findOne({ user: userId }).sort({ updatedAt: -1 });
}

function toEngineJob(job: JobDoc) {
  return {
    id: String(job._id),
    title: job.title,
    location: job.location,
    arrangement: job.arrangement,
    description: (job.description ?? '').slice(0, ENGINE_DESCRIPTION_CHARS),
    requiredSkills: job.requiredSkills ?? [],
    preferredSkills: job.preferredSkills ?? [],
    requirementsConfidence: job.requirementsConfidence,
    minExperienceYears: job.minExperienceYears ?? null,
    level: job.level,
  };
}

async function callEngine(
  resume: ResumeDoc,
  jobs: ReturnType<typeof toEngineJob>[],
  preferences: Record<string, unknown>
): Promise<{
  result: EngineResult;
  interviewEvidenceUsed: boolean;
}> {
  // Existing sessions do not record whether responses were candidate-authored,
  // AI-assisted or synthetic. Do not present them as demonstrated skills.
  const interviewScores: { skill: string; percentage: number }[] = [];
  const response = await engineFetch('/jobs/match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profile: resume.profile ?? {},
      fullText: resume.fullText ?? '',
      jobs,
      interviewScores,
      preferences,
    }),
  });
  if (!response.ok) throw new AiEngineError('Job matching failed in the local engine.', 503);
  return { result: (await response.json()) as EngineResult, interviewEvidenceUsed: interviewScores.length > 0 };
}

/** Role directions only — used right after resume review, before any interview. */
export async function getRoleSuggestions(userId: string, resumeId?: string): Promise<{
  resumeMissing: boolean;
  skills: EngineResult['skills'];
  roles: EngineRole[];
}> {
  const resume = await getCandidateResume(userId, resumeId);
  if (!resume) return { resumeMissing: true, skills: [], roles: [] };
  const user = await User.findById(userId);
  const { result } = await callEngine(resume, [], (user?.jobPreferences ?? {}) as Record<string, unknown>);
  return { resumeMissing: false, skills: result.skills ?? [], roles: result.roles ?? [] };
}

export async function getMatches(userId: string, filters: MatchFilters): Promise<MatchResponse> {
  const [sources, user] = await Promise.all([listSourceStatus(), User.findById(userId)]);
  const preferences = (user?.jobPreferences ?? {}) as Record<string, unknown>;
  const base = {
    discoveryEnabled: env.jobDiscoveryEnabled,
    generatedAt: new Date().toISOString(),
    preferences,
    sources,
  };
  const [resume, available] = await Promise.all([
    getCandidateResume(userId, filters.resumeId),
    Resume.find({ user: userId }).sort({ updatedAt: -1 }).select('_id originalName').lean(),
  ]);
  const resumeSelection = { selectedResumeId: resume ? String(resume._id) : null,
    availableResumes: available.map(item => ({ id: String(item._id), name: item.originalName })) };
  if (!resume) {
    return {
      ...base,
      ...resumeSelection,
      resumeMissing: true,
      interviewEvidenceUsed: false,
      skills: [],
      roles: [],
      matches: [],
    };
  }

  // Take a bounded, even share of postings per board so a board refreshed last
  // cannot crowd out the others (observed during live verification).
  const sourceKeys: string[] = await Job.distinct('sourceKey', { status: 'active' });
  const perSource = Math.max(5, Math.ceil(env.jobMatchLimit / Math.max(1, sourceKeys.length)));
  const poolParts = await Promise.all(
    sourceKeys.map((sourceKey) =>
      Job.find({ status: 'active', sourceKey }).sort({ lastSeenAt: -1, _id: 1 }).limit(perSource)
    )
  );
  const pool = poolParts.flat().slice(0, env.jobMatchLimit);
  const { result, interviewEvidenceUsed } = await callEngine(resume, pool.map(toEngineJob), preferences);

  const sourceByKey = new Map(sources.map((source) => [source.sourceKey, source]));
  const jobById = new Map(pool.map((job) => [String(job._id), job]));
  const merged: MatchedJob[] = [];
  for (const match of result.matches ?? []) {
    const job = jobById.get(match.jobId);
    if (!job) continue; // The engine only scores jobs we sent; ignore stragglers.
    const source = sourceByKey.get(job.sourceKey);
    merged.push({
      ...match,
      title: job.title,
      company: job.company,
      location: job.location,
      arrangement: job.arrangement,
      provider: job.provider,
      sourceKey: job.sourceKey,
      sourceCompany: source?.company ?? job.company,
      sourceLastCheckedAt: source?.lastCheckedAt ?? null,
      sourceStatus: source?.status ?? 'never',
      url: job.url || null,
      applyUrl: job.applyUrl ?? null,
      linkKind: job.linkKind,
      linkLabel: job.linkLabel,
      linkVerified: job.linkVerified,
      linkReason: job.linkReason,
      saved: false,
    });
  }

  const savedIds = new Set(
    (
      await SavedJob.find({ user: userId, job: { $in: merged.map((m) => m.jobId) } }).select('job')
    ).map((doc) => String(doc.job))
  );
  for (const match of merged) match.saved = savedIds.has(match.jobId);

  const filtered = merged.filter((match) => passesFilters(match, filters));
  filtered.sort((a, b) => b.score - a.score);

  return {
    ...base,
    ...resumeSelection,
    resumeMissing: false,
    interviewEvidenceUsed,
    skills: result.skills ?? [],
    roles: result.roles ?? [],
    matches: filtered,
  };
}

function passesFilters(match: MatchedJob, filters: MatchFilters): boolean {
  if (filters.level && match.level !== filters.level) return false;
  if (filters.arrangement && match.arrangement !== filters.arrangement) return false;
  if (filters.location && !match.location.toLowerCase().includes(filters.location.toLowerCase())) return false;
  if (filters.search) {
    const haystack = `${match.title} ${match.company} ${match.location}`.toLowerCase();
    if (!haystack.includes(filters.search.toLowerCase())) return false;
  }
  if (typeof filters.minScore === 'number' && match.score < filters.minScore) return false;
  if (filters.savedOnly && !match.saved) return false;
  return true;
}
