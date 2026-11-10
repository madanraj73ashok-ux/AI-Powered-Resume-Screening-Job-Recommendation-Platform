import mongoose from 'mongoose';

export const LINK_KINDS = ['apply_now', 'view_job', 'search_openings', 'unavailable'] as const;
export type LinkKind = (typeof LINK_KINDS)[number];

/**
 * One real vacancy discovered from a provider's public job board.
 * Jobs are only ever created from provider responses — never invented —
 * and are marked `expired` when the provider stops returning them.
 */
const jobSchema = new mongoose.Schema(
  {
    provider: { type: String, required: true },
    sourceKey: { type: String, required: true, index: true },
    externalId: { type: String, required: true },
    dedupeKey: { type: String, required: true, unique: true },
    title: { type: String, required: true },
    company: { type: String, required: true },
    location: { type: String, default: '' },
    arrangement: {
      type: String,
      enum: ['remote', 'hybrid', 'onsite', 'unknown'],
      default: 'unknown',
    },
    level: { type: String, default: 'Not specified' },
    url: { type: String, required: true },
    applyUrl: { type: String },
    linkKind: { type: String, enum: LINK_KINDS, default: 'view_job' },
    linkLabel: { type: String, default: 'View Job' },
    linkVerified: { type: Boolean, default: false },
    linkReason: { type: String, default: '' },
    description: { type: String, default: '' },
    requiredSkills: { type: [String], default: [] },
    preferredSkills: { type: [String], default: [] },
    requirementsConfidence: { type: String, default: 'unknown' },
    minExperienceYears: { type: Number, default: null },
    experienceEvidence: { type: String, default: null },
    skillsParsedAt: { type: Date },
    sourceHash: { type: String },
    firstSeenAt: { type: Date, default: Date.now },
    lastSeenAt: { type: Date, default: Date.now },
    status: { type: String, enum: ['active', 'expired'], default: 'active' },
  },
  { timestamps: true }
);

jobSchema.index({ status: 1, lastSeenAt: -1 });
jobSchema.set('toJSON', { virtuals: true });

export interface JobDoc extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  provider: string;
  sourceKey: string;
  externalId: string;
  dedupeKey: string;
  title: string;
  company: string;
  location: string;
  arrangement: 'remote' | 'hybrid' | 'onsite' | 'unknown';
  level: string;
  url: string;
  applyUrl?: string | null;
  linkKind: LinkKind;
  linkLabel: string;
  linkVerified: boolean;
  linkReason: string;
  description: string;
  requiredSkills: string[];
  preferredSkills: string[];
  requirementsConfidence: string;
  minExperienceYears: number | null;
  experienceEvidence?: string | null;
  skillsParsedAt?: Date;
  sourceHash?: string;
  firstSeenAt: Date;
  lastSeenAt: Date;
  status: 'active' | 'expired';
  createdAt: Date;
  updatedAt: Date;
}

export const Job = mongoose.model<JobDoc>('Job', jobSchema as unknown as mongoose.Schema<JobDoc>);
