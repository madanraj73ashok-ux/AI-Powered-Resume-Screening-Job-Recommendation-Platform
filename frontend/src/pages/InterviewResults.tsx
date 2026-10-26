import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiErrorMessage } from '../api/client';
import {
  difficultyBadgeColor,
  getInterview,
  getInterviewResult,
  InterviewAnswer,
  InterviewQuestion,
  InterviewResult,
  InterviewSession,
  listInterviews,
  SessionSummary,
} from '../api/interviews';
import { formatDate } from '../api/resumes';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  SectionTitle,
  Spinner,
} from '../components/ui';

function ScoreRing({ percentage }: { percentage: number }) {
  const color =
    percentage >= 70 ? 'text-green-700' : percentage >= 50 ? 'text-amber-600' : 'text-red-600';
  return (
    <div className="flex flex-col items-center">
      <div className={`text-5xl font-bold ${color}`}>{percentage}%</div>
      <div className="mt-1 text-xs uppercase tracking-wide text-slate-500">Overall score</div>
    </div>
  );
}

export default function InterviewResultsPage() {
  const { id } = useParams<{ id: string }>();
  return id ? <ResultDetail id={id} /> : <ResultList />;
}

function ResultList() {
  const navigate = useNavigate();
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setSessions(await listInterviews());
      } catch (err) {
        setError(apiErrorMessage(err));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <Spinner label="Loading results…" />;

  const completed = sessions.filter((s) => s.status === 'completed');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy-900">Interview results</h1>
        <p className="mt-1 text-sm text-slate-500">
          Rubric-based technical assessments of your answers. Scores reflect demonstrated
          technical content, not personality or intelligence.
        </p>
      </div>

      {error ? <Alert>{error}</Alert> : null}

      {completed.length === 0 ? (
        <EmptyState
          title="No completed interviews"
          description="Finish an AI interview to see your overall score, skill-wise performance, strengths and improvement recommendations."
          action={
            <Link to="/interview">
              <Button>Go to AI interview</Button>
            </Link>
          }
        />
      ) : (
        <Card>
          <SectionTitle title="Completed interviews" />
          <ul className="divide-y divide-slate-100">
            {completed.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-navy-900">
                      {s.difficulty} interview
                    </span>
                    <Badge color={difficultyBadgeColor(s.difficulty)}>{s.difficulty}</Badge>
                  </div>
                  <div className="text-xs text-slate-500">
                    {s.answered}/{s.totalQuestions} answered ·{' '}
                    {formatDate(s.completedAt ?? s.startedAt)}
                  </div>
                </div>
                <div className="flex items-center gap-4">
                  <span className="text-xl font-bold text-navy-900">{s.score ?? 0}%</span>
                  <Button
                    variant="secondary"
                    onClick={() => navigate(`/interview/results/${s.id}`)}
                  >
                    Open report
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function ResultDetail({ id }: { id: string }) {
  const [result, setResult] = useState<InterviewResult | null>(null);
  const [session, setSession] = useState<InterviewSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([getInterviewResult(id), getInterview(id)]);
      setResult(r);
      setSession(s.session);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) return <Spinner label="Loading your report…" />;
  if (error || !result) {
    return (
      <div className="space-y-4">
        <Alert>{error ?? 'Result not found.'}</Alert>
        <Link to="/interview/results" className="text-sm font-medium text-navy-700 underline">
          Back to results
        </Link>
      </div>
    );
  }

  const answersByQuestion = new Map<string, InterviewAnswer>(
    (session?.answers ?? []).map((a) => [a.questionId, a])
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">Interview report</h1>
          <p className="mt-1 text-sm text-slate-500">
            <Badge color={difficultyBadgeColor(result.difficulty)}>{result.difficulty}</Badge>{' '}
            · {result.answeredCount}/{result.questionCount} answered ·{' '}
            {formatDate(result.createdAt)}
          </p>
        </div>
        <div className="flex gap-2">
          <Link to="/interview">
            <Button variant="secondary">New interview</Button>
          </Link>
          <Link to="/interview/results">
            <Button variant="ghost">All results</Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="flex flex-col items-center justify-center">
          <ScoreRing percentage={result.overall.percentage} />
          <div className="mt-2 text-xs text-slate-500">
            {result.overall.marksAwarded} / {result.overall.maxMarks} marks
          </div>
        </Card>
        <Card className="md:col-span-2">
          <SectionTitle title="Skill-wise performance" subtitle="Marks grouped by question skill" />
          {result.skillScores.length === 0 ? (
            <p className="text-sm text-slate-500">No skill breakdown available.</p>
          ) : (
            <ul className="space-y-2">
              {result.skillScores.map((s) => (
                <li key={s.skill}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="font-medium text-navy-900">{s.skill}</span>
                    <span className="text-slate-600">
                      {s.percentage}% ({s.marksAwarded}/{s.maxMarks})
                    </span>
                  </div>
                  <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                    <div
                      className={`h-2 rounded-full ${
                        s.percentage >= 70
                          ? 'bg-green-600'
                          : s.percentage >= 50
                            ? 'bg-amber-500'
                            : 'bg-red-500'
                      }`}
                      style={{ width: `${s.percentage}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <SectionTitle title="Strengths" />
          {result.strengths.length === 0 ? (
            <p className="text-sm text-slate-500">
              No skill reached the strong-evidence threshold in this interview. Use the
              recommendations below to build one.
            </p>
          ) : (
            <ul className="space-y-2 text-sm text-slate-700">
              {result.strengths.map((s) => (
                <li key={s} className="flex gap-2">
                  <span className="text-green-600">✓</span>
                  {s}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <SectionTitle title="Areas needing improvement" />
          {result.improvements.length === 0 ? (
            <p className="text-sm text-slate-500">
              No weak areas below the threshold — keep practising with longer, example-rich
              answers.
            </p>
          ) : (
            <ul className="space-y-2 text-sm text-slate-700">
              {result.improvements.map((s) => (
                <li key={s} className="flex gap-2">
                  <span className="text-amber-600">!</span>
                  {s}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {result.missingConcepts.length > 0 ? (
        <Card>
          <SectionTitle
            title="Concepts to review"
            subtitle="Expected concepts that answers did not cover"
          />
          <div className="flex flex-wrap gap-2">
            {result.missingConcepts.map((c) => (
              <span
                key={c}
                className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-100"
              >
                {c}
              </span>
            ))}
          </div>
          {result.recommendations.length > 0 ? (
            <ul className="mt-3 space-y-1 text-sm text-slate-700">
              {result.recommendations.map((r) => (
                <li key={r}>• {r}</li>
              ))}
            </ul>
          ) : null}
        </Card>
      ) : null}

      <Card>
        <SectionTitle
          title="Question-by-question review"
          subtitle="Your answers, marks and the rubric explanation"
        />
        {!session ? (
          <p className="text-sm text-slate-500">Session details unavailable.</p>
        ) : (
          <ul className="space-y-4">
            {session.questions.map((q: InterviewQuestion, i: number) => {
              const a = answersByQuestion.get(q.id);
              return (
                <li key={q.id} className="rounded-lg border border-slate-200 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-semibold text-navy-900">
                      {i + 1}. {q.text}
                    </div>
                    {a ? (
                      <Badge
                        color={
                          a.percentage >= 70
                            ? 'green'
                            : a.percentage >= 50
                              ? 'amber'
                              : 'red'
                        }
                      >
                        {a.percentage}%
                      </Badge>
                    ) : (
                      <Badge color="slate">skipped</Badge>
                    )}
                  </div>
                  <div className="mt-1 text-xs text-slate-500">
                    {q.type.replace('_', ' ')} · {q.difficulty}
                    {q.skill ? ` · ${q.skill}` : ''} · {a ? `${a.marksAwarded}/${a.maxMarks} marks` : `0/${q.maxMarks} marks`}
                  </div>
                  {a ? (
                    <>
                      <p className="mt-2 rounded bg-slate-50 px-3 py-2 text-sm text-slate-700">
                        {a.text}
                      </p>
                      <p className="mt-2 text-xs text-slate-600">{a.explanation}</p>
                      {a.missingConcepts.length > 0 ? (
                        <p className="mt-1 text-xs text-amber-700">
                          Missing concepts: {a.missingConcepts.join(', ')}
                        </p>
                      ) : null}
                      {a.suggestedFollowUp ? (
                        <p className="mt-1 text-xs text-navy-700">
                          Suggested follow-up: {a.suggestedFollowUp}
                        </p>
                      ) : null}
                    </>
                  ) : (
                    <p className="mt-2 text-xs text-slate-500">
                      This question was not answered.
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      <Card>
        <p className="text-xs text-slate-500">
          {result.summary} Scores are produced by a local deterministic rubric engine
          (expected-concept matching and TF-IDF similarity). They are an aid for practice and
          review, not a hiring decision.
        </p>
      </Card>
    </div>
  );
}
