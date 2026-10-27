import axios from 'axios';
import client, { apiErrorMessage } from './client';

export interface Evidence {
  page?: number;
  quote?: string;
}

export interface ResumeSkill {
  skill: string;
  category?: string;
  count?: number;
  level?: string | null;
  evidence?: Evidence | string | null;
}

export interface ResumeItem {
  text?: string;
  degree?: string;
  dates?: string | null;
  evidence?: Evidence | null;
  [key: string]: unknown;
}

export interface ResumeProfile {
  name?: string;
  contact?: { email?: string; phone?: string; linkedin?: string };
  summary?: string;
  skills?: ResumeSkill[];
  education?: ResumeItem[];
  experience?: ResumeItem[];
  projects?: ResumeItem[];
  certifications?: ResumeItem[];
  achievements?: ResumeItem[];
  responsibilities?: ResumeItem[];
  extractionErrors?: string[];
  charCount?: number;
}

export interface Finding {
  id: string;
  type: string;
  claim: string;
  evidence?: Evidence | null;
  method: string;
  finding: string;
  reason: string;
  suggestedFollowUp?: string;
  status: string;
  severity?: 'info' | 'warning';
  confidence?: number | null;
}

export interface Resume {
  id: string;
  _id?: string;
  originalName: string;
  mimeType: string;
  size: number;
  status: 'processed' | 'failed';
  createdAt: string;
  updatedAt: string;
  fullText?: string;
  pages?: { page?: number | null; chars?: number | null }[];
  profile: ResumeProfile;
  profileEdited?: boolean;
  confirmedDomains?: string[];
  domainDetection?: { suggestedDomains: string[]; uncertain: boolean; ranked: { domain: string; label: string; score: number; matchedSkills: string[] }[] };
  analysis?: {
    summary?: {
      overallStatus?: string;
      findingsCount?: number;
      warnings?: number;
      supportedClaims?: number;
      evidenceRequested?: number;
      skillsClaimed?: number;
      note?: string;
    };
    findings?: Finding[];
    analyzedAt?: string;
  };
}

export async function listResumes(): Promise<Resume[]> {
  const res = await client.get('/resumes');
  return res.data.resumes as Resume[];
}

export async function getResume(id: string): Promise<Resume> {
  const res = await client.get(`/resumes/${id}`);
  return res.data.resume as Resume;
}

export async function uploadResume(
  file: File,
  onProgress?: (percent: number) => void
): Promise<Resume> {
  const form = new FormData();
  form.append('file', file);
  const res = await client.post('/resumes', form, {
    headers: { 'Content-Type': 'multipart/form-data' },
    onUploadProgress: (evt) => {
      if (onProgress && evt.total) {
        onProgress(Math.round((evt.loaded / evt.total) * 100));
      }
    },
    timeout: 120000,
  });
  return res.data.resume as Resume;
}

export async function updateResumeProfile(
  id: string,
  patch: Partial<ResumeProfile> | Record<string, unknown>
): Promise<Resume> {
  const res = await client.put(`/resumes/${id}`, patch);
  return res.data.resume as Resume;
}

export async function analyzeResume(id: string): Promise<Resume> {
  const res = await client.post(`/resumes/${id}/analyze`, {}, { timeout: 120000 });
  return res.data.resume as Resume;
}

export async function deleteResume(id: string): Promise<void> {
  await client.delete(`/resumes/${id}`);
}

/**
 * Fetch the candidate's own original file through the authenticated API and
 * save it via a temporary object URL, so no private path is ever exposed.
 */
export async function downloadResumeFile(id: string, filename: string): Promise<void> {
  let blob: Blob;
  try {
    const res = await client.get(`/resumes/${id}/file`, {
      responseType: 'blob',
      timeout: 60000,
    });
    blob = res.data as Blob;
  } catch (err) {
    // Error bodies arrive as a Blob too, so read the JSON message out of it.
    let serverMessage: string | null = null;
    if (axios.isAxiosError(err) && err.response?.data instanceof Blob) {
      try {
        const text = await err.response.data.text();
        serverMessage = (JSON.parse(text) as { error?: string }).error ?? null;
      } catch {
        serverMessage = null;
      }
    }
    throw new Error(serverMessage ?? apiErrorMessage(err));
  }

  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename || 'resume.pdf';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 KB';
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}
