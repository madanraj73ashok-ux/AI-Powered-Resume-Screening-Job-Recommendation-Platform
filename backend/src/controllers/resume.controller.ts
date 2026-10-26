import { Request, Response, NextFunction } from 'express';
import * as resumeService from '../services/resume.service';
import { ApiError } from '../middleware/errors';

function requireUserId(req: Request): string {
  if (!req.user) throw new ApiError(401, 'Authentication required');
  return req.user.id;
}

/**
 * Build a safe Content-Disposition header. The ASCII fallback keeps older
 * clients happy; filename* carries the real (possibly non-ASCII) name.
 */
function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  const encoded = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export async function uploadHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = requireUserId(req);
    const file = req.file;
    if (!file) throw new ApiError(400, 'No file was uploaded. Send the resume as "file".');
    const resume = await resumeService.createResume(userId, {
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      buffer: file.buffer,
    });
    res.status(201).json({ resume });
  } catch (err) {
    next(err);
  }
}

export async function listHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = requireUserId(req);
    const resumes = await resumeService.listResumes(userId);
    res.json({ resumes });
  } catch (err) {
    next(err);
  }
}

export async function detailHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = requireUserId(req);
    const resume = await resumeService.getResumeOwned(req.params.id, userId);
    res.json({ resume });
  } catch (err) {
    next(err);
  }
}

export async function downloadHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = requireUserId(req);
    const file = await resumeService.getResumeFile(req.params.id, userId);
    res.setHeader('Content-Type', file.mimeType);
    res.setHeader('Content-Disposition', contentDisposition(file.filename));
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.sendFile(file.path, (err) => {
      if (err) next(err);
    });
  } catch (err) {
    next(err);
  }
}

export async function updateProfileHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = requireUserId(req);
    const body = req.body as Record<string, unknown>;
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new ApiError(400, 'Expected an object with the profile fields to update.');
    }
    const resume = await resumeService.updateResumeProfile(req.params.id, userId, body);
    res.json({ resume });
  } catch (err) {
    next(err);
  }
}

export async function analyzeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = requireUserId(req);
    const resume = await resumeService.reanalyzeResume(req.params.id, userId);
    res.json({ resume });
  } catch (err) {
    next(err);
  }
}

export async function deleteHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = requireUserId(req);
    await resumeService.deleteResume(req.params.id, userId);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}
