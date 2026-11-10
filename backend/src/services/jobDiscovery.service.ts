import { env } from '../config/env';
import crypto from 'crypto';
import sourcesConfig from '../config/jobSources.json';
import { Job } from '../models/Job';
import { JobSource, JobSourceDoc } from '../models/JobSource';
import { AiEngineError, engineFetch } from './aiEngine';
import {
  fetchProviderJobs,
  JobProvider,
  ProviderJob,
  providerBoardUrl,
  selectForDiscovery,
} from './jobProviders';

/**
 * Real vacancy discovery from public company job boards.
 *
 * Rules enforced here:
 *  - Only configured, verified boards are read (see config/jobSources.json).
 *  - Requests are serialized with a pause; Lever's robots.txt asks for a 1s
 *    crawl delay and Greenhouse publishes no read limit, so we pace both.
 *  - A posting is only ever stored from a provider response. Nothing is
 *    invented; a failed board keeps its previous data and is marked `error`.
 *  - Postings the board no longer returns are marked `expired`, never deleted.
 *  - No candidate data is ever sent to a provider; requests are anonymous reads.
 */

interface ParsedJob {
  requiredSkills: string[];
  preferredSkills: string[];
  requirementsConfidence: string;
  minExperienceYears: number | null;
  experienceEvidence?: string | null;
  level: string;
  description: string;
  link: { linkKind: string; linkLabel: string; url: string; verified: boolean; reason: string };
}

export interface SourceStatus {
  provider: string;
  sourceKey: string;
  company: string;
  boardUrl: string;
  enabled: boolean;
  lastCheckedAt: Date | null;
  status: 'never' | 'ok' | 'error';
  jobCount: number;
  error: string | null;
  stale: boolean;
}

export interface RefreshSummary {
  refreshed: number;
  skipped: number;
  errors: number;
}

const PARSE_CHUNK_SIZE = 25;
let refreshPromise: Promise<RefreshSummary> | null = null;

/** Test-friendly: read pacing at call time (0 disables the pause). */
function sourcePaceMs(): number {
  const raw = Number(process.env.JOB_SOURCE_PACE_MS);
  return Number.isFinite(raw) && raw >= 0 ? raw : 1000;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shortError(error: unknown): string {
  if (error instanceof AiEngineError) return 'The local AI engine is unavailable; nothing was refreshed.';
  const message = error instanceof Error ? error.message : 'Unknown error';
  return message.length > 160 ? `${message.slice(0, 157)}...` : message;
}

/** Create JobSource documents for every configured board (idempotent). */
export async function ensureSourcesSeeded(): Promise<void> {
  for (const source of sourcesConfig.sources) {
    await JobSource.updateOne(
      { provider: source.provider, token: source.token },
      {
        $set: {
          company: source.company,
          boardUrl: providerBoardUrl(source.provider as JobProvider, source.token),
        },
        $setOnInsert: { enabled: true, lastStatus: 'never' },
      },
      { upsert: true }
    );
  }
}

export function isSourceStale(source: Pick<JobSourceDoc, 'lastCheckedAt'>): boolean {
  if (!source.lastCheckedAt) return true;
  return Date.now() - source.lastCheckedAt.getTime() > env.jobRefreshMinutes * 60_000;
}

export async function listSourceStatus(): Promise<SourceStatus[]> {
  if ((await JobSource.estimatedDocumentCount()) === 0) await ensureSourcesSeeded();
  const sources = await JobSource.find({}).sort({ company: 1 });
  return sources.map((source) => ({
    provider: source.provider,
    sourceKey: `${source.provider}:${source.token}`,
    company: source.company,
    boardUrl: source.boardUrl,
    enabled: source.enabled,
    lastCheckedAt: source.lastCheckedAt ?? null,
    status: source.lastStatus,
    jobCount: source.lastJobCount ?? 0,
    error: source.lastError ?? null,
    stale: isSourceStale(source),
  }));
}

async function parseJobs(chunk: ProviderJob[]): Promise<Map<string, ParsedJob>> {
  const response = await engineFetch('/jobs/parse', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jobs: chunk.map((job) => ({
        id: job.externalId,
        title: job.title,
        description: job.description,
        url: job.url,
        applyUrl: job.applyUrl,
      })),
    }),
  });
  if (!response.ok) throw new AiEngineError('Job parsing failed in the local engine.', 503);
  const body = (await response.json()) as { jobs: ParsedJob[] };
  const byId = new Map<string, ParsedJob>();
  chunk.forEach((job, index) => {
    if (body.jobs[index]) byId.set(job.externalId, body.jobs[index]);
  });
  return byId;
}

