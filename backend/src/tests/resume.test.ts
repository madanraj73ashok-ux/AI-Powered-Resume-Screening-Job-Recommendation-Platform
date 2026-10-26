import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { createApp } from '../app';
import { Resume } from '../models/Resume';

// Mock the AI engine client so unit tests are hermetic (no Python needed).
// A live end-to-end run against the real engine is covered separately below.
vi.mock('../services/aiEngine', () => ({
  AiEngineError: class extends Error {
    status: number;
    constructor(message: string, status = 422) {
      super(message);
      this.status = status;
    }
  },
  extractFromBuffer: vi.fn(async () => ({
    pages: [{ page: 1, chars: 1200 }],
    fullText: 'Walte Okune\nRobotics Engineer\nC++ Python\nExperience with robotics systems.',
    profile: {
      name: 'Walte Okune',
      contact: { email: 'walteokune@email.com', phone: '(301) 765-4345' },
      summary: 'Robotics Engineer.',
      skills: [{ skill: 'Python', category: 'programming_languages', count: 2, evidence: { page: 1, quote: 'Python' } }],
      education: [],
      experience: [{ text: 'Robotics Engineer, March 2023 - Present' }],
      projects: [],
      certifications: [],
      extractionErrors: [],
      charCount: 1200,
    },
  })),
  analyzeResumeText: vi.fn(async () => ({
    summary: { overallStatus: 'Needs Review', findingsCount: 1, warnings: 1 },
    findings: [
      {
        id: 'F1',
        type: 'missing_projects',
        claim: 'Projects section',
        method: 'section detection',
        finding: 'No projects section was detected.',
        reason: 'Projects provide evidence of practical skills.',
        suggestedFollowUp: 'Can you describe one project in detail?',
        status: 'Needs Review',
        severity: 'warning',
        confidence: null,
      },
    ],
  })),
  engineHealth: vi.fn(async () => true),
}));

const app = createApp();
const FIXTURES = path.resolve(__dirname, 'fixtures');
const UPLOAD_DIR = path.resolve(process.cwd(), 'uploads');

const uniqueEmail = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;

async function candidateAgent() {
  const agent = request.agent(app);
  const email = uniqueEmail('cand');
  const res = await agent.post('/api/auth/register').send({
    name: 'Resume Tester',
    email,
    password: 'Passw0rd!x',
    role: 'candidate',
  });
  expect(res.status).toBe(201);
  return { agent, userId: res.body.user.id as string };
}

afterAll(async () => {
  // clean up uploaded files from this suite
  await Resume.deleteMany({});
});

describe('POST /api/resumes (upload)', () => {
  it('rejects unauthenticated uploads', async () => {
    const res = await request(app).post('/api/resumes');
    expect(res.status).toBe(401);
  });

  it('rejects recruiter uploads with 403', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({
      name: 'Recruiter User',
      email: uniqueEmail('rec'),
      password: 'Passw0rd!x',
      role: 'recruiter',
    });
    const res = await agent.post('/api/resumes');
    expect(res.status).toBe(403);
  });

  it('rejects unsupported file types with 400', async () => {
    const { agent } = await candidateAgent();
    const res = await agent
      .post('/api/resumes')
      .attach('file', Buffer.from('plain text'), 'notes.txt');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/PDF and DOCX/);
  });

  it('rejects a renamed non-PDF file (magic byte check)', async () => {
    const { agent } = await candidateAgent();
    const res = await agent
      .post('/api/resumes')
      .attach('file', Buffer.from('this is not a pdf at all'), 'resume.pdf');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not a valid PDF/);
  });

  it('rejects requests without a file', async () => {
    const { agent } = await candidateAgent();
    const res = await agent.post('/api/resumes');
    expect(res.status).toBe(400);
  });

  it('uploads a PDF, stores profile + analysis and writes the file privately', async () => {
    const { agent, userId } = await candidateAgent();
    const res = await agent
      .post('/api/resumes')
      .attach('file', path.join(FIXTURES, 'walte-okune-resume.pdf'));

    expect(res.status).toBe(201);
    const resume = res.body.resume;
    expect(resume.originalName).toBe('walte-okune-resume.pdf');
    expect(resume.profile.name).toBe('Walte Okune');
    expect(resume.profile.skills.length).toBeGreaterThan(0);
    expect(resume.analysis.findings.length).toBe(1);
    expect(resume.analysis.summary.overallStatus).toBe('Needs Review');
    expect(resume.fullText).toContain('Robotics');

    // file stored under uploads/<userId>/, not publicly served
    const onDisk = path.join(UPLOAD_DIR, userId, resume.storageName);
    expect(fs.existsSync(onDisk)).toBe(true);
    const http = await request(app).get(`/${resume.storageName}`);
    expect(http.status).toBe(404); // not served statically
  });

  it('uploads a DOCX resume', async () => {
    const { agent } = await candidateAgent();
    const res = await agent
      .post('/api/resumes')
      .attach('file', path.join(FIXTURES, 'walte-okune-resume.docx'));
    expect(res.status).toBe(201);
    expect(res.body.resume.originalName).toBe('walte-okune-resume.docx');
  });
});

