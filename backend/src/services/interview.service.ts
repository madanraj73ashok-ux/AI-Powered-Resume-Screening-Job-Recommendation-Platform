import { z } from 'zod';
import crypto from 'crypto';
import {
  InterviewSession,
  InterviewSessionDoc,
  InterviewQuestionDoc,
} from '../models/InterviewSession';
import { InterviewResult, InterviewResultDoc } from '../models/InterviewResult';
import { ApiError } from '../middleware/errors';
import {
  AiEngineError,
  generateQuestions,
  evaluateAnswer,
  EngineEvaluation,
} from './aiEngine';
import { getResumeOwned } from './resume.service';

export const startInterviewSchema = z.object({
  resumeId: z.string().min(1, 'A resume is required'),
  difficulty: z.enum(['Beginner', 'Intermediate', 'Advanced']).default('Intermediate'),
  questionCount: z.coerce.number().int().min(3).max(12).default(8),
});

export const submitAnswerSchema = z.object({
  questionId: z.string().min(1, 'questionId is required'),
  answer: z
    .string()
    .trim()
    .min(1, 'An answer is required')
    .max(8000, 'The answer is too long (max 8000 characters)'),
});

const FOLLOW_UP_MAX_MARKS = 5;
const MAX_TOTAL_QUESTIONS = 15;

function engineError(err: unknown): never {
  if (err instanceof AiEngineError) {
    throw new ApiError(err.status >= 500 ? 503 : 422, err.message);
  }
  throw err;
}

export async function startInterview(
  userId: string,
  input: { resumeId: string; difficulty: 'Beginner' | 'Intermediate' | 'Advanced'; questionCount: number }
): Promise<InterviewSessionDoc> {
  const resume = await getResumeOwned(input.resumeId, userId);
  if (!resume.fullText || !resume.fullText.trim()) {
    throw new ApiError(
      422,
      'This resume has no extractable text, so an interview cannot be generated from it.'
    );
  }

  let generation;
  try {
    generation = await generateQuestions({
      profile: resume.profile,
      findings: resume.analysis?.findings ?? [],
      difficulty: input.difficulty,
      count: input.questionCount,
      seed: `${resume._id.toString()}:${input.difficulty}`,
    });
  } catch (err) {
    engineError(err);
  }

  if (!generation.questions.length) {
    throw new ApiError(422, 'No questions could be generated from this resume.');
  }

  const questions: InterviewQuestionDoc[] = generation.questions.map((q) => ({
    id: q.id,
    text: q.text,
    type: q.type,
    difficulty: q.difficulty,
    skill: q.skill,
    sourceClaim: q.sourceClaim,
    expectedConcepts: q.expectedConcepts,
    rubric: q.rubric,
    maxMarks: q.maxMarks,
    followUpTemplates: q.followUpTemplates ?? [],
    isFollowUp: false,
  }));

  return InterviewSession.create({
    user: userId,
    resume: resume._id,
    difficulty: input.difficulty,
    status: 'in_progress',
    questions,
    totalQuestions: questions.length,
    currentIndex: 0,
    generator: generation.generatedBy,
  });
}

export async function listSessions(
  userId: string
): Promise<InterviewSessionDoc[]> {
  return InterviewSession.find({ user: userId })
    .sort({ startedAt: -1 })
    .limit(100);
}

export async function getSessionOwned(
  id: string,
  userId: string
): Promise<InterviewSessionDoc> {
  const session = await InterviewSession.findById(id);
  if (!session || session.user.toString() !== userId) {
    throw new ApiError(404, 'Interview session not found');
  }
  return session;
}

export interface SessionProgress {
  answered: number;
  total: number;
  percentage: number;
  currentQuestion: InterviewQuestionDoc | null;
  completed: boolean;
}

export function describeSession(session: InterviewSessionDoc): {
  session: InterviewSessionDoc;
  progress: SessionProgress;
} {
  const answered = session.answers.length;
  const total = session.questions.length;
  const currentQuestion = session.questions[session.currentIndex] ?? null;
  return {
    session,
    progress: {
      answered,
      total,
      percentage: total ? Math.round((answered / total) * 100) : 0,
      currentQuestion,
      completed: session.status === 'completed',
    },
  };
}

