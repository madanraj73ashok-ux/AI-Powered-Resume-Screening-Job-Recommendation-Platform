import { useCallback, useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { apiErrorMessage } from '../api/client';
import {
  Difficulty,
  listInterviews,
  SessionSummary,
  startInterview,
  difficultyBadgeColor,
} from '../api/interviews';
import { listResumes, Resume, formatDate } from '../api/resumes';
import { Alert, Badge, Button, Card, EmptyState, SectionTitle, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';

const DIFFICULTY_HELP: Record<Difficulty, string> = {
  Beginner: 'Fundamentals and definitions. Best for a first run.',
  Intermediate: 'Applied knowledge, examples and trade-offs.',
  Advanced: 'Architecture, debugging and design reasoning.',
};

export default function InterviewStartPage() {
  const navigate = useNavigate();
  const toast = useToast();

  const [resumes, setResumes] = useState<Resume[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const [resumeId, setResumeId] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty>('Intermediate');
  const [questionCount, setQuestionCount] = useState(8);

  const load = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([listResumes(), listInterviews()]);
      setResumes(r);
      setSessions(s);
      if (r.length > 0) setResumeId((prev) => prev || r[0].id);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onStart = async () => {
    if (!resumeId) return;
    setStarting(true);
    setError(null);
    try {
      const { session } = await startInterview({ resumeId, difficulty, questionCount });
      toast.show('Interview started.', 'success');
      navigate(`/interview/${session.id}`);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setStarting(false);
    }
  };

  if (loading) return <Spinner label="Loading interviews…" />;

  const inProgress = sessions.filter((s) => s.status === 'in_progress');
  const completed = sessions.filter((s) => s.status === 'completed');
  const analyzed = resumes.some((r) => r.analysis?.analyzedAt);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy-900">AI interview</h1>
        <p className="mt-1 text-sm text-slate-500">
          Personalized to your resume, one question at a time. Questions come from a curated
          bank and deterministic personalization — not a generative language model. Answers are
          scored against question-specific rubrics by the local engine.
        </p>
      </div>

      {error ? <Alert>{error}</Alert> : null}

      {resumes.length === 0 ? (
        <EmptyState
          title="Upload a resume first"
          description="The interview is built from your resume's skills, projects, experience and analysis findings."
          action={
            <Link to="/resume/upload">
              <Button>Upload resume</Button>
            </Link>
          }
        />
      ) : (
        <Card>
          <SectionTitle
            title="Start a new interview"
            subtitle="Choose the resume, difficulty and number of questions"
          />
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="label" htmlFor="int-resume">
                Resume
              </label>
              <select
                id="int-resume"
                className="input"
                value={resumeId}
                onChange={(e) => setResumeId(e.target.value)}
              >
                {resumes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.originalName} · {formatDate(r.createdAt)}
                  </option>
                ))}
              </select>
              {!analyzed ? (
                <p className="mt-1 text-xs text-amber-700">
                  Tip: run resume analysis first so findings can drive verification questions.
                </p>
              ) : null}
            </div>
            <div>
              <label className="label" htmlFor="int-difficulty">
                Difficulty
              </label>
              <select
                id="int-difficulty"
                className="input"
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as Difficulty)}
              >
                {(['Beginner', 'Intermediate', 'Advanced'] as Difficulty[]).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">{DIFFICULTY_HELP[difficulty]}</p>
            </div>
            <div>
              <label className="label" htmlFor="int-count">
                Questions
              </label>
              <select
                id="int-count"
                className="input"
                value={questionCount}
                onChange={(e) => setQuestionCount(Number(e.target.value))}
              >
                {[5, 8, 10, 12].map((n) => (
                  <option key={n} value={n}>
                    {n} questions
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              Progress is saved after every answer, so you can resume later.
            </p>
            <Button onClick={() => void onStart()} disabled={starting || !resumeId}>
              {starting ? 'Preparing questions…' : 'Start AI interview'}
            </Button>
          </div>
        </Card>
      )}

      {inProgress.length > 0 ? (
        <Card>
          <SectionTitle title="In progress" subtitle="Continue where you left off" />
          <ul className="divide-y divide-slate-100">
            {inProgress.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <div className="text-sm font-medium text-navy-900">
                    {s.difficulty} interview · {s.answered}/{s.totalQuestions} answered
                  </div>
                  <div className="text-xs text-slate-500">Started {formatDate(s.startedAt)}</div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-32">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                      <div
                        className="h-2 rounded-full bg-navy-600"
                        style={{
                          width: `${s.totalQuestions ? Math.round((s.answered / s.totalQuestions) * 100) : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                  <Button variant="secondary" onClick={() => navigate(`/interview/${s.id}`)}>
                    Continue
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <SectionTitle title="Interview history" subtitle="Completed interviews and scores" />
        {completed.length === 0 ? (
          <p className="text-sm text-slate-500">No completed interviews yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {completed.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium text-navy-900">
                    {s.difficulty} interview
                    <Badge color={difficultyBadgeColor(s.difficulty)}>{s.difficulty}</Badge>
                  </div>
                  <div className="text-xs text-slate-500">
                    {s.answered} answered · completed {formatDate(s.completedAt ?? s.startedAt)}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-lg font-bold text-navy-900">{s.score ?? 0}%</span>
                  <Button
                    variant="secondary"
                    onClick={() => navigate(`/interview/results/${s.id}`)}
                  >
                    View results
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
