import mongoose from 'mongoose';

const questionSchema = new mongoose.Schema(
  {
    id: { type: String, required: true },
    text: { type: String, required: true },
    type: { type: String, required: true }, // fundamentals | skill_application | project | ...
    difficulty: { type: String, enum: ['Beginner', 'Intermediate', 'Advanced'], required: true },
    skill: { type: String },
    sourceClaim: { type: String },
    expectedConcepts: { type: [String], default: [] },
    rubric: { type: mongoose.Schema.Types.Mixed },
    maxMarks: { type: Number, required: true },
    followUpTemplates: { type: [String], default: [] },
    isFollowUp: { type: Boolean, default: false },
    parentQuestionId: { type: String },
  },
  { _id: false }
);

const answerSchema = new mongoose.Schema(
  {
    questionId: { type: String, required: true },
    text: { type: String, required: true },
    marksAwarded: { type: Number, required: true },
    maxMarks: { type: Number, required: true },
    percentage: { type: Number, required: true },
    explanation: { type: String, required: true },
    matchedConcepts: { type: [String], default: [] },
    missingConcepts: { type: [String], default: [] },
    breakdown: { type: mongoose.Schema.Types.Mixed },
    similarity: { type: Number },
    suggestedFollowUp: { type: String },
    answeredAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const interviewSessionSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    resume: { type: mongoose.Schema.Types.ObjectId, ref: 'Resume', required: true },
    difficulty: {
      type: String,
      enum: ['Beginner', 'Intermediate', 'Advanced'],
      required: true,
    },
    status: {
      type: String,
      enum: ['in_progress', 'completed'],
      default: 'in_progress',
      index: true,
    },
    questions: { type: [questionSchema], default: [] },
    answers: { type: [answerSchema], default: [] },
    currentIndex: { type: Number, default: 0 },
    totalQuestions: { type: Number, default: 0 },
    generator: { type: String },
    mode: { type: String, enum: ['text', 'voice'], default: 'text' },
    interviewType: { type: String, enum: ['HR', 'Technical', 'Project-based', 'Behavioral', 'Mixed'], default: 'Mixed' },
    targetDurationMinutes: { type: Number, default: 20 },
    voice: { type: String, default: 'lessac' },
    speakingRate: { type: Number, default: 1 },
    adaptiveDifficulty: { type: Boolean, default: true },
    resumeSnapshot: { type: mongoose.Schema.Types.Mixed },
    live: {
      draftQuestionId: String,
      draftTranscript: { type: String, default: '' },
      reviewRequired: { type: Boolean, default: true },
      recognitionNote: String,
    },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date },
  },
  { timestamps: true, optimisticConcurrency: true }
);

interviewSessionSchema.set('toJSON', { virtuals: true });
interviewSessionSchema.set('toObject', { virtuals: true });

export interface InterviewQuestionDoc {
  id: string;
  text: string;
  type: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  skill?: string;
  sourceClaim?: string;
  expectedConcepts: string[];
  rubric?: Record<string, string>;
  maxMarks: number;
  followUpTemplates: string[];
  isFollowUp: boolean;
  parentQuestionId?: string;
}

export interface InterviewAnswerDoc {
  questionId: string;
  text: string;
  marksAwarded: number;
  maxMarks: number;
  percentage: number;
  explanation: string;
  matchedConcepts: string[];
  missingConcepts: string[];
  breakdown?: Record<string, number>;
  similarity?: number;
  suggestedFollowUp?: string;
  answeredAt: Date;
}

export interface InterviewSessionDoc extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  resume: mongoose.Types.ObjectId;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  status: 'in_progress' | 'completed';
  questions: InterviewQuestionDoc[];
  answers: InterviewAnswerDoc[];
  currentIndex: number;
  totalQuestions: number;
  generator?: string;
  mode: 'text' | 'voice';
  interviewType: 'HR' | 'Technical' | 'Project-based' | 'Behavioral' | 'Mixed';
  targetDurationMinutes: number;
  voice: string;
  speakingRate: number;
  adaptiveDifficulty: boolean;
  resumeSnapshot?: { candidateName: string; resumeName: string; summary?: string };
  live?: { draftQuestionId?: string; draftTranscript?: string; reviewRequired?: boolean; recognitionNote?: string };
  startedAt: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export const InterviewSession = mongoose.model<InterviewSessionDoc>(
  'InterviewSession',
  interviewSessionSchema as unknown as mongoose.Schema<InterviewSessionDoc>
);
