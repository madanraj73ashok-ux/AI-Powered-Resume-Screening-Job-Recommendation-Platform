import { z } from 'zod';
import crypto from 'crypto';
import mongoose from 'mongoose';
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
import { InterviewEvent } from '../models/InterviewEvent';
import { DOMAIN_IDS } from './domain.service';

export const startInterviewSchema = z.object({
  resumeId: z.string().min(1, 'A resume is required'),
  difficulty: z.enum(['Beginner', 'Intermediate', 'Advanced']).default('Intermediate'),
  questionCount: z.coerce.number().int().min(3).max(12).default(8),
  mode: z.enum(['text', 'voice']).default('text'),
  interviewType: z.enum(['HR', 'Technical', 'Project-based', 'Behavioral', 'Mixed']).default('Mixed'),
  targetDurationMinutes: z.union([z.literal(10), z.literal(20), z.literal(30)]).default(20),
  voice: z.enum(['lessac', 'custom']).default('lessac'),
  speakingRate: z.number().min(0.7).max(1.3).default(1),
  adaptiveDifficulty: z.boolean().default(true),
  confirmedDomains: z.array(z.enum(DOMAIN_IDS)).max(3).transform(domains => [...new Set(domains)]).optional(),
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
  input: { resumeId: string; difficulty: 'Beginner' | 'Intermediate' | 'Advanced'; questionCount: number;
    mode?: 'text' | 'voice'; interviewType?: InterviewSessionDoc['interviewType']; targetDurationMinutes?: number;
    voice?: string; speakingRate?: number; adaptiveDifficulty?: boolean; confirmedDomains?: string[] }
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
      ...(input.mode === 'voice' ? { interviewType: input.interviewType ?? 'Mixed' } : {}),
      confirmedDomains: input.confirmedDomains ?? resume.confirmedDomains ?? [],
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
    domain: q.domain, bankVersion: q.bankVersion, rubricVersion: q.rubricVersion,
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
    mode: input.mode ?? 'text', interviewType: input.interviewType ?? 'Mixed',
    targetDurationMinutes: input.targetDurationMinutes ?? 20, voice: input.voice ?? 'lessac',
    speakingRate: input.speakingRate ?? 1, adaptiveDifficulty: input.adaptiveDifficulty ?? true,
    confirmedDomains: input.confirmedDomains ?? resume.confirmedDomains ?? [],
    ...(input.mode === 'voice' ? { resumeSnapshot: { candidateName: String(resume.profile.name ?? 'Candidate'),
      resumeName: resume.originalName, summary: String(resume.profile.summary ?? '') } } : {}),
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
      difficulty: current.difficulty,
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
      rubric: {
        technicalAccuracy: `40%: Explain ${evaluation.missingConcepts[0] ?? 'the example'} accurately.`,
        completeness: '25%: Address the specific gap raised by this follow-up.',
        practicalExamples: '20%: Give a concrete example from your work.',
        understanding: '15%: Explain why your approach works and its limitations.',
      },
      maxMarks: FOLLOW_UP_MAX_MARKS,
      followUpTemplates: [],
      isFollowUp: true,
      parentQuestionId: current.id,
      domain: current.domain, bankVersion: current.bankVersion, rubricVersion: current.rubricVersion,
    };
    session.questions.splice(session.currentIndex + 1, 0, followUp);
  }

  session.currentIndex += 1;
  session.totalQuestions = session.questions.length;
  if (session.mode === 'voice') {
    session.live = { draftTranscript: '', reviewRequired: true };
    // Change the actual next bank question, not just its difficulty label.
    const next = session.questions[session.currentIndex];
    if (session.adaptiveDifficulty && next && !next.isFollowUp && !current.isFollowUp) {
      const levels = ['Beginner', 'Intermediate', 'Advanced'] as const;
      const index = levels.indexOf(current.difficulty);
      const target = levels[Math.max(0, Math.min(2, index + (evaluation.percentage >= 85 ? 1 : evaluation.percentage < 35 ? -1 : 0)))];
      if (target !== next.difficulty) {
        try {
          const resume = await getResumeOwned(session.resume.toString(), userId);
          const generated = await generateQuestions({ profile: resume.profile, findings: resume.analysis?.findings ?? [],
            difficulty: target, count: 12, seed: `${id}:${session.currentIndex}`, interviewType: session.interviewType,
            confirmedDomains: session.confirmedDomains });
          const asked = new Set(session.questions.slice(0, session.currentIndex).map(q => q.text));
          const candidate = generated.questions.find(q => q.type !== 'introduction' && q.type === next.type && (!next.skill || q.skill === next.skill) && !asked.has(q.text));
          if (candidate) session.questions[session.currentIndex] = { ...candidate, isFollowUp: false, followUpTemplates: candidate.followUpTemplates ?? [] };
        } catch { /* Keep the saved bank question if adaptation is unavailable. */ }
      }
    }
  }
  await saveProgress(session);

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

