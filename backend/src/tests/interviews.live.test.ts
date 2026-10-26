import { describe, it, expect } from 'vitest';
import request from 'supertest';
import path from 'path';
import { createApp } from '../app';

/**
 * Full interview workflow against the real Python engine:
 * resume upload -> question generation -> answers -> completion -> results.
 * Skipped automatically when the engine is not running.
 */
const app = createApp();
const FIXTURE = path.resolve(__dirname, 'fixtures', 'walte-okune-resume.pdf');
const uniqueEmail = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;

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

const ANSWER =
  'In my project I built the module myself using the technology because it reduced ' +
  'processing time by about 30 percent. For example, I tested two approaches, compared ' +
  'the trade-offs, and chose the one that was simpler to maintain. I monitored the result ' +
  'in production and documented the decisions.';

describe.skipIf(!engineUp)('live interview workflow', () => {
  it('runs a complete interview and produces rubric-based results', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({
      name: 'Live Interviewer',
      email: uniqueEmail('live-int'),
      password: 'Passw0rd!x',
      role: 'candidate',
    });

    const uploaded = await agent
      .post('/api/resumes')
      .attach('file', FIXTURE);
    expect(uploaded.status).toBe(201);
    const resumeId = uploaded.body.resume.id;

    const started = await agent
      .post('/api/interviews')
      .send({ resumeId, difficulty: 'Intermediate', questionCount: 5 });
    expect(started.status).toBe(201);
    const sessionId = started.body.session.id;
    expect(started.body.progress.total).toBe(5);

    // Questions must be personalized from the resume.
    const allText = started.body.session.questions.map((q: { text: string }) => q.text).join(' ');
    expect(allText.length).toBeGreaterThan(200);
    const claims = started.body.session.questions
      .map((q: { sourceClaim?: string }) => q.sourceClaim ?? '')
      .join(' ');
    expect(claims).toMatch(/Python|Robotics|Resume|experience|projects/i);

    // Answer questions one at a time until none remain.
    let guard = 0;
    for (;;) {
      guard += 1;
      expect(guard).toBeLessThan(20);
      const current = (await agent.get(`/api/interviews/${sessionId}`)).body.progress
        .currentQuestion;
      if (!current) break;
      const res = await agent
        .post(`/api/interviews/${sessionId}/answers`)
        .send({ questionId: current.id, answer: ANSWER });
      expect(res.status).toBe(200);
      expect(res.body.evaluation.marksAwarded).toBeGreaterThanOrEqual(0);
      expect(res.body.evaluation.maxMarks).toBeGreaterThan(0);
      expect(res.body.evaluation.explanation).toContain('rubric');
      expect(res.body.progress.answered).toBeGreaterThan(0);
    }

    const complete = await agent.post(`/api/interviews/${sessionId}/complete`);
    expect(complete.status).toBe(200);
    const result = complete.body.result;
    expect(result.overall.percentage).toBeGreaterThanOrEqual(0);
    expect(result.overall.percentage).toBeLessThanOrEqual(100);
    expect(result.skillScores.length).toBeGreaterThan(0);
    expect(result.questionCount).toBeGreaterThanOrEqual(5);
    expect(result.summary).toContain('rubric-based');

    const fetched = await agent.get(`/api/interviews/${sessionId}/result`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.result.overall.percentage).toBe(result.overall.percentage);
  });

  it('honours the difficulty level on generated questions', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({
      name: 'Beginner Interviewer',
      email: uniqueEmail('live-beg'),
      password: 'Passw0rd!x',
      role: 'candidate',
    });
    const uploaded = await agent.post('/api/resumes').attach('file', FIXTURE);
    const started = await agent
      .post('/api/interviews')
      .send({ resumeId: uploaded.body.resume.id, difficulty: 'Beginner', questionCount: 4 });
    expect(started.status).toBe(201);
    for (const q of started.body.session.questions) {
      expect(q.difficulty).toBe('Beginner');
      expect(q.maxMarks).toBeLessThanOrEqual(8);
    }
  });
});
