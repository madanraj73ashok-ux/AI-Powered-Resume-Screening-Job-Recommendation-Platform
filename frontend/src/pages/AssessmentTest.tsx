import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { submitAssessmentAnswer, getAssessmentStatus, resetAssessment } from '../api/interviews';

interface AssessmentQuestion {
  id: string;
  type: string;
  question: string;
  options?: string[];
  isAnswered: boolean;
  selectedAnswer?: string;
}

interface AssessmentProgress {
  answered: number;
  total: number;
  percentage: number;
}

function formatTime(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

export function AssessmentTestPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { assessmentId } = useParams<{ assessmentId: string }>();
  const [_loading, setLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [assessment, setAssessment] = useState<any>(null);
  const [questions, setQuestions] = useState<AssessmentQuestion[]>([]);
  const [progress, setProgress] = useState<AssessmentProgress>({ answered: 0, total: 0, percentage: 0 });
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const timerRef = useRef<number | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);

  useEffect(() => {
    if (!assessmentId || !user) {
      setLoading(true);
      return;
    }

    const fetchAssessmentStatus = async () => {
      try {
        setLoading(true);
        const result = await getAssessmentStatus(assessmentId, user.id);
        setAssessment(result.assessment);
        setQuestions(
          (result.questions || []).map((q: any) => ({
            id: q.id,
            type: q.type,
            question: q.question,
            options: q.options,
            isAnswered: q.isAnswered,
            selectedAnswer: undefined,
          }))
        );
        setProgress(result.progress);
      } catch (err) {
        console.error('Failed to fetch assessment status:', err);
      } finally {
        setLoading(false);
      }
    };

    void fetchAssessmentStatus();
  }, [assessmentId, user]);

  const handleAnswerSubmit = async (questionId: string, answerText: string) => {
    if (!assessmentId) return;
    try {
      const result = await submitAssessmentAnswer(assessmentId, {
        questionId,
        text: answerText,
      });

      setQuestions((prevQuestions) =>
        prevQuestions.map((q) => {
          if (q.id === questionId) {
            return {
              ...q,
              isAnswered: true,
              selectedAnswer: answerText,
            };
          }
          return q;
        })
      );

      setProgress(result.progress);

      if (result.isLast) {
        setShowResults(true);
        if (timerRef.current) {
          window.clearInterval(timerRef.current);
          timerRef.current = null;
        }
      } else {
        setCurrentQuestionIndex((prev) => prev + 1);
      }
    } catch (err) {
      console.error('Failed to submit answer:', err);
    }
  };

  useEffect(() => {
    if (questions.length > 0 && !timerRef.current) {
      setTimeLeft(30 * 60); // 30 minutes
      timerRef.current = window.setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 0) {
            if (timerRef.current) window.clearInterval(timerRef.current);
            void handleAnswerSubmit('', '');
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    }

    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [questions.length]);

  const handleReset = async () => {
    if (!assessmentId || !user) return;
    try {
      await resetAssessment(assessmentId, user.id);
      setAssessment(null);
      setQuestions([]);
      setProgress({ answered: 0, total: 0, percentage: 0 });
      setCurrentQuestionIndex(0);
      setShowResults(false);
      navigate('/assessment', { replace: true });
    } catch (err) {
      console.error('Failed to reset assessment:', err);
    }
  };

  if (!assessmentId) {
    return (
      <div className="min-h-screen bg-slate-50 p-8">
        <div className="mx-auto max-w-2xl rounded-lg bg-white p-6 shadow-lg">
          <h2 className="mb-6 text-2xl font-bold">Start Assessment</h2>
          <p className="mb-6 text-navy-600">
            Please select a resume to generate an assessment test based on the skills and experience listed.
          </p>
          <button
            onClick={() => navigate('/interview')}
            className="w-full rounded-lg bg-navy-600 py-3 text-white hover:bg-navy-700"
          >
            Go to AI Interview
          </button>
        </div>
      </div>
    );
  }

  if (showResults || !assessment) {
    return (
      <div className="min-h-screen bg-slate-50 p-8">
        <div className="mx-auto max-w-3xl rounded-lg bg-white p-6 shadow-lg">
          <h2 className="mb-6 text-2xl font-bold">Assessment Results</h2>
          {assessment ? (
            <>
              <div className="mb-4">
                <p className="font-medium text-navy-600">Score: {assessment.score ?? 0}%</p>
                <p className="text-slate-600">
                  {assessment.answeredCount ?? 0} of {assessment.questionCount ?? 0} questions answered
                </p>
              </div>
              <div className="space-y-4">
                <button
                  onClick={handleReset}
                  className="w-full rounded-lg bg-amber-500 py-2.5 font-medium text-navy-950 transition hover:bg-amber-400"
                >
                  Retake Assessment
                </button>
              </div>
            </>
          ) : (
            <p className="text-slate-500">Loading results…</p>
          )}
          <button
            onClick={() => navigate('/', { replace: true })}
            className="mt-4 w-full rounded-lg bg-navy-600 py-2.5 font-medium text-white transition hover:bg-navy-700"
          >
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const currentQuestion = questions[currentQuestionIndex];
  const isLast = currentQuestionIndex >= questions.length - 1;

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="bg-navy-900 px-6 py-4 shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-navy-100">Assessment Test</h1>
            <p className="text-sm text-navy-300">
              Question {currentQuestionIndex + 1} of {questions.length}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-navy-300">Time left: </span>
            <span className={`font-medium text-navy-200 ${timeLeft <= 60 ? 'text-red-500' : ''}`}>
              {formatTime(timeLeft)}
            </span>
          </div>
        </div>
      </nav>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6">
          <div className="mb-2 flex justify-between text-sm text-navy-500">
            <span>
              Answered: {progress.answered} / {progress.total}
            </span>
            <span>Score: {progress.percentage}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-navy-100">
            <div
              className="h-2 rounded-full bg-sky-500 transition-all"
              style={{ width: `${progress.percentage}%` }}
            />
          </div>
        </div>

        <div className="mb-8 rounded-lg bg-white p-6 shadow-md">
          <h2 className="mb-4 text-xl font-bold text-navy-900">
            {currentQuestion ? currentQuestion.question : 'Loading...'}
          </h2>

          {currentQuestion?.options && currentQuestion.options.length > 0 ? (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (currentQuestion?.selectedAnswer) {
                  void handleAnswerSubmit(currentQuestion.id, currentQuestion.selectedAnswer);
                }
              }}
              className="space-y-4"
            >
              {currentQuestion.options.map((option, idx) => (
                <label key={idx} className="flex cursor-pointer items-center gap-2">
                  <input
                    type="radio"
                    name="answer"
                    value={option}
                    checked={currentQuestion.selectedAnswer === option}
                    className="accent-navy-500"
                    onChange={(e) => {
                      setQuestions((prev) =>
                        prev.map((q) =>
                          q.id === currentQuestion?.id
                            ? { ...q, selectedAnswer: e.target.value }
                            : q
                        )
                      );
                    }}
                  />
                  <span className="text-navy-600">{option}</span>
                </label>
              ))}
              <button
                type="submit"
                disabled={!currentQuestion?.selectedAnswer}
                className="w-full rounded-lg bg-navy-600 py-2.5 font-medium text-white transition hover:bg-navy-700 disabled:opacity-50"
              >
                {isLast ? 'Finish Assessment' : 'Next Question'}
              </button>
            </form>
          ) : (
            <p className="text-navy-400">Loading question…</p>
          )}
        </div>

        {!isLast && currentQuestionIndex > 0 ? (
          <div className="mt-6 border-t border-navy-200 pt-6">
            <button
              onClick={() => setCurrentQuestionIndex((prev) => Math.max(0, prev - 1))}
              className="rounded-lg border border-navy-300 px-4 py-2 text-navy-600 transition hover:bg-navy-50"
            >
              Previous
            </button>
          </div>
        ) : null}
      </main>
    </div>
  );
}

export default AssessmentTestPage;