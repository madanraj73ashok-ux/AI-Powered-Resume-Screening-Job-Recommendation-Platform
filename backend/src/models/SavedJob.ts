import mongoose from 'mongoose';

/** A candidate bookmarking a vacancy. Saving never implies applying. */
const savedJobSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    job: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true },
    createdAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

savedJobSchema.index({ user: 1, job: 1 }, { unique: true });

export interface SavedJobDoc extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  job: mongoose.Types.ObjectId | Record<string, unknown>;
  createdAt: Date;
}

export const SavedJob = mongoose.model<SavedJobDoc>(
  'SavedJob',
  savedJobSchema as unknown as mongoose.Schema<SavedJobDoc>
);
