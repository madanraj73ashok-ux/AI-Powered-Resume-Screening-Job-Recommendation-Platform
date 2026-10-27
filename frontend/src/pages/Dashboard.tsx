import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { apiErrorMessage } from '../api/client';
import { listResumes, formatDate, Resume } from '../api/resumes';
import { listInterviews, SessionSummary } from '../api/interviews';
import { Alert, Badge, Button, Card, EmptyState, SectionTitle, Spinner } from '../components/ui';

const WORKFLOW: Record<string, { title: string; steps: { label: string; state: string }[] }> = {
  candidate: {
    title: 'Candidate workflow',
    steps: [
      { label: 'Upload resume', state: 'resume' },
      { label: 'Resume analysis', state: 'analysis' },
      { label: 'AI interview', state: 'interview' },
      { label: 'Skills dashboard', state: 'skills' },
      { label: 'Job matching', state: 'jobs' },
      { label: 'Apply & track', state: 'tracking' },
    ],
  },
  recruiter: {
    title: 'Recruiter workflow',
    steps: [
      { label: 'Create a job', state: 'todo' },
      { label: 'Review applications', state: 'todo' },
      { label: 'Inspect evidence & findings', state: 'todo' },
      { label: 'Review interview results', state: 'todo' },
      { label: 'Shortlist candidates', state: 'todo' },
    ],
  },
  admin: {
    title: 'Administrator workflow',
    steps: [
      { label: 'Manage users and roles', state: 'todo' },
      { label: 'Configure skill dictionary & questions', state: 'todo' },
      { label: 'Monitor system health', state: 'todo' },
      { label: 'Review audit logs', state: 'todo' },
    ],
  },
};

