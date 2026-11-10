import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { apiErrorMessage } from '../api/client';
import {
  APPLICATION_STATUSES,
  ApplicationEntry,
  ApplicationStatus,
  createApplication,
  formatDateTime,
  listApplications,
  listSavedJobs,
  SavedJobBrief,
  unsaveJob,
  updateApplication,
} from '../api/jobs';
import { Alert, Badge, Button, Card, EmptyState, SectionTitle, Spinner } from '../components/ui';
import { VacancyLink } from '../components/VacancyLink';
import { useToast } from '../components/Toast';

const STATUS_COLORS: Record<ApplicationStatus, 'green' | 'amber' | 'red' | 'navy' | 'slate'> = {
  Applied: 'navy',
  'Under Review': 'amber',
  'Interview Scheduled': 'amber',
  'Offer Received': 'green',
  Rejected: 'red',
  Withdrawn: 'slate',
};

export default function ApplicationsPage() {
  const toast = useToast();
  const [applications, setApplications] = useState<ApplicationEntry[]>([]);
  const [saved, setSaved] = useState<{ savedAt: string; job: SavedJobBrief }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [applicationList, savedList] = await Promise.all([listApplications(), listSavedJobs()]);
      setApplications(applicationList);
      setSaved(savedList);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const changeStatus = async (application: ApplicationEntry, status: ApplicationStatus) => {
    setBusyId(application.id);
    try {
      const updated = await updateApplication(application.id, status);
      setApplications((current) => current.map((item) => (item.id === application.id ? updated : item)));
      toast.show('Application status updated.', 'success');
    } catch (err) {
      toast.show(apiErrorMessage(err), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const recordFromSaved = async (job: SavedJobBrief) => {
    setBusyId(job.jobId);
    try {
      await createApplication(job.jobId);
      toast.show('Application recorded with status “Applied”. Update it here as you hear back.', 'success');
      await load();
    } catch (err) {
      toast.show(apiErrorMessage(err), 'error');
    } finally {
      setBusyId(null);
    }
  };

  const removeSaved = async (job: SavedJobBrief) => {
    setBusyId(job.jobId);
    try {
      await unsaveJob(job.jobId);
      setSaved((current) => current.filter((entry) => entry.job.jobId !== job.jobId));
    } catch (err) {
      toast.show(apiErrorMessage(err), 'error');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) {
    return (
      <Card>
        <Spinner label="Loading your applications…" />
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-navy-900">My applications</h1>
        <p className="mt-1 max-w-prose text-sm text-slate-600">
          You control this list. Opening a job link never marks anything as applied — an application is recorded only
          when you confirm it, and every status change is kept as history. Applications are submitted on the
          employer&apos;s own site; nothing is ever submitted from here.
        </p>
      </div>

      {error ? (
        <Card>
          <Alert kind="error">{error}</Alert>
          <div className="mt-4">
            <Button onClick={() => void load()}>Try again</Button>
          </div>
        </Card>
      ) : null}

      <Card>
        <SectionTitle
          title="Applications"
          subtitle="Statuses are set by you as you hear back from employers."
        />
        {applications.length === 0 ? (
          <EmptyState
            title="No applications recorded yet"
            description="When you apply on an employer's site, open Job matches, press “I've applied” on that vacancy, and it will appear here for tracking."
            action={
              <Link to="/jobs">
                <Button variant="secondary">Browse job matches</Button>
              </Link>
            }
          />
        ) : (
          <ul className="space-y-3">
            {applications.map((application) => (
              <li key={application.id} className="rounded-lg border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-navy-900">
                      {application.job?.title ?? 'Vacancy no longer stored'}
                    </div>
                    <div className="text-sm text-slate-600">
                      {application.job?.company ?? ''}
                      {application.job?.location ? ` · ${application.job.location}` : ''}
                    </div>
                    <div className="mt-1 text-xs text-slate-500">
                      Applied {formatDateTime(application.appliedAt)} · last change {formatDateTime(application.updatedAt)}
                      {application.statusHistory.length > 1
                        ? ` · ${application.statusHistory.length} status changes recorded`
                        : ''}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge color={STATUS_COLORS[application.status] ?? 'slate'}>{application.status}</Badge>
                    {application.job ? (
                      <VacancyLink
                        linkKind={application.job.linkKind}
                        url={application.job.url}
                        applyUrl={application.job.applyUrl}
                        size="sm"
                      />
                    ) : null}
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-2">
                  <label
                    className="text-xs font-medium text-slate-600"
                    htmlFor={`status-${application.id}`}
                  >
                    Update status
                  </label>
                  <select
                    id={`status-${application.id}`}
                    value={application.status}
                    disabled={busyId === application.id}
                    onChange={(event) => void changeStatus(application, event.target.value as ApplicationStatus)}
                    className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm text-slate-800 focus:border-navy-500 focus:outline-none focus:ring-1 focus:ring-navy-500"
                  >
                    {APPLICATION_STATUSES.map((status) => (
                      <option key={status} value={status}>
                        {status}
                      </option>
                    ))}
                  </select>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card>
        <SectionTitle title="Saved jobs" subtitle="Bookmarked vacancies. Saving never implies applying." />
        {saved.length === 0 ? (
          <p className="text-sm text-slate-500">No saved jobs yet. Use “Save job” on a match to bookmark it here.</p>
        ) : (
          <ul className="space-y-3">
            {saved.map((entry) => (
              <li
                key={entry.job.jobId}
                className="flex flex-wrap items-start justify-between gap-3 rounded-lg border border-slate-200 p-4"
              >
                <div>
                  <div className="text-sm font-semibold text-navy-900">{entry.job.title}</div>
                  <div className="text-sm text-slate-600">
                    {entry.job.company}
                    {entry.job.location ? ` · ${entry.job.location}` : ''}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">Saved {formatDateTime(entry.savedAt)}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <VacancyLink
                    linkKind={entry.job.linkKind}
                    url={entry.job.url}
                    applyUrl={entry.job.applyUrl}
                    size="sm"
                  />
                  <Button
                    variant="secondary"
                    onClick={() => void recordFromSaved(entry.job)}
                    disabled={busyId === entry.job.jobId}
                  >
                    I&apos;ve applied — record it
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => void removeSaved(entry.job)}
                    disabled={busyId === entry.job.jobId}
                  >
                    Remove
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