async function refreshSource(source: JobSourceDoc): Promise<'ok' | 'error'> {
  const sourceKey = `${source.provider}:${source.token}`;
  source.lastAttemptAt = new Date();
  try {
    const fetched = await fetchProviderJobs(
      { provider: source.provider as JobProvider, token: source.token, company: source.company },
      { timeoutMs: env.jobProviderTimeoutMs }
    );
    const selected = selectForDiscovery(fetched, env.jobMaxPerSource);
    const fetchedIds = fetched.map((job) => job.externalId);

    const fingerprint = (job: ProviderJob) => crypto.createHash('sha256').update(JSON.stringify({
      title: job.title, location: job.location, arrangement: job.arrangement, url: job.url,
      applyUrl: job.applyUrl ?? null, description: job.description,
    })).digest('hex');
    const known = new Map((await Job.find({ sourceKey }).select('externalId sourceHash'))
      .map((doc) => [doc.externalId, doc.sourceHash]));
    const newJobs = selected.filter((job) => known.get(job.externalId) !== fingerprint(job));

    for (let index = 0; index < newJobs.length; index += PARSE_CHUNK_SIZE) {
      const chunk = newJobs.slice(index, index + PARSE_CHUNK_SIZE);
      const parsed = await parseJobs(chunk);
      for (const job of chunk) {
        const info = parsed.get(job.externalId);
        if (!info) throw new AiEngineError('The local engine returned an incomplete parse.', 503);
        await Job.updateOne(
          { dedupeKey: `${sourceKey}:${job.externalId}` },
          {
            $set: {
              provider: source.provider,
              sourceKey,
              externalId: job.externalId,
              title: job.title,
              company: job.company,
              location: job.location,
              arrangement: job.arrangement,
              level: info.level,
              url: job.url,
              applyUrl: job.applyUrl ?? null,
              linkKind: info.link.linkKind,
              linkLabel: info.link.linkLabel,
              linkVerified: info.link.verified,
              linkReason: info.link.reason,
              description: info.description,
              requiredSkills: info.requiredSkills,
              preferredSkills: info.preferredSkills,
              requirementsConfidence: info.requirementsConfidence,
              minExperienceYears: info.minExperienceYears,
              experienceEvidence: info.experienceEvidence ?? null,
              skillsParsedAt: new Date(),
              sourceHash: fingerprint(job),
              lastSeenAt: new Date(),
              status: 'active',
            },
            $setOnInsert: { firstSeenAt: new Date() },
          },
          { upsert: true }
        );
      }
    }

    // Postings that are still live keep their data fresh and never expire.
    await Job.updateMany(
      { sourceKey, externalId: { $in: fetchedIds } },
      { $set: { lastSeenAt: new Date(), status: 'active' } }
    );
    // Only expire when the board actually answered with postings; an empty
    // response is treated as unknown rather than "everything was removed".
    if (fetched.length > 0) {
      await Job.updateMany(
        { sourceKey, status: 'active', externalId: { $nin: fetchedIds } },
        { $set: { status: 'expired' } }
      );
    }

    source.lastStatus = 'ok';
    source.lastError = null;
    source.lastJobCount = fetched.length;
    source.consecutiveFailures = 0;
    source.lastCheckedAt = new Date();
    await source.save();
    return 'ok';
  } catch (error) {
    // A failed check is not a successful refresh: lastCheckedAt stays as-is,
    // stored postings remain visible and the UI shows the error state.
    source.lastStatus = 'error';
    source.lastError = shortError(error);
    source.consecutiveFailures += 1;
    await source.save();
    return 'error';
  }
}

async function runRefresh(options: { force?: boolean }): Promise<RefreshSummary> {
  if (!env.jobDiscoveryEnabled) return { refreshed: 0, skipped: 0, errors: 0 };
  await ensureSourcesSeeded();
  const sources = await JobSource.find({ enabled: true });
  const summary: RefreshSummary = { refreshed: 0, skipped: 0, errors: 0 };
  let lastRequestAt = 0;
  for (const source of sources) {
    const attemptedRecently = source.lastAttemptAt && Date.now() - source.lastAttemptAt.getTime() < 5 * 60_000;
    if (!options.force && (!isSourceStale(source) || attemptedRecently)) {
      summary.skipped += 1;
      continue;
    }
    const pause = sourcePaceMs() - (Date.now() - lastRequestAt);
    if (lastRequestAt && pause > 0) await sleep(pause);
    lastRequestAt = Date.now();
    const result = await refreshSource(source);
    if (result === 'ok') summary.refreshed += 1;
    else summary.errors += 1;
  }
  return summary;
}

/** Refresh due sources. Concurrent calls are coalesced into one run. */
export async function refreshSources(options: { force?: boolean } = {}): Promise<RefreshSummary> {
  if (refreshPromise) return refreshPromise;
  refreshPromise = runRefresh(options).finally(() => {
    refreshPromise = null;
  });
  return refreshPromise;
}

/** Diagnostic/test hook: the in-flight refresh, if one is running (never starts one). */
export function pendingRefresh(): Promise<RefreshSummary> | null {
  return refreshPromise;
}