export interface SubmitAnswerResult {
  session: InterviewSessionDoc;
  evaluation: EngineEvaluation;
  nextQuestion: InterviewQuestionDoc | null;
  isLastQuestion: boolean;
}

export async function submitAnswer(
  id: string,
  userId: string,
  input: { questionId: string; answer: string }
): Promise<SubmitAnswerResult> {
  const session = await getSessionOwned(id, userId);
  if (session.status === 'completed') {
    throw new ApiError(400, 'This interview is already completed.');
  }

  const current = session.questions[session.currentIndex];
  if (!current) {
    throw new ApiError(400, 'No question is pending. Complete the interview instead.');
  }
  if (current.id !== input.questionId) {
    throw new ApiError(
      400,
      'This is not the current question. Reload the interview and answer the pending question.'
    );
  }
  if (session.answers.some((a) => a.questionId === input.questionId)) {
    throw new ApiError(400, 'This question has already been answered.');
  }

  let evaluation: EngineEvaluation;
  try {
    evaluation = await evaluateAnswer({
      question: current as unknown as Record<string, unknown>,
      answer: input.answer,
      difficulty: session.difficulty,
    });
  } catch (err) {
    engineError(err);
  }

  session.answers.push({
    questionId: current.id,
    text: input.answer,
    marksAwarded: evaluation.marksAwarded,
    maxMarks: evaluation.maxMarks,
    percentage: evaluation.percentage,
    explanation: evaluation.explanation,
    matchedConcepts: evaluation.matchedConcepts,
    missingConcepts: evaluation.missingConcepts,
    breakdown: evaluation.breakdown,
    similarity: evaluation.similarity,
    suggestedFollowUp: evaluation.suggestedFollowUp ?? undefined,
    answeredAt: new Date(),
  });

  // Answer-dependent follow-up: only for base questions, max one per question,
  // only when the answer leaves a meaningful gap, and within a hard question cap.
  const existingFollowUp = session.questions.some(
    (q) => q.isFollowUp && q.parentQuestionId === current.id
  );
  if (
    !current.isFollowUp &&
    !existingFollowUp &&
    evaluation.suggestedFollowUp &&
    evaluation.percentage < 70 &&
    session.questions.length < MAX_TOTAL_QUESTIONS
  ) {
    const followUp: InterviewQuestionDoc = {
      id: `Q${crypto.randomBytes(5).toString('hex')}`,
      text: evaluation.suggestedFollowUp,
      type: 'follow_up',
      difficulty: current.difficulty,
      skill: current.skill,
      sourceClaim: current.sourceClaim,
      expectedConcepts: evaluation.missingConcepts.length
        ? [evaluation.missingConcepts[0]]
        : ['example'],
      rubric: current.rubric,
      maxMarks: FOLLOW_UP_MAX_MARKS,
      followUpTemplates: [],
      isFollowUp: true,
      parentQuestionId: current.id,
    };
    session.questions.splice(session.currentIndex + 1, 0, followUp);
  }

  session.currentIndex += 1;
  session.totalQuestions = session.questions.length;
  await session.save();

  const nextQuestion = session.questions[session.currentIndex] ?? null;
  return {
    session,
    evaluation,
    nextQuestion,
    isLastQuestion: nextQuestion === null,
  };
}

function strengthText(skill: string, pct: number): string {
  return `Strong technical evidence in ${skill} (${pct}% on this interview).`;
}

function improvementText(skill: string, pct: number): string {
  return `${skill} needs more practice — a good topic to review and demonstrate in a project (${pct}%).`;
}

const LEARNING_MAP: Record<string, string> = {
  mutability: 'review mutable vs immutable data structures',
  index: 'review database indexing and query planning',
  overfitting: 'review model validation and regularization',
  'trade-offs': 'practice explaining technical trade-offs',
  testing: 'add automated tests to a small project',
  monitoring: 'learn basic observability (logs and metrics)',
  'event loop': 'review asynchronous execution models',
  completeness: 'practice answering all parts of a question',
};