describe('resume list/detail/analyze/delete with ownership', () => {
  it('lists only my resumes and enforces ownership on detail/delete', async () => {
    const { agent: alice, userId: aliceId } = await candidateAgent();
    const { agent: bob } = await candidateAgent();

    const uploaded = await alice
      .post('/api/resumes')
      .attach('file', path.join(FIXTURES, 'walte-okune-resume.pdf'));
    const resumeId = uploaded.body.resume.id as string;

    const list = await alice.get('/api/resumes');
    expect(list.status).toBe(200);
    expect(list.body.resumes).toHaveLength(1);
    expect(list.body.resumes[0].user).toBe(aliceId);

    // Bob cannot see or delete Alice's resume
    const bobList = await bob.get('/api/resumes');
    expect(bobList.body.resumes).toHaveLength(0);
    expect((await bob.get(`/api/resumes/${resumeId}`)).status).toBe(404);
    expect((await bob.delete(`/api/resumes/${resumeId}`)).status).toBe(404);

    // Alice can re-run analysis and update the extracted profile
    const analysis = await alice.post(`/api/resumes/${resumeId}/analyze`);
    expect(analysis.status).toBe(200);
    expect(analysis.body.resume.analysis.findings.length).toBe(1);

    const update = await alice.put(`/api/resumes/${resumeId}`).send({
      summary: 'Corrected summary by candidate.',
      skills: [{ skill: 'Robotics', category: 'engineering', count: 1 }],
    });
    expect(update.status).toBe(200);
    expect(update.body.resume.profile.summary).toBe('Corrected summary by candidate.');
    expect(update.body.resume.profile.skills).toHaveLength(1);
    expect(update.body.resume.profileEdited).toBe(true);

    // Alice deletes her resume
    const del = await alice.delete(`/api/resumes/${resumeId}`);
    expect(del.status).toBe(200);
    expect((await alice.get(`/api/resumes/${resumeId}`)).status).toBe(404);
    expect(await Resume.countDocuments({ _id: new mongoose.Types.ObjectId(resumeId) })).toBe(0);
  });
});

describe('GET /api/resumes/:id/file (authenticated download)', () => {
  const parseBinary = (res: any, done: (err: Error | null, body?: Buffer) => void) => {
    const chunks: Buffer[] = [];
    res.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    res.on('end', () => done(null, Buffer.concat(chunks)));
  };

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/resumes/000000000000000000000000/file');
    expect(res.status).toBe(401);
  });

  it('rejects recruiters with 403', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({
      name: 'Recruiter Downloader',
      email: uniqueEmail('rec-dl'),
      password: 'Passw0rd!x',
      role: 'recruiter',
    });
    const res = await agent.get('/api/resumes/000000000000000000000000/file');
    expect(res.status).toBe(403);
  });

  it('returns the original bytes to the owning candidate', async () => {
    const { agent } = await candidateAgent();
    const uploaded = await agent
      .post('/api/resumes')
      .attach('file', path.join(FIXTURES, 'walte-okune-resume.pdf'));
    const resumeId = uploaded.body.resume.id as string;

    const res = await agent
      .get(`/api/resumes/${resumeId}/file`)
      .buffer(true)
      .parse(parseBinary);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('application/pdf');
    expect(res.headers['content-disposition']).toContain('attachment');
    expect(res.headers['content-disposition']).toContain('walte-okune-resume.pdf');
    expect(res.headers['cache-control']).toBe('private, no-store');

    const original = fs.readFileSync(path.join(FIXTURES, 'walte-okune-resume.pdf'));
    expect(res.body).toBeInstanceOf(Buffer);
    expect((res.body as Buffer).equals(original)).toBe(true);
  });

  it("returns 404 for another candidate's resume", async () => {
    const { agent: alice } = await candidateAgent();
    const { agent: bob } = await candidateAgent();
    const uploaded = await alice
      .post('/api/resumes')
      .attach('file', path.join(FIXTURES, 'walte-okune-resume.pdf'));

    const res = await bob.get(`/api/resumes/${uploaded.body.resume.id}/file`);
    expect(res.status).toBe(404);
  });

  it('returns 404 when the file is missing on disk', async () => {
    const { agent, userId } = await candidateAgent();
    const uploaded = await agent
      .post('/api/resumes')
      .attach('file', path.join(FIXTURES, 'walte-okune-resume.pdf'));
    const resume = uploaded.body.resume;

    fs.unlinkSync(path.join(UPLOAD_DIR, userId, resume.storageName));
    const res = await agent.get(`/api/resumes/${resume.id}/file`);
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/no longer available/);
  });
});

// Live end-to-end coverage against the real Python engine lives in
// resume.live.test.ts (no mocks; skipped automatically when the engine is down).
