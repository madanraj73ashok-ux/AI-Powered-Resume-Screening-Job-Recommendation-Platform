import mongoose, { Schema, Document } from 'mongoose';

export interface IAssessment extends Document {
  user: mongoose.Types.ObjectId;
  resume: mongoose.Types.ObjectId;
  status: 'pending' | 'in_progress' | 'completed' | 'reset';
  questionCount: number;
  answeredCount: number;
  score: number; // percentage score (0-100)
  answers: IAssessmentAnswer[];
  takenAt: Date;
  completedAt?: Date;
  resetCount: number;
  thresholds: IThresholds;
}

export interface IAssessmentAnswer {
  questionId: string;
  text: string;
  isCorrect: boolean;
  marksAwarded: number;
  maxMarks: number;
  answeredAt: Date;
}

export interface IThresholds {
  passScore: number; // percentage to pass (default 50)
  qualificationScore: number; // percentage for qualified (default 60)
  minQuestions: number; // minimum questions to attempt
  retakeAfterDays: number; // days before retake allowed
}

export interface IAssessmentResult {
  assessmentId: mongoose.Types.ObjectId;
  overallScore: number;
  skillScores: ISkillScore[];
  strengths: string[];
  weaknesses: string[];
  missingConcepts: string[];
  recommendations: string[];
}

export interface ISkillScore {
  skill: string;
  marksAwarded: number;
  maxMarks: number;
  percentage: number;
}

const AssessmentSchema: Schema = new Schema({
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  resume: { type: Schema.Types.ObjectId, ref: 'Resume', required: true },
  status: { type: String, enum: ['pending', 'in_progress', 'completed', 'reset'], default: 'pending' },
  questionCount: { type: Number, required: true, min: 1 },
  answeredCount: { type: Number, default: 0 },
  score: { type: Number, min: 0, max: 100, default: 0 },
  answers: [
    {
      questionId: { type: String, required: true },
      text: { type: String, required: true },
      isCorrect: { type: Boolean, default: false },
      marksAwarded: { type: Number, min: 0, default: 0 },
      maxMarks: { type: Number, min: 1, default: 10 },
      answeredAt: { type: Date, default: Date.now },
    },
  ],
  takenAt: { type: Date, default: Date.now },
  completedAt: { type: Date },
  resetCount: { type: Number, default: 0 },
  thresholds: {
    type: Map,
    of: Number,
    default: () => ({
      passScore: 50,
      qualificationScore: 60,
      minQuestions: 3,
      retakeAfterDays: 7,
    }),
  },
});

// Method to calculate score
AssessmentSchema.methods.calculateScore = function (): number {
  if (this.answers.length === 0) return 0;

  const correctAnswers = this.answers.filter((a) => a.isCorrect).length;
  const totalQuestions = this.answers.length;
  const percentage = Math.round((correctAnswers / totalQuestions) * 100);
  this.score = Math.min(percentage, 100);
  this.answeredCount = correctAnswers;
  return this.score;
};

// Method to check if assessment can be retaken
AssessmentSchema.methods.canRetake = function (): boolean {
  if (!this.completedAt) return false;
  const daysSince = (Date.now() - this.completedAt.getTime()) / (1000 * 60 * 60 * 24);
  return daysSince >= (this.thresholds.get('retakeAfterDays') || 7);
};

export const Assessment = mongoose.model<IAssessment>('Assessment', AssessmentSchema);