export async function completeInterview(
  id: string,
  userId: string
): Promise<{ session: InterviewSessionDoc; result: InterviewResultDoc }> {
  const session = await getSessionOwned(id, userId);

  const existing = await InterviewResult.findOne({
    session: session._id,
    user: userId,
  });
  if (session.status === 'completed' && existing) {
    return { session, result: existing };
  }
  if (session.answers.length === 0) {
    throw new ApiError(400, 'Answer at least one question before finishing.');
  }

  const answersByQuestion = new Map(
    session.answers.map((a) => [a.questionId, a])
  );

  let marksAwarded = 0;
  let maxMarks = 0;
  const skillAgg = new Map<
    string,
    { questions: number; marksAwarded: number; maxMarks: number }
  >();

  for (const q of session.questions) {
    const skill = q.skill ?? 'General';
    const entry = skillAgg.get(skill) ?? {
      questions: 0,
      marksAwarded: 0,
      maxMarks: 0,
    };
    const answer = answersByQuestion.get(q.id);
    entry.questions += 1;
    entry.maxMarks += q.maxMarks;
    entry.marksAwarded += answer?.marksAwarded ?? 0;
    skillAgg.set(skill, entry);
    marksAwarded += answer?.marksAwarded ?? 0;
    maxMarks += q.maxMarks;
  }

  const percentage = maxMarks ? Math.round((marksAwarded / maxMarks) * 100) : 0;

  const skillScores = Array.from(skillAgg.entries())
    .map(([skill, v]) => ({
      skill,
      questions: v.questions,
      marksAwarded: Math.round(v.marksAwarded * 10) / 10,
      maxMarks: v.maxMarks,
      percentage: v.maxMarks ? Math.round((v.marksAwarded / v.maxMarks) * 100) : 0,
    }))
    .sort((a, b) => b.maxMarks - a.maxMarks);

  const strengths = skillScores
    .filter((s) => s.percentage >= 70)
    .slice(0, 5)
    .map((s) => strengthText(s.skill, s.percentage));

  const improvements = skillScores
    .filter((s) => s.percentage < 50)
    .slice(0, 5)
    .map((s) => improvementText(s.skill, s.percentage));

  const missingConcepts = Array.from(
    new Set(session.answers.flatMap((a) => a.missingConcepts))
  ).slice(0, 10);

  const recommendations = missingConcepts
    .slice(0, 5)
    .map(
      (concept) =>
        `Follow-up study: ${LEARNING_MAP[concept] ?? `review “${concept}” and prepare a concrete example`}.`
    );
  if (session.answers.length < session.questions.length) {
    recommendations.push(
      'Complete the remaining questions to get a fuller picture of your strengths.'
    );
  }

  const result = await InterviewResult.create({
    user: userId,
    session: session._id,
    resume: session.resume,
    difficulty: session.difficulty,
    overall: {
      marksAwarded: Math.round(marksAwarded * 10) / 10,
      maxMarks,
      percentage,
    },
    answeredCount: session.answers.length,
    questionCount: session.questions.length,
    skillScores,
    strengths,
    improvements,
    missingConcepts,
    recommendations,
    summary: `You answered ${session.answers.length} of ${session.questions.length} questions at ${session.difficulty} level and scored ${percentage}%. This is a rubric-based technical assessment of your answers; it does not measure personality, honesty or intelligence.`,
  });

  session.status = 'completed';
  session.completedAt = new Date();
  await session.save();

  return { session, result };
}

export async function getResultOwned(
  sessionId: string,
  userId: string
): Promise<InterviewResultDoc> {
  // Ownership is enforced through the session first.
  await getSessionOwned(sessionId, userId);
  const result = await InterviewResult.findOne({
    session: sessionId,
    user: userId,
  });
  if (!result) {
    throw new ApiError(404, 'No interview result exists for this session yet');
  }
  return result;
}