async function saveProgress(session: InterviewSessionDoc): Promise<void> {
  try {
    await session.save();
  } catch (err) {
    if (err instanceof mongoose.Error.VersionError) {
      throw new ApiError(409, 'This interview changed in another request. Reload to continue from the saved progress.');
    }
    throw err;
  }
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
    .filter((s) => s.percentage < 70)
    .slice(0, 5)
    .map((s) => improvementText(s.skill, s.percentage));
  for (const q of session.questions) {
    const answer = answersByQuestion.get(q.id);
    if (answer && answer.percentage < 50 && improvements.length < 8) {
      improvements.push(`Review ${q.skill ?? q.type.replace('_', ' ')}: “${q.text}” (${answer.percentage}%). ${answer.missingConcepts.length ? `Cover ${answer.missingConcepts.join(', ')} with a concrete example.` : 'Expand the explanation and show your reasoning.'}`);
    }
  }

  const missingConcepts = Array.from(
    new Set(session.questions.flatMap((q) => answersByQuestion.get(q.id)?.missingConcepts ?? q.expectedConcepts))
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

  // Freeze the session before publishing the report. Optimistic concurrency
  // prevents an answer racing completion from changing the report's inputs.
  if (session.status !== 'completed') {
    session.status = 'completed';
    session.completedAt = new Date();
    await saveProgress(session);
  }
  const presenceEvents = session.mode === 'voice' ? await InterviewEvent.find({ session: id, user: userId,
    type: { $in: ['camera_on', 'camera_off', 'camera_unavailable', 'face_visible', 'no_face', 'multiple_faces', 'detector_unavailable'] } })
    .sort({ at: 1 }).select('type at faceCount -_id').limit(500).lean() : [];
  // Upsert also repairs an interrupted completion (session saved, report not yet saved).
  const result = await InterviewResult.findOneAndUpdate({ session: session._id, user: userId }, { $setOnInsert: {
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
    ...(session.mode === 'voice' ? { liveReport: {
      candidateName: session.resumeSnapshot?.candidateName, resumeName: session.resumeSnapshot?.resumeName,
      interviewDate: session.startedAt,
      presenceEvents,
      interviewType: session.interviewType, mode: session.mode, targetDurationMinutes: session.targetDurationMinutes,
      confirmedDomains: session.confirmedDomains,
      versions: { parser: 'not captured for this resume', classifier: 'not captured for this session',
        rubric: session.questions.find(q => q.rubricVersion)?.rubricVersion ?? 'legacy-unversioned',
        questionBank: session.questions.find(q => q.bankVersion)?.bankVersion ?? 'legacy-curated',
        stt: 'runtime/model version not captured', tts: `configured voice: ${session.voice}; runtime version not captured`, llm: 'none' },
      durationSeconds: Math.round(((session.completedAt ?? new Date()).getTime() - session.startedAt.getTime()) / 1000),
      communicationFeedback: `${session.answers.filter(a => /\b(for example|for instance|such as|specifically)\b/i.test(a.text)).length} of ${session.answers.length} transcripts contain explicit example markers; ${session.answers.filter(a => /\b(because|therefore|trade.off|instead|so that)\b/i.test(a.text)).length} contain reasoning markers. These are low-confidence textual indicators, not a communication-competence score. No accent, speaking-speed, emotion or appearance score is computed. Recognition errors can affect these observations.`,
      answerObservations: session.questions.flatMap(q => {
        const a = answersByQuestion.get(q.id);
        return a ? [{ questionId: q.id, kind: q.type,
          observation: `${a.matchedConcepts.length} of ${q.expectedConcepts.length} expected concepts matched. ${a.missingConcepts.length ? `Review: ${a.missingConcepts.join(', ')}.` : 'All expected concepts matched; correctness still requires human review.'}`,
          evidence: a.text.slice(0, 350) }] : [];
      }),
      resumeConsistencyFindings: session.questions.filter(q => q.type === 'verification').map(q => ({ claim: q.sourceClaim, question: q.text,
        answer: answersByQuestion.get(q.id)?.text ?? null, status: 'Human review required; no external verification.' })),
      humanReviewRequired: true,
      limitations: 'Local deterministic concept matching estimates content coverage; it cannot verify factual accuracy, genuine understanding or identity. Audio/video are not retained. Human review is required before consequential hiring decisions.',
    } } : {}),
  } }, { upsert: true, new: true, runValidators: true });

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
