import { LinkKind } from '../api/jobs';

/**
 * Honest vacancy link:
 *  - "Apply Now" only for a provider-verified, posting-specific application form
 *  - "View Job" for a job-specific page where the employer hosts the form
 *  - "Search Openings" for a board/search page
 *  - never a link button when no safe http(s) URL exists
 * The link opens in a new tab and never submits anything automatically.
 */
export function VacancyLink({
  linkKind,
  url,
  applyUrl,
  reason,
  size = 'md',
}: {
  linkKind: LinkKind;
  url: string | null;
  applyUrl: string | null;
  reason?: string;
  size?: 'md' | 'sm';
}) {
  function verifiedApply(job: URL, apply: URL): boolean {
    const jobParts = job.pathname.split('/').filter(Boolean);
    const applyParts = apply.pathname.split('/').filter(Boolean);
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (['jobs.lever.co', 'jobs.eu.lever.co'].includes(apply.hostname) && apply.hostname === job.hostname) {
      return jobParts.length === 2 && applyParts.length === 3 && uuid.test(jobParts[1]) &&
        applyParts[0] === jobParts[0] && applyParts[1] === jobParts[1] && applyParts[2] === 'apply';
    }
    const greenhouse = ['boards.greenhouse.io', 'job-boards.greenhouse.io'];
    return greenhouse.includes(apply.hostname) && greenhouse.includes(job.hostname) &&
      jobParts.length === 3 && jobParts[1] === 'jobs' && /^\d{4,}$/.test(jobParts[2]) &&
      apply.pathname === '/embed/job_app' && apply.searchParams.getAll('for').join() === jobParts[0] &&
      apply.searchParams.getAll('token').join() === jobParts[2];
  }
  let effectiveKind = linkKind;
  if (linkKind === 'apply_now') {
    try {
      const job = new URL(url ?? ''), apply = new URL(applyUrl ?? '');
      if (job.protocol !== 'https:' || apply.protocol !== 'https:' || job.username || job.password || apply.username || apply.password || !verifiedApply(job, apply)) effectiveKind = 'view_job';
    } catch { effectiveKind = 'view_job'; }
  }
  const href = effectiveKind === 'apply_now' ? applyUrl : url;
  let safe = false;
  try { const parsed = new URL(href ?? ''); safe = parsed.protocol === 'https:' && !parsed.username && !parsed.password; } catch { /* Invalid link. */ }
  if (effectiveKind === 'unavailable' || !href || !safe) {
    return (
      <span className="text-xs text-slate-500" title={reason}>
        Link unavailable
      </span>
    );
  }
  const label = effectiveKind === 'apply_now' ? 'Apply Now' : effectiveKind === 'view_job' ? 'View Job' : 'Search Openings';
  const padding = size === 'sm' ? 'px-2.5 py-1 text-xs' : 'px-3 py-1.5 text-sm';
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`inline-flex items-center gap-1 rounded-lg bg-navy-700 ${padding} font-medium text-white transition hover:bg-navy-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-300`}
    >
      {label}
      <span aria-hidden>↗</span>
      <span className="sr-only"> (opens the employer&apos;s site in a new tab; you apply there)</span>
    </a>
  );
}
