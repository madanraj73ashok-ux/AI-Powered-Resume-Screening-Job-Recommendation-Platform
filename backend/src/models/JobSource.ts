import mongoose from 'mongoose';

/**
 * A configured job board (real company board on Greenhouse or Lever).
 * `lastError` is a short, candidate-safe message — never a token or stack trace.
 */
const jobSourceSchema = new mongoose.Schema(
  {
    provider: { type: String, required: true },
    token: { type: String, required: true },
    company: { type: String, required: true },
    boardUrl: { type: String, required: true },
    enabled: { type: Boolean, default: true },
    lastStatus: { type: String, enum: ['never', 'ok', 'error'], default: 'never' },
    lastError: { type: String, default: null },
    lastJobCount: { type: Number, default: 0 },
    consecutiveFailures: { type: Number, default: 0 },
    lastCheckedAt: { type: Date, default: null },
    lastAttemptAt: { type: Date, default: null },
  },
  { timestamps: true }
);

jobSourceSchema.index({ provider: 1, token: 1 }, { unique: true });
jobSourceSchema.set('toJSON', { virtuals: true });

export interface JobSourceDoc extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  provider: string;
  token: string;
  company: string;
  boardUrl: string;
  enabled: boolean;
  lastStatus: 'never' | 'ok' | 'error';
  lastError?: string | null;
  lastJobCount: number;
  consecutiveFailures: number;
  lastCheckedAt?: Date | null;
  lastAttemptAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export const JobSource = mongoose.model<JobSourceDoc>(
  'JobSource',
  jobSourceSchema as unknown as mongoose.Schema<JobSourceDoc>
);
