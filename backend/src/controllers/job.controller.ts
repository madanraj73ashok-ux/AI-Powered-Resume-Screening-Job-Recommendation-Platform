import { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import { z } from 'zod';
import { env } from '../config/env';
import { ApiError } from '../middleware/errors';
import { Job } from '../models/Job';
import { APPLICATION_STATUSES, ApplicationStatus, JobApplication } from '../models/JobApplication';
import { SavedJob } from '../models/SavedJob';
import { User } from '../models/User';
import { listSourceStatus, refreshSources } from '../services/jobDiscovery.service';
import { getMatches, getRoleSuggestions, MatchFilters } from '../services/jobMatch.service';

/**
 * Candidate-only job endpoints. Every handler is user-scoped: a candidate can
 * only ever see or change their own matches, saved jobs and applications.
 */

export const preferencesSchema = z
  .object({
    location: z.string().trim().max(120).optional(),
    arrangement: z.enum(['Any', 'Remote', 'Hybrid', 'On-site']).optional(),
    experienceYears: z.number().min(0).max(50).optional(),
  })
  .strict();

export const refreshSchema = z.object({ force: z.boolean().optional() }).strict();
export const applicationSchema = z.object({ status: z.enum(APPLICATION_STATUSES).optional() }).strict();
export const applicationUpdateSchema = z.object({ status: z.enum(APPLICATION_STATUSES) }).strict();

function parseFilters(query: Request['query']): MatchFilters {
  const str = (value: unknown, max = 80): string | undefined =>
    typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined;
  const num = (value: unknown): number | undefined => {
    if (typeof value !== 'string' || !value.trim()) return undefined;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  };
  return {
    resumeId: str(query.resumeId),
    level: str(query.level),
    arrangement: str(query.arrangement),
    location: str(query.location),
    search: str(query.search, 120),
    minScore: num(query.minScore),
    savedOnly: query.savedOnly === 'true',
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function serializeJobBrief(value: any) {
  if (!value || typeof value !== 'object' || !value.title) return null;
  return {
    jobId: String(value._id ?? value.id ?? ''),
    title: String(value.title),
    company: String(value.company ?? ''),
    location: String(value.location ?? ''),
    arrangement: String(value.arrangement ?? 'unknown'),
    level: String(value.level ?? 'Not specified'),
    provider: String(value.provider ?? ''),
    url: value.url ? String(value.url) : null,
    applyUrl: value.applyUrl ? String(value.applyUrl) : null,
    linkKind: String(value.linkKind ?? 'unavailable'),
    linkLabel: String(value.linkLabel ?? 'Link unavailable'),
    linkVerified: Boolean(value.linkVerified),
    status: String(value.status ?? 'active'),
  };
}

function serializeApplication(application: {
  _id: mongoose.Types.ObjectId;
  status: string;
  statusHistory?: { status: string; at: Date }[];
  appliedAt?: Date;
  updatedAt?: Date;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  job?: any;
}) {
  return {
    id: String(application._id),
    status: application.status,
    statusHistory: application.statusHistory ?? [],
    appliedAt: application.appliedAt,
    updatedAt: application.updatedAt,
    job: serializeJobBrief(application.job),
  };
}

async function requireJob(id: string) {
  if (!mongoose.isValidObjectId(id)) throw new ApiError(404, 'Job not found.');
  const job = await Job.findById(id);
  if (!job) throw new ApiError(404, 'Job not found.');
  return job;
}

export async function getMatchesHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const response = await getMatches(req.user!.id, parseFilters(req.query));
    let refreshing = false;
    // Lazy refresh: when any enabled board is due, kick one coalesced background
    // refresh. The response below always reflects currently stored data.
    if (env.jobDiscoveryEnabled && response.sources.some((source) => source.enabled && source.stale)) {
      refreshing = true;
      void refreshSources().catch(() => undefined);
    }
    res.json({ ...response, refreshing });
  } catch (error) {
    next(error);
  }
}

export async function getRolesHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json(await getRoleSuggestions(req.user!.id, typeof req.query.resumeId === 'string' ? req.query.resumeId : undefined));
  } catch (error) {
    next(error);
  }
}

export async function getSourcesHandler(_req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    res.json({ discoveryEnabled: env.jobDiscoveryEnabled, sources: await listSourceStatus() });
  } catch (error) {
    next(error);
  }
}

export async function refreshHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    // Candidate requests cannot bypass the shared freshness and retry window.
    const summary = await refreshSources();
    res.json({ summary, discoveryEnabled: env.jobDiscoveryEnabled, sources: await listSourceStatus() });
  } catch (error) {
    next(error);
  }
}

export async function setPreferencesHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = await User.findById(req.user!.id);
    if (!user) throw new ApiError(404, 'Account not found.');
    user.jobPreferences = { ...(user.jobPreferences ?? {}), ...req.body };
    user.markModified('jobPreferences');
    await user.save();
    res.json({ preferences: user.jobPreferences });
  } catch (error) {
    next(error);
  }
}

export async function listSavedHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const saved = await SavedJob.find({ user: req.user!.id }).sort({ createdAt: -1 }).populate('job');
    res.json({
      saved: saved
        .map((entry) => ({ savedAt: entry.createdAt, job: serializeJobBrief(entry.job) }))
        .filter((entry) => entry.job),
    });
  } catch (error) {
    next(error);
  }
}

export async function saveJobHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const job = await requireJob(req.params.jobId);
    await SavedJob.updateOne(
      { user: req.user!.id, job: job._id },
      { $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );
    res.json({ saved: true, jobId: String(job._id) });
  } catch (error) {
    next(error);
  }
}

export async function unsaveJobHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const job = await requireJob(req.params.jobId);
    await SavedJob.deleteOne({ user: req.user!.id, job: job._id });
    res.json({ saved: false, jobId: String(job._id) });
  } catch (error) {
    next(error);
  }
}

export async function createApplicationHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const job = await requireJob(req.params.jobId);
    const status = (req.body.status as ApplicationStatus | undefined) ?? 'Applied';
    // Idempotent: confirming the same application twice never duplicates it.
    let application = await JobApplication.findOne({ user: req.user!.id, job: job._id });
    if (!application) {
      application = await JobApplication.create({
        user: req.user!.id,
        job: job._id,
        status,
        statusHistory: [{ status, at: new Date() }],
        appliedAt: new Date(),
      });
      await application.populate('job');
      res.status(201).json({ application: serializeApplication(application) });
      return;
    }
    await application.populate('job');
    res.json({ application: serializeApplication(application) });
  } catch (error) {
    next(error);
  }
}

export async function listApplicationsHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const applications = await JobApplication.find({ user: req.user!.id })
      .sort({ updatedAt: -1 })
      .populate('job');
    res.json({ applications: applications.map((application) => serializeApplication(application)) });
  } catch (error) {
    next(error);
  }
}

export async function updateApplicationHandler(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw new ApiError(404, 'Application not found.');
    const application = await JobApplication.findOne({ _id: req.params.id, user: req.user!.id });
    if (!application) throw new ApiError(404, 'Application not found.');
    const status = req.body.status as ApplicationStatus;
    if (application.status !== status) {
      application.status = status;
      application.statusHistory.push({ status, at: new Date() });
      await application.save();
    }
    await application.populate('job');
    res.json({ application: serializeApplication(application) });
  } catch (error) {
    next(error);
  }
}
