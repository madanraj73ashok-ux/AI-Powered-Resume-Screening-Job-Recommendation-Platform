import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { startAssessment, submitAssessmentAnswer, getAssessmentStatus, resetAssessment } from '../api/interviews';
import { ApiError } from '../middleware/errors';

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

export function AssessmentTestPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { assessmentId } = useParams<{ assessmentId: string }>();
  const [loading, setLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const [assessment, setAssessment] = useState<any>(null);
  const [questions, setQuestions] = useState<AssessmentQuestion[]>([]);
  const [progress, setProgress] = useState<AssessmentProgress>({ answered: 0, total: 0, percentage: 0 });
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [showReview, setShowReview] = useState(false);
  const [reviewAnswers, setReviewAnswers] = useState<string[]>([]);
  const timerRef = useRef<number | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);

  useEffect(() => {
    if (!assessmentId) {
      setLoading(true);
      // Start a new assessment
      // This will be handled after resume selection
      return;
    }

    fetchAssessmentStatus();
  }, [assessmentId]);

  const fetchAssessmentStatus = async () => {
    try {
      setLoading(true);
      const result = await getAssessmentStatus(assessmentId, user!.id);
      setAssessment(result.assessment);
      setQuestions(result.questions.map((q: any) => ({
        id: q.id,
        type: q.type,
        question: q.question,
        options: q.options,
        isAnswered: q.isAnswered,
        selectedAnswer: undefined,
      })));
      setProgress(result.progress);
    } catch (err) {
      console.error('Failed to fetch assessment status:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (questions.length > 0 && !timerRef.current) {
      setTimeLeft(30 * 60); // 30 minutes
      timerRef.current = window.setInterval(() => {
        setTimeLeft((prev) => {
          if (prev <= 0) {
            window.clearInterval(timerRef.current!);
            submitAnswer('', '');
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

  const handleAnswerSubmit = async (questionId: string, answerText: string) => {
    try {
      const result = await submitAssessmentAnswer(assessmentId!, {
        questionId,
        text: answerText,
      });

      // Update question state
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
        clearTimeout(timerRef.current!);
        timerRef.current = null;
      } else {
        // Auto-advance to next question after a brief delay
        setCurrentQuestionIndex((prev) => prev + 1);
      }
    } catch (err) {
      console.error('Failed to submit answer:', err);
    }
  };

  const handleReset = async () => {
    try {
      await resetAssessment(assessmentId!, user!.id);
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
        <div className="max-w-2xl mx-auto bg-white rounded-lg p-6 shadow-lg">
          <h2 className="text-2xl font-bold mb-6">Start Assessment</h2>
          <p className="text-navy-600 mb-6">
            Please select a resume to generate an assessment test based on the skills and experience listed.
          </p>
          {/* Resume selection would go here */}
          <button className="btn-primary w-full py-3 rounded-lg">
            Select Resume and Start Assessment
          </button>
        </div>
      </div>
    );
  }

  if (showResults || !assessment) {
    return renderResultsPage();
  }

  // Render the current question
  const currentQuestion = questions[currentQuestionIndex];
  const isLast = currentQuestionIndex >= questions.length - 1;

  if (showReview) {
    return renderReviewPage();
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <nav className="bg-navy-900 py-4 px-6 shadow-sm">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold text-navy-100">Assessment Test</h1>
            <p className="text-navy-300 text-sm">Question {currentQuestionIndex + 1} of {questions.length}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-navy-300 text-sm">Time left: </span>
            <span 
              className={`text-navy-200 font-medium ${timeLeft <= 60 ? 'text-red-500' : ''}`}

            >
              {formatTime(timeLeft)}
            </span>
          </div>
        </div>
      </nav>

      <main className="max-w-7xl mx-auto px-6 py-8">
        {/* Progress Bar */}
        <div className="mb-6">
          <div className="flex justify-between text-sm text-navy-500 mb-2">
            <span>Answered: {progress.answered} / {progress.total}</span>
            <span>Score: {progress.percentage}%</span>
          </div>
          <div className="bg-navy-100 rounded-full h-2 overflow-hidden">
            <div 
              className={`bg-sky-500 h-2 rounded-full transition-width ${progress.percentage}%`}
              style={{ width: `${progress.percentage}%` }}
            ></div>
          </div>
        </div>

        {/* Question Area */}
        <div className="bg-white rounded-lg p-6 shadow-md mb-8">
          <h2 className="text-xl font-bold text-navy-900 mb-4">
            {currentQuestion ? currentQuestion.question : 'Loading...'}
          </h2>

          {currentQuestion?.options && currentQuestion.options.length > 0 && !isLast ? (
            <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
              {currentQuestion.options.map((option, idx) => (
                <label key={idx} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="answer"
                    value={option}
                    className="rounded border-navy-400 accent-navy-500"
                    onChange={(e) => {
                      // Update selected answer in state
                      setQuestions((prev) =>
                        prev.map((q) => {
                          if (q.id === currentQuestion?.id) {
                            return {
                              ...q,
                              selectedAnswer: e.target.value,
                            };
                          }
                          return q;
                        })
                      );
                    }}
                  />
                  <span className="text-navy-600">{option}</span>
                </label>
              ))}
              <button
                type="submit"
                disabled={!currentQuestion?.selectedAnswer}
                className="w-full py-2.5 bg-navy-600 text-white rounded-lg font-medium hover:bg-navy-700 transition"
              >
                {isLast ? 'Finish Test' : 'Next Question'}
              </button>
            </form>
          ) : isLast && currentQuestion ? (
            <form onSubmit={(e) => e.preventDefault()} className="space-y-4">
              <p className="text-navy-600 mb-4">
                This is the final question. Your assessment will be automatically submitted upon completion.
              </p>
              <button
                type="submit"
                disabled={!currentQuestion?.selectedAnswer}
                className="w-full py-2.5 bg-navy-600 text-white rounded-lg font-medium hover:bg-navy-700 transition"
              >
                Finish Assessment
              </button>
            </form>
          ) : (
            <p className="text-navy-400">Review answers in progress...</p>
          )}
        </div>

        {/* Navigation controls for non-last questions */}
        {!isLast && currentQuestionIndex > 0 && !showReview ? (
          <div className="mt-6 pt-6 border-t border-navy-200">
            <button
              onClick={() => setCurrentQuestionIndex((prev) => Math.max(0, prev - 1))}
              className="px-4 py-2 border border-navy-300 rounded-lg text-navy-600 hover:bg-navy-50 transition"
            >
              Previous
            </button>
          </div>
        ) : null}
      </main>
    </div>
  );
}

function formatTime(totalSeconds: number): string {
  const mins = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
}

function renderResultsPage() {
  if (!assessment) {
    return <div>Assessment not found</div>;
  }

  const passed = assessment.score >= (assessment.thresholds?.passScore ?? 50);
  const canRetake = assessment.canRetake();

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="max-w-3xl mx-auto bg-white rounded-lg p-6 shadow-lg">
        <h2 className="text-2xl font-bold mb-6">Assessment Results</h2>

        <div className="mb-4">
          <p className="text-navy-600 font-medium">Score: {assessment.score}%</p>
          <p className={`text-navy-300 ${passed ? 'text-green-600' : 'text-red-600'}`}>
            {passed ? 'Congratulations! You passed the assessment.' : 'You need a minimum of 50% to pass.'}
          </p>
        </div>

        {assessment.answers.length > 0 && (
          <div className="mt-6 p-4 bg-navy-50 rounded-lg mb-6">
            <h3 className="text-sm font-medium text-navy-600 mb-2">Answers Summary</h3>
            <p className="text-navy-500 text-sm">
              {assessment.answeredCount} of {assessment.questionCount} questions answered
            </p>
          </div>
        )}

        <div className="space-y-4">
          {canRetake ? (
            <button
              onClick={handleReset}
              className="w-full py-2.5 bg-amber-500 text-navy-950 rounded-lg font-medium hover:bg-amber-400 transition"
            >
              Retake Assessment (after {Math.max(0, 7 - Math.floor((Date.now() - (assessment.completedAt?.getTime() || 0)) / (1000 * 60 * 60 * 24)))} days remaining)
            </button>
          ) : (
            <p className="text-navy-400">Retake not available for {7 - (assessment.completedAt ? Math.floor((Date.now() - assessment.completedAt.getTime()) / (1000 * 60 * 60 * 24)) : 7)} more days</p>
          )}
        </div>

        <button
          onClick={() => navigate('/assessment', { replace: true })}
          className="w-full py-2.5 bg-navy-600 text-white rounded-lg font-medium hover:bg-navy-700 transition mt-4"
        >
          Return to Dashboard
        </button>
      </div>
    </div>
  );
}