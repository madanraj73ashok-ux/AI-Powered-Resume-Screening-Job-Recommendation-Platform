import client from './client';

// Candidate job-matching API. All calls are user-scoped on the server via the
// httpOnly session cookie; the browser never sees other candidates' data.

export type LinkKind = 'apply_now' | 'view_job' | 'search_openings' | 'unavailable';

export const APPLICATION_STATUSES = [
  'Applied',
  'Under Review',
  'Interview Scheduled',
  'Offer Received',
  'Rejected',
  'Withdrawn',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

export interface MatchComponent {
  value: number | null;
  weight: number;
}

export interface JobMatch {
  jobId: string;
  score: number;
  title: string;
  company: string;
  location: string;
  arrangement: string;
  level: string;
  provider: string;
  sourceCompany: string;
  sourceLastCheckedAt: string | null;
  sourceStatus: 'never' | 'ok' | 'error';
  url: string | null;
  applyUrl: string | null;
  linkKind: LinkKind;
  linkLabel: string;
  linkVerified: boolean;
  linkReason: string;
  requiredSkills: string[];
  preferredSkills: string[];
  matchingSkills: string[];
  missingSkills: string[];
  missingPreferredSkills: string[];
  requirementsConfidence: string;
  minExperienceYears?: number | null;
  components: Record<string, MatchComponent>;
  explanation?: string[];
  learningPath?: { skill: string; action: string }[];
  gapNote?: string;
  scoreNote?: string;
  saved: boolean;
}

export interface RoleSuggestion {
  role: string;
  matchingSkills: string[];
  coverage: number;
  note?: string;
}

export interface SourceStatus {
  provider: string;
  sourceKey: string;
  company: string;
  boardUrl: string;
  enabled: boolean;
  lastCheckedAt: string | null;
  status: 'never' | 'ok' | 'error';
  jobCount: number;
  error: string | null;
  stale: boolean;
}

export interface MatchesResponse {
  selectedResumeId?: string | null;
  availableResumes?: { id: string; name: string }[];
  discoveryEnabled: boolean;
  resumeMissing: boolean;
  interviewEvidenceUsed: boolean;
  generatedAt: string;
  refreshing: boolean;
  preferences: JobPreferences;
  skills: { skill: string; categories?: string[] }[];
  roles: RoleSuggestion[];
  sources: SourceStatus[];
  matches: JobMatch[];
}

export interface JobPreferences {
  location?: string;
  arrangement?: 'Any' | 'Remote' | 'Hybrid' | 'On-site';
  experienceYears?: number;
}

export interface MatchFilters {
  resumeId?: string;
  level?: string;
  arrangement?: string;
  location?: string;
  search?: string;
  minScore?: number;
  savedOnly?: boolean;
}

export interface SavedJobBrief {
  jobId: string;
  title: string;
  company: string;
  location: string;
  arrangement: string;
  level: string;
  provider: string;
  url: string | null;
  applyUrl: string | null;
  linkKind: LinkKind;
  linkLabel: string;
  linkVerified: boolean;
  status: string;
}

export interface ApplicationEntry {
  id: string;
  status: ApplicationStatus;
  statusHistory: { status: ApplicationStatus; at: string }[];
  appliedAt: string;
  updatedAt: string;
  job: SavedJobBrief | null;
}

export async function getMatches(filters: MatchFilters = {}): Promise<MatchesResponse> {
  const res = await client.get('/jobs/matches', { params: filters });
  return res.data as MatchesResponse;
}

export async function getRoleSuggestions(resumeId?: string): Promise<{
  resumeMissing: boolean;
  roles: RoleSuggestion[];
  skills: { skill: string }[];
}> {
  const res = await client.get('/jobs/roles', { params: { resumeId } });
  return res.data;
}

export async function refreshJobs(force = false): Promise<{
  discoveryEnabled: boolean;
  summary: { refreshed: number; skipped: number; errors: number };
  sources: SourceStatus[];
}> {
  // A full refresh reads every board politely (serialized with pauses), so it
  // can take a while on the first run. The per-request timeout is raised.
  const res = await client.post('/jobs/refresh', { force }, { timeout: 300000 });
  return res.data;
}

export async function setPreferences(preferences: JobPreferences): Promise<{ preferences: JobPreferences }> {
  const res = await client.put('/jobs/preferences', preferences);
  return res.data;
}

export async function listSavedJobs(): Promise<{ savedAt: string; job: SavedJobBrief }[]> {
  const res = await client.get('/jobs/saved');
  return res.data.saved as { savedAt: string; job: SavedJobBrief }[];
}

export async function saveJob(jobId: string): Promise<void> {
  await client.post(`/jobs/${jobId}/save`);
}

export async function unsaveJob(jobId: string): Promise<void> {
  await client.delete(`/jobs/${jobId}/save`);
}

/**
 * Record an application the candidate explicitly confirmed.
 * Opening an external job link never calls this — only the candidate does.
 */
export async function createApplication(jobId: string): Promise<ApplicationEntry> {
  const res = await client.post(`/jobs/${jobId}/applications`, {});
  return res.data.application as ApplicationEntry;
}

export async function listApplications(): Promise<ApplicationEntry[]> {
  const res = await client.get('/applications');
  return res.data.applications as ApplicationEntry[];
}

export async function updateApplication(id: string, status: ApplicationStatus): Promise<ApplicationEntry> {
  const res = await client.patch(`/applications/${id}`, { status });
  return res.data.application as ApplicationEntry;
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return 'not yet';
  return new Date(iso).toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const ARRANGEMENT_LABELS: Record<string, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On-site',
  unknown: 'Not specified',
};

export const COMPONENT_LABELS: Record<string, string> = {
  skillCoverage: 'Required-skill coverage',
  documentedEvidence: 'Project/experience evidence',
  interviewEvidence: 'Interview-demonstrated skills',
  textRelevance: 'Overall text relevance',
  eligibilityPreferences: 'Eligibility & your preferences',
};
