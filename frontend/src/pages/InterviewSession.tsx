import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { apiErrorMessage } from '../api/client';
import {
  completeInterview,
  difficultyBadgeColor,
  Evaluation,
  getInterview,
  InterviewProgress,
  InterviewQuestion,
  InterviewSession,
  submitAnswer,
} from '../api/interviews';
import { Alert, Badge, Button, Card, SectionTitle, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import { useAuth } from '../context/AuthContext';

const RUBRIC_LABELS: Record<string, string> = {
  technicalAccuracy: 'Technical accuracy',
  completeness: 'Completeness',
  practicalExamples: 'Practical examples',
  understanding: 'Understanding',
};

export default function InterviewSessionPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useAuth();

  const [session, setSession] = useState<InterviewSession | null>(null);
  const [progress, setProgress] = useState<InterviewProgress | null>(null);
  const [question, setQuestion] = useState<InterviewQuestion | null>(null);
  const [answer, setAnswer] = useState('');
  const [evaluation, setEvaluation] = useState<Evaluation | null>(null);
  const [nextQuestion, setNextQuestion] = useState<InterviewQuestion | null>(null);
  const [isLast, setIsLast] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [confirmFinish, setConfirmFinish] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await getInterview(id);
      if (data.session.status === 'completed') {
        // Idempotently repair report creation if a prior completion was interrupted.
        await completeInterview(id);
        navigate(`/interview/results/${id}`, { replace: true });
        return;
      }
      setSession(data.session);
      setProgress(data.progress);
      setQuestion(data.progress.currentQuestion);
      setEvaluation(null);
      setAnswer(data.session.live?.draftQuestionId === data.progress.currentQuestion?.id ? data.session.live?.draftTranscript ?? '' : '');
      setIsLast(!data.progress.currentQuestion);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [id, navigate]);

  useEffect(() => {
    void load();
  }, [load]);

  const onSubmit = async () => {
    if (!id || !question || !answer.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await submitAnswer(id, question.id, answer);
      setEvaluation(res.evaluation);
      setIsLast(res.isLastQuestion || !res.nextQuestion);
      setProgress((prev) =>
        prev
          ? {
              ...prev,
              answered: res.progress.answered,
              total: res.progress.total,
              percentage: res.progress.percentage,
              currentQuestion: res.nextQuestion,
            }
          : prev
      );
      // Stash the next question until the user continues.
      setNextQuestion(res.nextQuestion);
      toast.show('Answer saved and scored.', 'success');
    } catch (err) {
      setError(apiErrorMessage(err));
      toast.show('Could not submit the answer.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  const onContinue = () => {
    if (!nextQuestion) return;
    setQuestion(nextQuestion);
    setEvaluation(null);
    setAnswer('');
    setNextQuestion(null);
  };

  const onFinish = async () => {
    if (!id) return;
    setFinishing(true);
    setError(null);
    try {
      await completeInterview(id);
      toast.show('Interview completed.', 'success');
      navigate(`/interview/results/${id}`);
    } catch (err) {
      setError(apiErrorMessage(err));
      setFinishing(false);
    }
  };

  if (loading) return <Spinner label="Loading interview…" />;
  if (!session || !progress) {
    return (
      <div className="space-y-4">
        <Alert>{error ?? 'Interview could not be loaded.'}</Alert>
        <Link to="/interview" className="text-sm font-medium text-navy-700 underline">
          Back to interviews
        </Link>
      </div>
    );
  }

  const questionNumber = Math.min(progress.answered + (evaluation ? 0 : 1), progress.total);

  return (
    <div className="space-y-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h1 className="text-2xl font-bold text-navy-900">AI interview</h1>
          <p className="mt-1 text-sm text-slate-500">
            Personalized to your resume · <Badge color={difficultyBadgeColor(session.difficulty)}>
              {session.difficulty}
            </Badge>
          </p>
        </div>
        <Link to="/interview" className="text-sm font-medium text-navy-700 hover:underline">
          ← Save &amp; exit (progress is saved)
        </Link>
      </div>

      <Card>
        <div className="mb-2 flex items-center justify-between text-sm text-slate-600">
          <span aria-live="polite">
            Question {questionNumber} of {progress.total}
          </span>
          <span>
            {progress.answered} answered · {progress.percentage}%
          </span>
        </div>
        <div role="progressbar" aria-label="Interview progress" aria-valuenow={progress.percentage} aria-valuemin={0} aria-valuemax={100} className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-2 rounded-full bg-navy-600 transition-all"
            style={{ width: `${progress.percentage}%` }}
          />
        </div>
      </Card>

      {error ? <Alert>{error}</Alert> : null}

      {progress.answered === 0 ? (
        <Card className="border-l-4 border-l-navy-500 bg-slate-50">
          <p className="text-sm leading-relaxed text-slate-700">
            <span className="font-semibold text-navy-900">Interviewer:</span> Welcome
            {user?.name ? `, ${user.name.split(' ')[0]}` : ''}. I&apos;ll ask you{' '}
            {progress.total} questions at {session.difficulty.toLowerCase()} level, built from the
            skills, projects and analysis findings in your resume. Take as long as you need on each
            answer — nothing is submitted until you press <em>Submit answer</em>, and you can save
            &amp; exit at any point and resume later.
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Questions are assembled locally by rule-based templates from your resume; they are not
            generated by a large language model.
          </p>
        </Card>
      ) : null}

      {question && !evaluation ? (
        <Card>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <Badge color="navy">{question.type.replace('_', ' ')}</Badge>
            <Badge color={difficultyBadgeColor(question.difficulty)}>{question.difficulty}</Badge>
            {question.skill ? <Badge color="slate">{question.skill}</Badge> : null}
            {question.isFollowUp ? <Badge color="amber">follow-up</Badge> : null}
            <span className="text-xs text-slate-500">{question.maxMarks} marks</span>
          </div>
          {question.sourceClaim ? (
            <p className="mb-2 text-xs italic text-slate-500">
              Based on your resume: “{question.sourceClaim}”
            </p>
          ) : null}
          <h2 className="text-lg font-semibold leading-relaxed text-navy-900">
            {question.text}
          </h2>
          <p className="mt-2 text-xs text-slate-500">
            Scored on technical accuracy, completeness, practical examples and demonstrated
            understanding. No personality or honesty inference is made.
          </p>
          {question.rubric && session.mode !== 'voice' ? (
            <details className="mt-3 text-sm text-slate-600">
              <summary className="cursor-pointer font-medium">Scoring rubric for this question</summary>
              <ul className="mt-2 space-y-1">
                {Object.entries(question.rubric).map(([key, guidance]) => (
                  <li key={key}><strong>{RUBRIC_LABELS[key] ?? key}:</strong> {guidance}</li>
                ))}
              </ul>
            </details>
          ) : null}
          <div className="mt-4">
            <label className="label" htmlFor="answer">
              Your answer
            </label>
            <textarea
              id="answer"
              className="input min-h-[160px]"
              placeholder="Explain your reasoning, give a concrete example, and mention trade-offs where relevant…"
              value={answer}
              maxLength={8000}
              onChange={(e) => setAnswer(e.target.value)}
              disabled={submitting}
            />
            <div className="mt-1 flex justify-between text-xs text-slate-500">
              <span>{answer.trim().split(/\s+/).filter(Boolean).length} words</span>
              <span>{answer.length}/8000 characters · Saved on submit</span>
            </div>
          </div>
          <div className="mt-4 flex justify-end">
            <Button onClick={() => void onSubmit()} disabled={submitting || !answer.trim()}>
              {submitting ? 'Submitting…' : 'Submit answer'}
            </Button>
          </div>
        </Card>
      ) : null}

      {evaluation ? (
        <Card>
          <SectionTitle
            title="Answer evaluation"
            subtitle="Rubric-based local scoring with the concepts your answer covered"
          />
          <div className="flex flex-wrap items-baseline gap-3">
            <span className="text-3xl font-bold text-navy-900">{evaluation.percentage}%</span>
            <span className="text-sm text-slate-600">
              {evaluation.marksAwarded} / {evaluation.maxMarks} marks
            </span>
          </div>
          <p className="mt-2 text-sm text-slate-700">{evaluation.explanation}</p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {Object.entries(evaluation.breakdown).map(([key, value]) => (
              <div key={key}>
                <div className="mb-1 flex justify-between text-xs text-slate-600">
                  <span>{RUBRIC_LABELS[key] ?? key}</span>
                  <span>{Math.round(value * 100)}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
                  <div
                    className="h-1.5 rounded-full bg-navy-500"
                    style={{ width: `${Math.round(value * 100)}%` }}
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {evaluation.matchedConcepts.map((c) => (
              <span
                key={c}
                className="rounded-full bg-green-50 px-2.5 py-1 text-xs font-medium text-green-800 ring-1 ring-green-100"
              >
                ✓ {c}
              </span>
            ))}
            {evaluation.missingConcepts.map((c) => (
              <span
                key={c}
                className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-100"
              >
                missing: {c}
              </span>
            ))}
          </div>

          {nextQuestion?.isFollowUp ? (
            <p className="mt-3 rounded-lg bg-navy-50 px-3 py-2 text-xs text-navy-800">
              <span className="font-semibold">Follow-up prepared:</span>{' '}
              {nextQuestion.text}
            </p>
          ) : null}

          <div className="mt-4 flex justify-end gap-2">
            {isLast ? (
              <Button onClick={() => setConfirmFinish(true)} disabled={finishing}>
                Finish interview
              </Button>
            ) : (
              <Button onClick={onContinue}>Next question</Button>
            )}
          </div>
        </Card>
      ) : null}

      {progress.answered > 0 && !confirmFinish && (!evaluation || !isLast) ? (
        <Card>
          <p className="mb-3 text-sm text-slate-600">
            {isLast ? 'All answers are saved. Finish to generate your report.' :
              'You can finish early. Unanswered questions receive zero marks.'}
          </p>
          <Button variant="secondary" onClick={() => setConfirmFinish(true)} disabled={submitting || finishing}>
            Finish interview
          </Button>
        </Card>
      ) : null}

      {confirmFinish ? (
        <Card>
          <SectionTitle
            title="Finish the interview?"
            subtitle="Your answers are already saved. Finishing generates your result dashboard."
          />
          <p className="mb-4 text-sm text-slate-600">
            {progress.answered} of {progress.total} questions answered.
            {progress.answered < progress.total ? ' Unanswered questions receive zero marks. Any unsubmitted answer will be discarded.' : ''}
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirmFinish(false)} disabled={finishing}>
              Cancel
            </Button>
            <Button onClick={() => void onFinish()} disabled={finishing}>
              {finishing ? 'Generating results…' : 'Yes, finish and view results'}
            </Button>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