export default function DashboardPage() {
  const { user } = useAuth();
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (user?.role !== 'candidate') {
      setLoading(false);
      return;
    }
    try {
      const [r, s] = await Promise.all([listResumes(), listInterviews()]);
      setResumes(r);
      setSessions(s);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [user?.role]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!user) return null;
  const latest = resumes[0];
  const workflow = WORKFLOW[user.role];
  const findings = latest?.analysis?.findings ?? [];
  const status = latest?.analysis?.summary?.overallStatus;
  const inProgressInterview = sessions.find((s) => s.status === 'in_progress');
  const completedInterview = sessions.find((s) => s.status === 'completed');

  const stepState = (state: string) => {
    if (user.role !== 'candidate') return 'todo';
    if (state === 'resume') return latest ? 'done' : 'next';
    if (state === 'analysis') return latest?.analysis?.analyzedAt ? 'done' : latest ? 'next' : 'todo';
    if (state === 'interview') {
      if (completedInterview) return 'done';
      return latest?.analysis?.analyzedAt ? 'next' : 'todo';
    }
    return 'todo';
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">Welcome, {user.name.split(' ')[0]}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {user.email} · <Badge color="navy">{user.role}</Badge>
          </p>
        </div>
        {user.role === 'candidate' ? (
          <Link to="/resume/upload">
            <Button>Upload resume</Button>
          </Link>
        ) : null}
      </div>

      {error ? <Alert>{error}</Alert> : null}

      {user.role === 'candidate' ? (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <Card>
              <div className="text-xs uppercase tracking-wide text-slate-500">Resume status</div>
              {loading ? (
                <div className="mt-2">
                  <Spinner label="Checking…" />
                </div>
              ) : latest ? (
                <>
                  <div className="mt-2 truncate font-semibold text-navy-900">
                    {latest.originalName}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    Uploaded {formatDate(latest.createdAt)}
                  </div>
                  <div className="mt-2">
                    <Badge color={latest.status === 'processed' ? 'green' : 'red'}>
                      {latest.status === 'processed' ? 'Processed' : 'Failed'}
                    </Badge>
                  </div>
                  <Link
                    to={`/resume/${latest.id}`}
                    className="mt-3 inline-block text-sm font-medium text-navy-700 hover:underline"
                  >
                    View analysis →
                  </Link>
                </>
              ) : (
                <div className="mt-2 text-sm text-slate-600">
                  No resume yet.{' '}
                  <Link to="/resume/upload" className="font-medium text-navy-700 underline">
                    Upload one
                  </Link>{' '}
                  to begin.
                </div>
              )}
            </Card>

            <Card>
              <div className="text-xs uppercase tracking-wide text-slate-500">Analysis</div>
              {latest?.analysis?.analyzedAt ? (
                <>
                  <div className="mt-2">
                    <Badge color={status === 'Ready for Assessment' ? 'green' : 'amber'}>
                      {status ?? 'Analyzed'}
                    </Badge>
                  </div>
                  <div className="mt-2 text-sm text-slate-600">
                    {findings.length} findings ·{' '}
                    {latest.analysis.summary?.warnings ?? 0} warnings
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {latest.profile?.skills?.length ?? 0} skills detected
                  </div>
                </>
              ) : (
                <p className="mt-2 text-sm text-slate-600">
                  {latest ? 'Not analyzed yet.' : 'Upload a resume to run analysis.'}
                </p>
              )}
            </Card>

            <Card>
              <div className="text-xs uppercase tracking-wide text-slate-500">AI interview</div>
              {inProgressInterview ? (
                <>
                  <div className="mt-2 text-sm text-slate-600">
                    {inProgressInterview.answered}/{inProgressInterview.totalQuestions} answered ·{' '}
                    {inProgressInterview.difficulty}
                  </div>
                  <Link
                    to={`/interview/${inProgressInterview.id}`}
                    className="mt-3 inline-block text-sm font-medium text-navy-700 hover:underline"
                  >
                    Continue interview →
                  </Link>
                </>
              ) : completedInterview ? (
                <>
                  <div className="mt-2 text-sm text-slate-600">
                    Last interview score: <strong>{completedInterview.score ?? 0}%</strong>{' '}
                    ({completedInterview.difficulty})
                  </div>
                  <Link
                    to={`/interview/results/${completedInterview.id}`}
                    className="mt-3 inline-block text-sm font-medium text-navy-700 hover:underline"
                  >
                    View results →
                  </Link>
                </>
              ) : latest?.analysis?.analyzedAt ? (
                <>
                  <div className="mt-2 text-sm text-slate-600">
                    Ready to start a personalized interview.
                  </div>
                  <Link
                    to="/interview"
                    className="mt-3 inline-block text-sm font-medium text-navy-700 hover:underline"
                  >
                    Start AI interview →
                  </Link>
                </>
              ) : (
                <p className="mt-2 text-sm text-slate-600">
                  Available after your resume is analyzed.
                </p>
              )}
            </Card>
          </div>

          {loading ? null : latest ? (
            <Card>
              <SectionTitle
                title="Latest analysis"
                subtitle={`${latest.originalName} · ${latest.profile?.skills?.length ?? 0} skills · ${findings.length} findings`}
                action={
                  <Link to={`/resume/${latest.id}`}>
                    <Button variant="secondary">Open full analysis</Button>
                  </Link>
                }
              />
              {findings.length === 0 ? (
                <p className="text-sm text-slate-500">No findings recorded yet.</p>
              ) : (
                <ul className="space-y-2">
                  {findings.slice(0, 4).map((f) => (
                    <li
                      key={f.id}
                      className="flex flex-col gap-1 rounded-lg border border-slate-200 px-3 py-2 text-sm sm:flex-row sm:items-center sm:justify-between"
                    >
                      <span className="text-slate-700">{f.finding}</span>
                      <Badge
                        color={
                          f.status === 'Verified Claims Recorded' || f.status === 'Supported by resume text'
                            ? 'green'
                            : f.status === 'Discrepancies Require Review'
                              ? 'red'
                              : 'amber'
                        }
                      >
                        {f.status === 'Verified Claims Recorded' ? 'Supported by resume text' : f.status}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          ) : (
            <EmptyState
              title="Start with your resume"
              description="Upload a PDF or DOCX resume. The local AI engine extracts skills, education, projects and experience, then produces claim-level findings you can review."
              action={
                <Link to="/resume/upload">
                  <Button>Upload resume</Button>
                </Link>
              }
            />
          )}
        </>
      ) : null}

      <Card>
        <SectionTitle title={workflow.title} subtitle="Platform steps and where you are" />
        <ol className="grid gap-2 sm:grid-cols-2">
          {workflow.steps.map((step, i) => {
            const state = stepState(step.state);
            return (
              <li key={step.label} className="flex items-center gap-3 rounded-lg border border-slate-100 px-3 py-2">
                <span
                  className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    state === 'done'
                      ? 'bg-green-100 text-green-800'
                      : state === 'next'
                        ? 'bg-navy-600 text-white'
                        : 'bg-slate-100 text-slate-500'
                  }`}
                >
                  {state === 'done' ? '✓' : i + 1}
                </span>
                <span className="text-sm text-slate-700">{step.label}</span>
                {state === 'next' ? <Badge color="navy">Next</Badge> : null}
              </li>
            );
          })}
        </ol>
      </Card>
    </div>
  );
}
