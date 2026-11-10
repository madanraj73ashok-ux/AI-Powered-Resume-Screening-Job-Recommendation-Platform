import mongoose from 'mongoose';

export const APPLICATION_STATUSES = [
  'Applied',
  'Under Review',
  'Interview Scheduled',
  'Offer Received',
  'Rejected',
  'Withdrawn',
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/**
 * A job application the candidate explicitly confirmed.
 * Opening an application link never creates or changes one of these;
 * only an explicit candidate action does, and every change is recorded.
 */
const jobApplicationSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    job: { type: mongoose.Schema.Types.ObjectId, ref: 'Job', required: true },
    status: { type: String, enum: APPLICATION_STATUSES, required: true, default: 'Applied' },
    statusHistory: {
      type: [
        new mongoose.Schema(
          { status: { type: String, enum: APPLICATION_STATUSES, required: true }, at: { type: Date, default: Date.now } },
          { _id: false }
        ),
      ],
      default: [],
    },
    appliedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

jobApplicationSchema.index({ user: 1, job: 1 }, { unique: true });
jobApplicationSchema.index({ user: 1, status: 1 });
jobApplicationSchema.set('toJSON', { virtuals: true });

export interface JobApplicationDoc extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  job: mongoose.Types.ObjectId | Record<string, unknown>;
  status: ApplicationStatus;
  statusHistory: { status: ApplicationStatus; at: Date }[];
  appliedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export const JobApplication = mongoose.model<JobApplicationDoc>(
  'JobApplication',
  jobApplicationSchema as unknown as mongoose.Schema<JobApplicationDoc>
);
