import mongoose from 'mongoose';

const skillScoreSchema = new mongoose.Schema(
  {
    skill: { type: String, required: true },
    questions: { type: Number, default: 0 },
    marksAwarded: { type: Number, default: 0 },
    maxMarks: { type: Number, default: 0 },
    percentage: { type: Number, default: 0 },
  },
  { _id: false }
);

const interviewResultSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    session: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'InterviewSession',
      required: true,
      index: true,
      unique: true,
    },
    resume: { type: mongoose.Schema.Types.ObjectId, ref: 'Resume' },
    difficulty: { type: String, required: true },
    overall: {
      marksAwarded: { type: Number, required: true },
      maxMarks: { type: Number, required: true },
      percentage: { type: Number, required: true },
    },
    answeredCount: { type: Number, default: 0 },
    questionCount: { type: Number, default: 0 },
    skillScores: { type: [skillScoreSchema], default: [] },
    strengths: { type: [String], default: [] },
    improvements: { type: [String], default: [] },
    missingConcepts: { type: [String], default: [] },
    recommendations: { type: [String], default: [] },
    summary: { type: String },
    liveReport: { type: mongoose.Schema.Types.Mixed },
    createdAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

interviewResultSchema.set('toJSON', { virtuals: true });

export interface InterviewResultDoc extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  session: mongoose.Types.ObjectId;
  resume?: mongoose.Types.ObjectId;
  difficulty: string;
  overall: { marksAwarded: number; maxMarks: number; percentage: number };
  answeredCount: number;
  questionCount: number;
  skillScores: {
    skill: string;
    questions: number;
    marksAwarded: number;
    maxMarks: number;
    percentage: number;
  }[];
  strengths: string[];
  improvements: string[];
  missingConcepts: string[];
  recommendations: string[];
  summary?: string;
  liveReport?: Record<string, unknown>;
  createdAt: Date;
}

export const InterviewResult = mongoose.model<InterviewResultDoc>(
  'InterviewResult',
  interviewResultSchema as unknown as mongoose.Schema<InterviewResultDoc>
);
