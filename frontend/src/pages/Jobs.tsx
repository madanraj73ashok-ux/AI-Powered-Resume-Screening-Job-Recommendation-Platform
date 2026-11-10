import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { apiErrorMessage } from '../api/client';
import {
  ApplicationStatus,
  ARRANGEMENT_LABELS,
  COMPONENT_LABELS,
  createApplication,
  formatDateTime,
  getMatches,
  JobMatch,
  MatchesResponse,
  refreshJobs,
  saveJob,
  setPreferences,
  SourceStatus,
  unsaveJob,
} from '../api/jobs';
import { Alert, Badge, Button, Card, EmptyState, SectionTitle, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import { VacancyLink } from '../components/VacancyLink';

const LEVELS = ['Internship', 'Entry level', 'Experienced', 'Not specified'];

function scoreColor(score: number): string {
  if (score >= 70) return 'text-green-700';
  if (score >= 45) return 'text-amber-700';
  return 'text-slate-600';
}

function sourceBadgeColor(source: SourceStatus): 'green' | 'red' | 'slate' {
  if (!source.enabled) return 'slate';
  if (source.status === 'error') return 'red';
  if (source.status === 'ok') return 'green';
  return 'slate';
}

function MatchDetails({ match }: { match: JobMatch }) {
  const components = Object.entries(match.components ?? {});
  return (
    <div className="mt-3 space-y-3 rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
      {components.length > 0 ? (
        <div>
          <div className="font-semibold text-slate-700">How this estimate is built</div>
          <ul className="mt-1 space-y-1">
            {components.map(([key, component]) => (
              <li key={key}>
                {COMPONENT_LABELS[key] ?? key}:{' '}
                {component.value === null ? (
                  <span>not available (its weight is shared by the other parts)</span>
                ) : (
                  <span>
                    {component.value}% · weight {component.weight}%
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {match.explanation?.length ? (
        <ul className="list-disc space-y-1 pl-4">
          {match.explanation.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      ) : null}
      {match.learningPath?.length ? (
        <div>
          <div className="font-semibold text-slate-700">Learning suggestions for missing skills</div>
          <ul className="mt-1 space-y-1">
            {match.learningPath.map((item) => (
              <li key={item.skill}>
                <span className="font-medium">{item.skill}:</span> {item.action}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {match.gapNote ? <p>{match.gapNote}</p> : null}
      {match.scoreNote ? <p className="text-slate-500">{match.scoreNote}</p> : null}
      <p className="text-slate-500">{match.linkReason}</p>
    </div>
  );
}

function JobCard({
  match,
  applied,
  onSavedChange,
  onApplied,
}: {
  match: JobMatch;
  applied?: ApplicationStatus;
  onSavedChange: (jobId: string, saved: boolean) => void;
  onApplied: (jobId: string, status: ApplicationStatus) => void;
}) {
  // onSavedChange / onApplied update the parent's local state only; nothing is
  // written by opening a link.
  const toast = useToast();
  const [expanded, setExpanded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const toggleSave = async () => {
    setBusy(true);
    try {
      if (match.saved) {
        await unsaveJob(match.jobId);
        onSavedChange(match.jobId, false);
      } else {
        await saveJob(match.jobId);
        onSavedChange(match.jobId, true);
      }
    } catch (err) {
      toast.show(apiErrorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const recordApplication = async () => {
    setBusy(true);
    try {
      const application = await createApplication(match.jobId);
      onApplied(match.jobId, application.status);
      setConfirming(false);
      toast.show('Application recorded. Update its status in My Applications.', 'success');
    } catch (err) {
      toast.show(apiErrorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-navy-900">{match.title}</h3>
          <p className="mt-0.5 text-sm text-slate-600">
            {match.company}
            {match.location ? ` · ${match.location}` : ''}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <Badge color="navy">{match.level}</Badge>
            <Badge>{ARRANGEMENT_LABELS[match.arrangement] ?? match.arrangement}</Badge>
            {match.saved ? <Badge color="amber">Saved</Badge> : null}
            {applied ? <Badge color="green">Applied · {applied}</Badge> : null}
          </div>
        </div>
        <div className="text-right">
          <div className={`text-2xl font-bold ${scoreColor(match.score)}`}>{match.score}%</div>
          <div className="text-xs text-slate-500">match estimate</div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {match.matchingSkills.map((skill) => (
          <span key={skill} className="rounded-full bg-green-50 px-2 py-0.5 text-xs text-green-800">
            {skill}
          </span>
        ))}
        {match.missingSkills.map((skill) => (
          <span key={skill} className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
            {skill} · not in your evidence
          </span>
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <VacancyLink
          linkKind={match.linkKind}
          url={match.url}
          applyUrl={match.applyUrl}
          reason={match.linkReason}
        />
        <Button variant="secondary" onClick={() => void toggleSave()} disabled={busy} aria-pressed={match.saved}>
          {match.saved ? 'Saved ✓' : 'Save job'}
        </Button>
        {applied ? (
          <Link to="/applications" className="text-sm font-medium text-navy-700 underline">
            Track in My Applications
          </Link>
        ) : confirming ? (
          <span className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
            Only confirm if you actually applied on the employer&apos;s site.
            <Button variant="primary" onClick={() => void recordApplication()} disabled={busy}>
              Yes, record it
            </Button>
            <Button variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </Button>
          </span>
        ) : (
          <Button variant="ghost" onClick={() => setConfirming(true)} disabled={busy}>
            I&apos;ve applied
          </Button>
        )}
        <button
          type="button"
          className="ml-auto text-xs font-medium text-navy-700 underline"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded ? 'Hide details' : 'Score details'}
        </button>
      </div>

      <p className="mt-2 text-xs text-slate-500">
        Source: {match.sourceCompany} ({match.provider}) · checked {formatDateTime(match.sourceLastCheckedAt)} ·{' '}
        {match.requirementsConfidence}
      </p>
      {expanded ? <MatchDetails match={match} /> : null}
    </li>
  );
}

export default function JobsPage() {
  const toast = useToast();
  const [query] = useSearchParams();
  const [resumeId, setResumeId] = useState(query.get('resumeId') ?? '');
  const [data, setData] = useState<MatchesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [appliedJobs, setAppliedJobs] = useState<Record<string, ApplicationStatus>>({});
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [level, setLevel] = useState('');
  const [arrangement, setArrangement] = useState('');
  const [minScore, setMinScore] = useState('');
  const [savedOnly, setSavedOnly] = useState(false);

  const [prefLocation, setPrefLocation] = useState('');
  const [prefArrangement, setPrefArrangement] = useState<JobPreferencesArrange>('Any');
  const [prefYears, setPrefYears] = useState('');
  const [savingPrefs, setSavingPrefs] = useState(false);

  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prefsInitialized = useRef(false);
  const requestVersion = useRef(0);

  const load = useCallback(async () => {
    const version = ++requestVersion.current;
    setError(null);
    try {
      const response = await getMatches({
        resumeId: resumeId || undefined,
        search: debouncedSearch || undefined,
        level: level || undefined,
        arrangement: arrangement || undefined,
        minScore: minScore === '' ? undefined : Number(minScore),
        savedOnly: savedOnly || undefined,
      });
      if (version === requestVersion.current) setData(response);
    } catch (err) {
      if (version === requestVersion.current) setError(apiErrorMessage(err));
    } finally {
      if (version === requestVersion.current) setLoading(false);
    }
  }, [resumeId, debouncedSearch, level, arrangement, minScore, savedOnly]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [search]);

  // Load the candidate's stored preferences into the form once, without
  // clobbering edits made while a reload is in flight.
  useEffect(() => {
    if (!data?.preferences || prefsInitialized.current) return;
    prefsInitialized.current = true;
    setPrefLocation(data.preferences.location ?? '');
    setPrefArrangement(data.preferences.arrangement ?? 'Any');
    setPrefYears(data.preferences.experienceYears === undefined ? '' : String(data.preferences.experienceYears));
  }, [data]);

  const checkBoards = async () => {
    setRefreshing(true);
    try {
      const result = await refreshJobs(false);
      toast.show(
        `Boards checked: ${result.summary.refreshed} refreshed, ${result.summary.skipped} checked recently, ${result.summary.errors} unavailable.`,
        result.summary.errors ? 'info' : 'success'
      );
      await load();
    } catch (err) {
      toast.show(apiErrorMessage(err), 'error');
    } finally {
      setRefreshing(false);
    }
  };

  const savePreferencesNow = async (event: FormEvent) => {
    event.preventDefault();
    setSavingPrefs(true);
    try {
      await setPreferences({
        location: prefLocation.trim(),
        arrangement: prefArrangement,
        experienceYears: prefYears === '' ? undefined : Number(prefYears),
      });
      toast.show('Preferences saved. They are used only for eligibility checks you entered yourself.', 'success');
      await load();
    } catch (err) {
      toast.show(apiErrorMessage(err), 'error');
    } finally {
      setSavingPrefs(false);
    }
  };

  const filtersActive = Boolean(debouncedSearch || level || arrangement || minScore !== '' || savedOnly);
  const clearFilters = () => {
    setSearch('');
    setLevel('');
    setArrangement('');
    setMinScore('');
    setSavedOnly(false);
  };

  if (loading && !data) {
    return (
      <Card>
        <Spinner label="Loading job matches…" />
      </Card>
    );
  }

  if (error && !data) {
    return (
      <Card>
        <Alert kind="error">{error}</Alert>
        <div className="mt-4">
          <Button onClick={() => void load()}>Try again</Button>
        </div>
      </Card>
    );
  }

  const sources = data?.sources ?? [];
  const failing = sources.filter((source) => source.enabled && source.status === 'error');
  const disabledSources = sources.filter((source) => !source.enabled);
  const staleSources = sources.filter((source) => source.enabled && source.stale && source.lastCheckedAt);
  const interviewNote = data?.interviewEvidenceUsed
    ? 'Your latest interview result adds interview-demonstrated skills to the estimate.'
    : 'Interview scores are not currently included in job matches; resume evidence is used instead.';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-navy-900">Job matches</h1>
          <p className="mt-1 max-w-prose text-sm text-slate-600">
            Vacancies discovered from public company job boards, compared with your resume evidence and
            preferences. Percentages are explainable relevance estimates — not probabilities of hiring.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => void checkBoards()} disabled={refreshing}>
            {refreshing ? 'Checking boards…' : 'Check for new jobs'}
          </Button>
          <Button variant="ghost" onClick={() => void load()} disabled={loading}>
            Reload matches
          </Button>
        </div>
      </div>

      {data && !data.discoveryEnabled ? (
        <Alert kind="info">
          Job discovery is disabled in this environment (JOB_DISCOVERY_ENABLED=false). Stored vacancies and saved
          jobs remain visible; nothing new is fetched.
        </Alert>
      ) : null}

      {failing.length > 0 ? (
        <Alert kind="error">
          <div>
            <span className="font-medium">Some boards are unavailable right now.</span> Stored vacancies from them
            are still shown with their last successful check time.
          </div>
          <ul className="mt-1 list-disc pl-5">
            {failing.map((source) => (
              <li key={source.sourceKey}>
                {source.company}: {source.error ?? 'unreachable'}{' '}
                <a href={source.boardUrl} target="_blank" rel="noopener noreferrer" className="underline">
                  Search Openings ↗
                </a>
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      {data?.refreshing ? (
        <Alert kind="info">Checking the job boards in the background; this page still shows the last stored data.</Alert>
      ) : null}
      {staleSources.length > 0 ? <Alert kind="info">Some listings are from an older board check and may have closed. Confirm availability on the employer’s site before applying.</Alert> : null}

      {data?.resumeMissing ? (
        <EmptyState
          title="Upload a resume to see job matches"
          description="Matches are built from your resume evidence — no interview is required. Upload a PDF or DOCX and this page will suggest roles and real vacancies immediately."
          action={
            <Link to="/resume/upload">
              <Button>Upload resume</Button>
            </Link>
          }
        />
      ) : (
        <>
          {data?.availableResumes?.length ? <Card><label className="label" htmlFor="jobs-resume">Resume used for matches</label>
            <select id="jobs-resume" className="input" value={resumeId || data.selectedResumeId || ''} onChange={event => { requestVersion.current++; setLoading(true); setData(null); setResumeId(event.target.value); }}>
              {data.availableResumes.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
            </select></Card> : null}
          {data && data.roles.length > 0 ? (
            <Card>
              <SectionTitle
                title="Role directions from your evidence"
                subtitle="Curated role ideas matched to skills mentioned in your resume — not advertised vacancies."
              />
              <div className="flex flex-wrap gap-2">
                {data.roles.map((role) => (
                  <span key={role.role} className="rounded-lg border border-navy-200 bg-navy-50 px-3 py-1.5 text-sm text-navy-800">
                    {role.role} <span className="text-xs text-navy-600">· {role.coverage}% of its skill set</span>
                  </span>
                ))}
              </div>
              <p className="mt-2 text-xs text-slate-500">{interviewNote}</p>
            </Card>
          ) : null}

          <Card>
            <SectionTitle
              title="Your preferences (optional)"
              subtitle="Entered by you, never inferred from the resume or interview. Used only for the eligibility part of matching."
            />
            <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => void savePreferencesNow(event)}>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                Preferred location
                <input
                  type="text"
                  value={prefLocation}
                  onChange={(event) => setPrefLocation(event.target.value)}
                  placeholder="e.g. Bengaluru"
                  maxLength={120}
                  className="w-44 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-navy-500 focus:outline-none focus:ring-1 focus:ring-navy-500"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                Work arrangement
                <select
                  value={prefArrangement}
                  onChange={(event) => setPrefArrangement(event.target.value as JobPreferencesArrange)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-navy-500 focus:outline-none focus:ring-1 focus:ring-navy-500"
                >
                  <option value="Any">Any</option>
                  <option value="Remote">Remote</option>
                  <option value="Hybrid">Hybrid</option>
                  <option value="On-site">On-site</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                Years of experience
                <input
                  type="number"
                  min={0}
                  max={50}
                  value={prefYears}
                  onChange={(event) => setPrefYears(event.target.value)}
                  className="w-28 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-navy-500 focus:outline-none focus:ring-1 focus:ring-navy-500"
                />
              </label>
              <Button type="submit" variant="secondary" disabled={savingPrefs}>
                {savingPrefs ? 'Saving…' : 'Save preferences'}
              </Button>
            </form>
          </Card>

          <Card>
            <SectionTitle title="Filters" subtitle="Applied to stored vacancies on the server" />
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                Search
                <input
                  type="search"
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="title, company or location"
                  className="w-56 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-navy-500 focus:outline-none focus:ring-1 focus:ring-navy-500"
                />
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                Level
                <select
                  value={level}
                  onChange={(event) => setLevel(event.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-navy-500 focus:outline-none focus:ring-1 focus:ring-navy-500"
                >
                  <option value="">Any level</option>
                  {LEVELS.map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                Arrangement
                <select
                  value={arrangement}
                  onChange={(event) => setArrangement(event.target.value)}
                  className="rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-navy-500 focus:outline-none focus:ring-1 focus:ring-navy-500"
                >
                  <option value="">Any</option>
                  <option value="remote">Remote</option>
                  <option value="hybrid">Hybrid</option>
                  <option value="onsite">On-site</option>
                  <option value="unknown">Not specified</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-xs font-medium text-slate-600">
                Minimum match
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={minScore}
                  onChange={(event) => setMinScore(event.target.value)}
                  placeholder="0"
                  className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-800 focus:border-navy-500 focus:outline-none focus:ring-1 focus:ring-navy-500"
                />
              </label>
              <label className="flex items-center gap-2 pb-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={savedOnly}
                  onChange={(event) => setSavedOnly(event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Saved only
              </label>
              {filtersActive ? (
                <Button variant="ghost" onClick={clearFilters}>
                  Clear filters
                </Button>
              ) : null}
            </div>
          </Card>

          {loading ? <Spinner label="Updating matches…" /> : null}

          {data && data.matches.length === 0 && !loading ? (
            filtersActive ? (
              <EmptyState
                title="No vacancies match your filters"
                description="Stored vacancies exist, but none match the current filters. Try clearing them."
                action={<Button onClick={clearFilters}>Clear filters</Button>}
              />
            ) : (
              <EmptyState
                title="No vacancies stored yet"
                description="Nothing is fabricated here: this list only ever contains postings read from the configured public company boards. Use “Check for new jobs” to fetch the latest vacancies."
                action={
                  <Button onClick={() => void checkBoards()} disabled={refreshing}>
                    {refreshing ? 'Checking boards…' : 'Check for new jobs'}
                  </Button>
                }
              />
            )
          ) : null}

          {data && data.matches.length > 0 ? (
            <ul className="space-y-4">
              {data.matches.map((match) => (
                <JobCard
                  key={match.jobId}
                  match={match}
                  applied={appliedJobs[match.jobId]}
                  onSavedChange={(jobId, saved) =>
                    setData((current) =>
                      current
                        ? { ...current, matches: current.matches.map((m) => (m.jobId === jobId ? { ...m, saved } : m)) }
                        : current
                    )
                  }
                  onApplied={(jobId, status) =>
                    setAppliedJobs((current) => ({ ...current, [jobId]: status }))
                  }
                />
              ))}
            </ul>
          ) : null}

          <Card>
            <SectionTitle
              title="Boards checked"
              subtitle="Public Greenhouse and Lever company boards. A failed board keeps its last stored vacancies and shows the error above."
            />
            <div className="flex flex-wrap gap-2">
              {sources.map((source) => (
                <span
                  key={source.sourceKey}
                  className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs ${
                    source.enabled ? 'border-slate-200 bg-white' : 'border-slate-200 bg-slate-100 text-slate-400'
                  }`}
                >
                  <Badge color={sourceBadgeColor(source)}>{source.status === 'error' ? 'error' : source.status}</Badge>
                  <span className="font-medium text-slate-700">{source.company}</span>
                  <span className="text-slate-500">
                    {source.enabled ? `${source.jobCount} postings · checked ${formatDateTime(source.lastCheckedAt)}` : 'disabled'}
                  </span>
                </span>
              ))}
              {disabledSources.length > 0 ? (
                <span className="text-xs text-slate-400">{disabledSources.length} additional board(s) disabled.</span>
              ) : null}
            </div>
          </Card>

          <p className="text-xs text-slate-500">
            All assessments and match percentages are advisory. Human review is required for consequential hiring
            decisions, and opening a job link never marks anything as applied — only you can record an application.
          </p>
        </>
      )}
    </div>
  );
}

type JobPreferencesArrange = 'Any' | 'Remote' | 'Hybrid' | 'On-site';
