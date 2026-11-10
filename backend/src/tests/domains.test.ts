import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../app';
import { Resume } from '../models/Resume';
import { engineFetch } from '../services/aiEngine';

// Only the internal classifier response is mocked; auth and MongoDB are real.
vi.mock('../services/aiEngine', async (importOriginal) => ({
  ...await importOriginal<typeof import('../services/aiEngine')>(),
  engineFetch: vi.fn(),
}));

const app = createApp();
const detection = {
  version: '1.0.0', suggestedDomains: ['robotics_automation'], uncertain: false,
  ranked: [{ domain: 'robotics_automation', label: 'Robotics and automation', score: 62,
    matchedSkills: ['Arduino'], evidence: [{ excerpt: 'Built a robot using Arduino.' }], reasons: ['Project evidence'] }],
  note: 'Scores are evidence signals, not probabilities.',
};

beforeEach(() => {
  vi.mocked(engineFetch).mockReset();
  vi.mocked(engineFetch).mockResolvedValue(new Response(JSON.stringify(detection)));
});

async function user(role = 'candidate') {
  const agent = request.agent(app);
  const registration = await agent.post('/api/auth/register').send({
    name: 'Domain Test Candidate', email: `domains-${Date.now()}-${Math.random()}@test.local`,
    password: 'DomainTest!2026', role,
  });
  expect(registration.status).toBe(201);
  return { agent, id: registration.body.user.id as string };
}

async function ownedResume() {
  const owner = await user();
  const resume = await Resume.create({
    user: owner.id, originalName: 'domain-test.pdf', storageName: 'domain-test.pdf',
    mimeType: 'application/pdf', size: 100, fullText: 'Built a robot using Arduino.',
    profile: { skills: [{ skill: 'Arduino' }], projects: [{ text: 'Built a robot using Arduino.' }] },
  });
  return { ...owner, resumeId: resume.id as string };
}

describe('resume domain detection and confirmation', () => {
  it('requires authentication and rejects recruiter access to both endpoints', async () => {
    const id = new mongoose.Types.ObjectId().toString();
    expect((await request(app).post(`/api/resumes/${id}/domains/detect`)).status).toBe(401);
    expect((await request(app).put(`/api/resumes/${id}/domains`).send({ confirmedDomains: ['general'] })).status).toBe(401);
    const recruiter = await user('recruiter');
    expect((await recruiter.agent.post(`/api/resumes/${id}/domains/detect`)).status).toBe(403);
    expect((await recruiter.agent.put(`/api/resumes/${id}/domains`).send({ confirmedDomains: ['general'] })).status).toBe(403);
    expect(engineFetch).not.toHaveBeenCalled();
  });

  it('enforces ownership before classifier calls or writes', async () => {
    const owner = await ownedResume(), other = await user();
    expect((await other.agent.post(`/api/resumes/${owner.resumeId}/domains/detect`)).status).toBe(404);
    expect((await other.agent.put(`/api/resumes/${owner.resumeId}/domains`).send({ confirmedDomains: ['general'] })).status).toBe(404);
    expect(engineFetch).not.toHaveBeenCalled();
    const stored = await Resume.findById(owner.resumeId);
    expect(stored?.domainDetection).toBeUndefined();
    expect(stored?.confirmedDomains).toEqual([]);
  });

  it('persists detected evidence separately from the candidate-confirmed domains', async () => {
    const owner = await ownedResume();
    await owner.agent.put(`/api/resumes/${owner.resumeId}/domains`).send({ confirmedDomains: ['mechanical_core'] });
    const response = await owner.agent.post(`/api/resumes/${owner.resumeId}/domains/detect`);
    expect(response.status).toBe(200);
    expect(response.body.detection).toEqual(detection);
    expect(response.body.confirmedDomains).toEqual(['mechanical_core']);
    const [path, init] = vi.mocked(engineFetch).mock.calls[0];
    expect(path).toBe('/domains/classify');
    expect(JSON.parse(String(init?.body)).profile.projects[0].text).toBe('Built a robot using Arduino.');
    const reloaded = await Resume.findById(owner.resumeId);
    expect(reloaded?.domainDetection).toEqual(detection);
    expect(reloaded?.confirmedDomains).toEqual(['mechanical_core']);
  });

  it('deduplicates confirmed domains and persists the confirmation timestamp across requests', async () => {
    const owner = await ownedResume();
    const response = await owner.agent.put(`/api/resumes/${owner.resumeId}/domains`).send({
      confirmedDomains: ['robotics_automation', 'electronics_embedded', 'robotics_automation'],
    });
    expect(response.status).toBe(200);
    expect(response.body.confirmedDomains).toEqual(['robotics_automation', 'electronics_embedded']);
    const reloaded = await owner.agent.get(`/api/resumes/${owner.resumeId}`);
    expect(reloaded.status).toBe(200);
    expect(reloaded.body.resume.confirmedDomains).toEqual(response.body.confirmedDomains);
    expect(new Date(reloaded.body.resume.domainConfirmedAt).getTime()).not.toBeNaN();
    expect(engineFetch).not.toHaveBeenCalled();
  });

  it('rejects missing, empty, unknown, wrongly typed and excessive domain selections', async () => {
    const owner = await ownedResume();
    for (const payload of [ {}, { confirmedDomains: [] }, { confirmedDomains: ['unknown'] },
      { confirmedDomains: 'software_it' }, { confirmedDomains: ['software_it', 'robotics_automation', 'data_analytics', 'general'] } ]) {
      expect((await owner.agent.put(`/api/resumes/${owner.resumeId}/domains`).send(payload)).status).toBe(400);
    }
    expect((await Resume.findById(owner.resumeId))?.confirmedDomains).toEqual([]);
    expect(engineFetch).not.toHaveBeenCalled();
  });

  it('returns a service error and preserves previous evidence when classification fails', async () => {
    const owner = await ownedResume();
    await Resume.findByIdAndUpdate(owner.resumeId, { domainDetection: detection, confirmedDomains: ['robotics_automation'] });
    vi.mocked(engineFetch).mockResolvedValueOnce(new Response('Unavailable', { status: 503 }));
    const response = await owner.agent.post(`/api/resumes/${owner.resumeId}/domains/detect`);
    expect(response.status).toBe(503);
    expect(response.body.error).toContain('unavailable');
    const stored = await Resume.findById(owner.resumeId);
    expect(stored?.domainDetection).toEqual(detection);
    expect(stored?.confirmedDomains).toEqual(['robotics_automation']);
  });
});
