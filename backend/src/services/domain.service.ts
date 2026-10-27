import { z } from 'zod';
import { engineFetch } from './aiEngine';
import { getResumeOwned } from './resume.service';
import { ApiError } from '../middleware/errors';

export const DOMAIN_IDS = ['software_it', 'robotics_automation', 'electronics_embedded', 'data_analytics', 'mechanical_core', 'general'] as const;
export const domainSchema = z.object({ confirmedDomains: z.array(z.enum(DOMAIN_IDS)).min(1).max(3) });
export async function detectDomains(id: string, user: string) {
  const resume = await getResumeOwned(id, user);
  const response = await engineFetch('/domains/classify', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile: resume.profile }) });
  if (!response.ok) throw new ApiError(503, 'Local domain analysis is unavailable.');
  resume.domainDetection = await response.json() as Record<string, unknown>;
  await resume.save();
  return { detection: resume.domainDetection, confirmedDomains: resume.confirmedDomains ?? [] };
}
export async function confirmDomains(id: string, user: string, confirmed: string[]) {
  const resume = await getResumeOwned(id, user);
  resume.confirmedDomains = [...new Set(confirmed)]; resume.domainConfirmedAt = new Date();
  await resume.save(); return { confirmedDomains: resume.confirmedDomains };
}
