import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { Resume, ResumeDoc } from '../models/Resume';
import { ApiError } from '../middleware/errors';
import { AiEngineError, extractFromBuffer, analyzeResumeText } from './aiEngine';
import env from '../config/env';

export interface UploadedFile {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

function uploadRoot(): string {
  return path.resolve(process.cwd(), env.uploadDir);
}

/** Validate magic bytes so renamed files cannot bypass the type check. */
function validateContent(file: UploadedFile): void {
  const head = file.buffer.subarray(0, 8);
  const isPdf = head.subarray(0, 4).toString('latin1') === '%PDF';
  const isZip = head[0] === 0x50 && head[1] === 0x4b; // DOCX is a zip package
  if (file.originalname.toLowerCase().endsWith('.pdf') && !isPdf) {
    throw new ApiError(400, 'The file content is not a valid PDF.');
  }
  if (file.originalname.toLowerCase().endsWith('.docx') && !isZip) {
    throw new ApiError(400, 'The file content is not a valid DOCX document.');
  }
}

export async function createResume(userId: string, file: UploadedFile): Promise<ResumeDoc> {
  validateContent(file);

  const ext = file.originalname.toLowerCase().endsWith('.pdf') ? 'pdf' : 'docx';
  const storageName = `${crypto.randomUUID()}.${ext}`;
  const userDir = path.join(uploadRoot(), userId);
  await fs.mkdir(userDir, { recursive: true });
  const filePath = path.join(userDir, storageName);
  await fs.writeFile(filePath, file.buffer);

  try {
    const extraction = await extractFromBuffer(file.originalname, file.buffer, file.mimetype);
    const resume = await Resume.create({
      user: userId,
      originalName: file.originalname,
      storageName,
      mimeType: file.mimetype,
      size: file.size,
      status: 'processed',
      fullText: extraction.fullText,
      pages: extraction.pages,
      profile: extraction.profile,
    });

    // Run the claim analysis right away so the dashboard has findings instantly.
    try {
      const analysis = await analyzeResumeText(
        extraction.profile as Record<string, unknown>,
        extraction.fullText
      );
      resume.analysis = { summary: analysis.summary, findings: analysis.findings, analyzedAt: new Date() };
      await resume.save();
    } catch (err) {
      // Extraction succeeded; analysis can be re-run manually.
      console.warn('[resumes] analysis step failed:', (err as Error).message);
    }
    return resume;
  } catch (err) {
    await fs.unlink(filePath).catch(() => undefined);
    if (err instanceof AiEngineError) {
      throw new ApiError(err.status >= 500 ? 503 : 422, err.message);
    }
    throw err;
  }
}

export async function listResumes(userId: string): Promise<ResumeDoc[]> {
  return Resume.find({ user: userId }).sort({ createdAt: -1 });
}

export async function getResumeOwned(id: string, userId: string): Promise<ResumeDoc> {
  const resume = await Resume.findById(id);
  if (!resume || resume.user.toString() !== userId) {
    throw new ApiError(404, 'Resume not found');
  }
  return resume;
}

export interface ResumeFile {
  path: string;
  filename: string;
  mimeType: string;
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

/**
 * Resolve the private original for one resume. Ownership is enforced before the
 * path is built, so a caller can only ever reach files under their own folder.
 */
export async function getResumeFile(id: string, userId: string): Promise<ResumeFile> {
  const resume = await getResumeOwned(id, userId);
  const filePath = path.join(uploadRoot(), userId, path.basename(resume.storageName));
  try {
    await fs.access(filePath);
  } catch {
    throw new ApiError(
      404,
      'The stored file for this resume is no longer available on the server. Re-upload the document to analyse it again.'
    );
  }

  const ext = resume.storageName.toLowerCase().endsWith('.pdf') ? 'pdf' : 'docx';
  const storedMime = (resume.mimeType ?? '').trim().toLowerCase();
  const mimeType =
    storedMime.startsWith('application/') && storedMime !== 'application/octet-stream'
      ? storedMime
      : MIME_BY_EXT[ext];

  return {
    path: filePath,
    filename: resume.originalName || `resume.${ext}`,
    mimeType,
  };
}

const ALLOWED_PROFILE_FIELDS = [
  'name',
  'contact',
  'summary',
  'skills',
  'education',
  'experience',
  'projects',
  'certifications',
] as const;

export async function updateResumeProfile(
  id: string,
  userId: string,
  patch: Record<string, unknown>
): Promise<ResumeDoc> {
  const resume = await getResumeOwned(id, userId);
  for (const field of ALLOWED_PROFILE_FIELDS) {
    if (patch[field] !== undefined) {
      (resume.profile as Record<string, unknown>)[field] = patch[field];
    }
  }
  resume.profileEdited = true;
  await resume.save();
  return resume;
}

export async function reanalyzeResume(id: string, userId: string): Promise<ResumeDoc> {
  const resume = await getResumeOwned(id, userId);
  if (!resume.fullText || !resume.fullText.trim()) {
    throw new ApiError(
      422,
      'This resume has no extractable text, so analysis cannot run. ' +
        'If the document is a scan, OCR is not configured in this installation.'
    );
  }
  try {
    const analysis = await analyzeResumeText(
      resume.profile as Record<string, unknown>,
      resume.fullText
    );
    resume.analysis = { summary: analysis.summary, findings: analysis.findings, analyzedAt: new Date() };
    await resume.save();
    return resume;
  } catch (err) {
    if (err instanceof AiEngineError) throw new ApiError(err.status >= 500 ? 503 : 422, err.message);
    throw err;
  }
}

export async function deleteResume(id: string, userId: string): Promise<void> {
  const resume = await getResumeOwned(id, userId);
  const filePath = path.join(uploadRoot(), userId, resume.storageName);
  await fs.unlink(filePath).catch(() => undefined);
  await resume.deleteOne();
}
