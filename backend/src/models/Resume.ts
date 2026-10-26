import mongoose from 'mongoose';

const evidenceSchema = new mongoose.Schema(
  {
    page: { type: Number },
    quote: { type: String },
  },
  { _id: false }
);

const skillSchema = new mongoose.Schema(
  {
    skill: { type: String, required: true },
    category: { type: String },
    count: { type: Number, default: 0 },
    // Mixed so structured {page, quote} evidence from the engine is stored as-is.
    evidence: { type: mongoose.Schema.Types.Mixed },
  },
  { _id: false }
);

const resumeSchema = new mongoose.Schema(
  {
    user: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    originalName: { type: String, required: true },
    storageName: { type: String, required: true }, // private filename on disk
    mimeType: { type: String, required: true },
    size: { type: Number, required: true },
    status: {
      type: String,
      enum: ['processed', 'failed'],
      default: 'processed',
    },
    fullText: { type: String, default: '' },
    pages: { type: [{ page: Number, chars: Number }], default: [] },
    profile: {
      name: { type: String },
      contact: {
        email: { type: String },
        phone: { type: String },
        linkedin: { type: String },
      },
      summary: { type: String },
      skills: { type: [skillSchema], default: [] },
      education: { type: [mongoose.Schema.Types.Mixed], default: [] },
      experience: { type: [mongoose.Schema.Types.Mixed], default: [] },
      projects: { type: [mongoose.Schema.Types.Mixed], default: [] },
      certifications: { type: [mongoose.Schema.Types.Mixed], default: [] },
      achievements: { type: [mongoose.Schema.Types.Mixed], default: [] },
      responsibilities: { type: [mongoose.Schema.Types.Mixed], default: [] },
      extractionErrors: { type: [String], default: [] },
      charCount: { type: Number, default: 0 },
    },
    profileEdited: { type: Boolean, default: false },
    analysis: {
      summary: { type: mongoose.Schema.Types.Mixed },
      findings: { type: [mongoose.Schema.Types.Mixed], default: [] },
      analyzedAt: { type: Date },
    },
  },
  { timestamps: true }
);

// Serialize the virtual `id` so API consumers get a stable identifier.
resumeSchema.set('toJSON', { virtuals: true });
resumeSchema.set('toObject', { virtuals: true });

export interface ResumeDoc extends mongoose.Document {
  _id: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  originalName: string;
  storageName: string;
  mimeType: string;
  size: number;
  status: 'processed' | 'failed';
  fullText: string;
  pages: { page?: number | null; chars?: number | null }[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  profile: Record<string, any>;
  profileEdited: boolean;
  analysis?: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    summary?: Record<string, any>;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    findings?: any[];
    analyzedAt?: Date;
  };
  createdAt: Date;
  updatedAt: Date;
}

export const Resume = mongoose.model<ResumeDoc>(
  'Resume',
  resumeSchema as unknown as mongoose.Schema<ResumeDoc>
);
