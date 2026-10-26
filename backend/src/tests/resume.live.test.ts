import { describe, it, expect } from 'vitest';
import request from 'supertest';
import path from 'path';
import { createApp } from '../app';

/**
 * True end-to-end tests: Express backend -> real Python AI engine -> MongoDB.
 * Skipped automatically when the engine is not running. Start it with:
 *   cd ai-engine; .\.venv\Scripts\uvicorn.exe app.main:app --host 127.0.0.1 --port 8000
 */
const app = createApp();
const FIXTURES = path.resolve(__dirname, 'fixtures');
const uniqueEmail = (p: string) =>
  `${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;

const engineUp = await (async () => {
  try {
    const res = await fetch('http://127.0.0.1:8000/health', {
      signal: AbortSignal.timeout(1500),
    });
    return res.ok;
  } catch {
    return false;
  }
})();

async function candidateAgent() {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/register').send({
    name: 'Live Engine Tester',
    email: uniqueEmail('live'),
    password: 'Passw0rd!x',
    role: 'candidate',
  });
  expect(res.status).toBe(201);
  return agent;
}

describe.skipIf(!engineUp)('live engine end-to-end', () => {
  it('uploads a real PDF and extracts the full profile through the engine', async () => {
    const agent = await candidateAgent();
    const res = await agent
      .post('/api/resumes')
      .attach('file', path.join(FIXTURES, 'walte-okune-resume.pdf'));

    expect(res.status).toBe(201);
    const { profile, analysis, fullText } = res.body.resume;
    expect(profile.name).toContain('Walte');
    expect(profile.contact.email).toBe('walteokune@email.com');
    expect(profile.contact.phone).toContain('765');
    expect(profile.skills.length).toBeGreaterThanOrEqual(4);
    expect(profile.education.length).toBeGreaterThanOrEqual(1);
    expect(profile.experience.length).toBeGreaterThanOrEqual(2);
    expect(fullText).toContain('Robotics');
    // analysis ran automatically on upload
    expect(analysis.findings.length).toBeGreaterThan(0);
    expect(analysis.summary.overallStatus).toBeDefined();
  });

  it('uploads a real DOCX and extracts skills/experience', async () => {
    const agent = await candidateAgent();
    const res = await agent
      .post('/api/resumes')
      .attach('file', path.join(FIXTURES, 'walte-okune-resume.docx'));
    expect(res.status).toBe(201);
    expect(res.body.resume.profile.skills.length).toBeGreaterThanOrEqual(4);
    expect(res.body.resume.profile.experience.length).toBeGreaterThanOrEqual(2);
  });

  it('handles an image-only scan honestly (no OCR configured)', async () => {
    const agent = await candidateAgent();
    const res = await agent
      .post('/api/resumes')
      .attach('file', path.join(FIXTURES, 'empty-image-only.pdf'));
    // Stored with an honest "no text / OCR not configured" note, or rejected.
    expect([201, 422]).toContain(res.status);
    if (res.status === 201) {
      const errors: string = (res.body.resume.profile.extractionErrors ?? []).join(' ');
      expect(errors).toMatch(/OCR|No text/);
    }
  });

  it('re-analyzes a stored resume through the engine', async () => {
    const agent = await candidateAgent();
    const uploaded = await agent
      .post('/api/resumes')
      .attach('file', path.join(FIXTURES, 'walte-okune-resume.pdf'));
    const id = uploaded.body.resume.id;
    const res = await agent.post(`/api/resumes/${id}/analyze`);
    expect(res.status).toBe(200);
    expect(res.body.resume.analysis.findings.length).toBeGreaterThan(0);
    expect(res.body.resume.analysis.analyzedAt).toBeDefined();
  });
});
