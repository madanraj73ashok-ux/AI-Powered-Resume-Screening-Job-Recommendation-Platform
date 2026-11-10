/**
 * Provider adapters for real, public company job boards.
 *
 * Only documented public JSON endpoints are used:
 *  - Greenhouse job board API: https://boards-api.greenhouse.io/v1/boards/{token}/jobs
 *  - Lever postings API:       https://api.lever.co/v0/postings/{token}?mode=json
 *
 * Responses are normalized into ProviderJob records. Nothing is invented: a
 * board that fails or returns nothing is reported as an error/empty state.
 */

export type JobProvider = 'greenhouse' | 'lever';

export interface ProviderJob {
  externalId: string;
  title: string;
  company: string;
  location: string;
  arrangement: 'remote' | 'hybrid' | 'onsite' | 'unknown';
  url: string;
  applyUrl?: string;
  description: string;
  postedAt?: Date | null;
}

export class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderError';
  }
}

// One polite request at a time; the caller spaces requests between sources.
const USER_AGENT = 'VeriHireAI-local-job-discovery/1.0 (student project; local use)';

export function providerApiUrl(provider: JobProvider, token: string): string {
  return provider === 'greenhouse'
    ? `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`
    : `https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`;
}

/** The human-readable board page, used for "Search Openings" fallbacks. */
export function providerBoardUrl(provider: JobProvider, token: string): string {
  return provider === 'greenhouse'
    ? `https://boards.greenhouse.io/${encodeURIComponent(token)}`
    : `https://jobs.lever.co/${encodeURIComponent(token)}`;
}

export function htmlToPlainText(value: string): string {
  const decoded = value
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
  return decoded
    .replace(/<(?:br|\/p|\/li|\/h[1-6]|\/div)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function detectArrangement(location: string): ProviderJob['arrangement'] {
  const text = location.toLowerCase();
  if (text.includes('hybrid')) return 'hybrid';
  if (text.includes('remote')) return 'remote';
  if (/\b(on[- ]site|in[- ]office|office[- ]based)\b/.test(text)) return 'onsite';
  return 'unknown';
}

function asDate(value: unknown): Date | null {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value);
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return null;
}

async function requestJson(url: string, timeoutMs: number): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { Accept: 'application/json', 'User-Agent': USER_AGENT },
    });
    if (!response.ok) {
      throw new ProviderError(`The job board answered with HTTP ${response.status}.`);
    }
    return await response.json();
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    throw new ProviderError('The job board could not be reached.');
  } finally {
    clearTimeout(timer);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type JsonRecord = Record<string, any>;

function fromGreenhouse(payload: unknown, company: string): ProviderJob[] {
  const rows = (payload as JsonRecord)?.jobs;
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row: JsonRecord): ProviderJob => {
      const location = String(row?.location?.name ?? '').trim();
      return {
        externalId: String(row?.id ?? ''),
        title: String(row?.title ?? '').trim(),
        company,
        location,
        arrangement: detectArrangement(location),
        url: typeof row?.absolute_url === 'string' ? row.absolute_url.trim() : '',
        description: htmlToPlainText(String(row?.content ?? '')),
        postedAt: asDate(row?.updated_at),
      };
    })
    .filter((job) => job.externalId && job.title && job.url.startsWith('https://'));
}

function fromLever(payload: unknown, company: string): ProviderJob[] {
  if (!Array.isArray(payload)) return [];
  return payload
    .map((row: JsonRecord): ProviderJob => {
      const location = String(row?.categories?.location ?? '').trim();
      const applyUrl = typeof row?.applyUrl === 'string' ? row.applyUrl.trim() : undefined;
      return {
        externalId: String(row?.id ?? ''),
        title: String(row?.text ?? '').trim(),
        company,
        location,
        arrangement: detectArrangement(location),
        url: typeof row?.hostedUrl === 'string' ? row.hostedUrl.trim() : '',
        applyUrl: applyUrl?.startsWith('https://') ? applyUrl : undefined,
        description:
          typeof row?.descriptionPlain === 'string' && row.descriptionPlain.trim()
            ? row.descriptionPlain.trim()
            : htmlToPlainText(String(row?.description ?? '')),
        postedAt: asDate(row?.createdAt),
      };
    })
    .filter((job) => job.externalId && job.title && job.url.startsWith('https://'));
}

export async function fetchProviderJobs(
  source: { provider: JobProvider; token: string; company: string },
  options: { timeoutMs: number }
): Promise<ProviderJob[]> {
  const payload = await requestJson(providerApiUrl(source.provider, source.token), options.timeoutMs);
  return source.provider === 'greenhouse'
    ? fromGreenhouse(payload, source.company)
    : fromLever(payload, source.company);
}

const EARLY_CAREER = /(intern(ship)?|junior|graduate|entry[- ]level|trainee|apprentice|associate|fresher)/i;

/**
 * Bound how many postings one board contributes. Early-career-friendly titles
 * first, then the most recently posted roles, so a small local machine can
 * refresh every board politely without dropping early-career coverage.
 */
export function selectForDiscovery(jobs: ProviderJob[], maxJobs: number): ProviderJob[] {
  const ordered = [...jobs].sort((a, b) => {
    const early = Number(EARLY_CAREER.test(b.title)) - Number(EARLY_CAREER.test(a.title));
    if (early) return early;
    return (b.postedAt?.getTime() ?? 0) - (a.postedAt?.getTime() ?? 0);
  });
  return ordered.slice(0, maxJobs);
}
