import { describe, it, expect, vi, beforeAll } from 'vitest';
import request from 'supertest';
import path from 'path';
import { createApp } from '../app';

// Hermetic interview tests: engine mocked with deterministic behaviour.
vi.mock('../services/aiEngine', () => {
  const makeQuestion = (n: number, skill: string) => ({
    id: `QTEST${n}`,
    text: `Test question ${n} about ${skill}?`,
    type: 'fundamentals',
    difficulty: 'Intermediate',
    skill,
    sourceClaim: `Resume lists ${skill}`,
    expectedConcepts: ['concept-a', 'concept-b'],
    rubric: {
      technicalAccuracy: 'accuracy',
      completeness: 'completeness',
      practicalExamples: 'examples',
      understanding: 'understanding',
    },
    maxMarks: 10,
    followUpTemplates: [],
    isFollowUp: false,
  });

  return {
    AiEngineError: class extends Error {
      status: number;
      constructor(message: string, status = 422) {
        super(message);
        this.status = status;
      }
    },
    extractFromBuffer: vi.fn(async () => ({
      pages: [{ page: 1, chars: 900 }],
      fullText: 'Resume text with Python and MongoDB experience.',
      profile: {
        name: 'Interview Tester',
        contact: { email: 'tester@example.com' },
        summary: 'Backend developer.',
        skills: [
          { skill: 'Python', category: 'programming_languages', count: 2 },
          { skill: 'MongoDB', category: 'databases', count: 2 },
        ],
        education: [],
        experience: [],
        projects: [],
        certifications: [],
        extractionErrors: [],
        charCount: 900,
      },
    })),
    analyzeResumeText: vi.fn(async () => ({
      summary: { overallStatus: 'Needs Review', findingsCount: 1 },
      findings: [{ id: 'F1', type: 'missing_projects', claim: 'Projects section' }],
    })),
    engineHealth: vi.fn(async () => true),
    generateQuestions: vi.fn(async (input: { difficulty: string; count: number }) => ({
      difficulty: input.difficulty,
      count: 4,
      questions: [
        makeQuestion(1, 'Python'),
        makeQuestion(2, 'MongoDB'),
        makeQuestion(3, 'General'),
        makeQuestion(4, 'General'),
      ],
      generatedBy: 'mock',
      note: 'mock note',
    })),
    evaluateAnswer: vi.fn(
      async (input: {
        question: { maxMarks: number; expectedConcepts: string[] };
        answer: string;
      }) => {
        const strong =
          input.answer.toLowerCase().includes('because') && input.answer.length > 80;
        return {
          marksAwarded: strong ? input.question.maxMarks * 0.8 : 3,
          maxMarks: input.question.maxMarks,
          percentage: strong ? 80 : 30,
          matchedConcepts: strong
            ? input.question.expectedConcepts
            : [input.question.expectedConcepts[0]],
          missingConcepts: strong ? [] : input.question.expectedConcepts.slice(1),
          breakdown: {
            technicalAccuracy: strong ? 0.8 : 0.3,
            completeness: strong ? 0.8 : 0.3,
            practicalExamples: strong ? 0.8 : 0.2,
            understanding: strong ? 0.8 : 0.2,
          },
          similarity: 0.5,
          explanation: strong ? 'Good technical answer.' : 'Missing concepts in this answer.',
          suggestedFollowUp: strong
            ? null
            : 'Your answer did not cover concept-b. Can you explain how that applies?',
          answerWordCount: input.answer.split(/\s+/).length,
        };
      }
    ),
  };
});

const app = createApp();
const uniqueEmail = (p: string) => `${p}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@test.local`;
const FIXTURE = path.resolve(__dirname, 'fixtures', 'walte-okune-resume.pdf');

let resumeId = '';

async function candidateAgent(name = 'cand') {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/register').send({
    name: 'Interview Candidate',
    email: uniqueEmail(name),
    password: 'Passw0rd!x',
    role: 'candidate',
  });
  expect(res.status).toBe(201);
  return agent;
}

async function uploadResume(agent: ReturnType<typeof request.agent>) {
  const res = await agent.post('/api/resumes').attach('file', FIXTURE);
  expect(res.status).toBe(201);
  return res.body.resume.id as string;
}

beforeAll(async () => {
  const agent = await candidateAgent('owner');
  resumeId = await uploadResume(agent);
});

const STRONG_ANSWER =
  'I used Python because the ecosystem fits data processing, and I built a service ' +
  'that streams records, handles failures and reduced memory usage by forty percent. ' +
  'This worked well in production and I monitored it closely.';

describe('POST /api/interviews (start)', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).post('/api/interviews').send({ resumeId: 'x' });
    expect(res.status).toBe(401);
  });

  it('rejects recruiters', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({
      name: 'Recruiter',
      email: uniqueEmail('rec'),
      password: 'Passw0rd!x',
      role: 'recruiter',
    });
    const res = await agent.post('/api/interviews').send({ resumeId });
    expect(res.status).toBe(403);
  });

  it('rejects another candidate\'s resume', async () => {
    const other = await candidateAgent('other');
    const res = await other
      .post('/api/interviews')
      .send({ resumeId, difficulty: 'Intermediate', questionCount: 3 });
    expect(res.status).toBe(404);
  });

  it('starts a session with a first question and progress', async () => {
    const agent = await candidateAgent('start');
    const ownResumeId = await uploadResume(agent);
    const res = await agent
      .post('/api/interviews')
      .send({ resumeId: ownResumeId, difficulty: 'Intermediate', questionCount: 4 });
    expect(res.status).toBe(201);
    expect(res.body.progress.total).toBe(4);
    expect(res.body.progress.answered).toBe(0);
    expect(res.body.progress.currentQuestion.id).toBe('QTEST1');
    expect(res.body.session.difficulty).toBe('Intermediate');
    expect(res.body.session.questions.length).toBe(4);
  });

  it('validates difficulty and question count', async () => {
    const agent = await candidateAgent('valid');
    const ownResumeId = await uploadResume(agent);
    const badDifficulty = await agent
      .post('/api/interviews')
      .send({ resumeId: ownResumeId, difficulty: 'Impossible', questionCount: 5 });
    expect(badDifficulty.status).toBe(400);

    const badCount = await agent
      .post('/api/interviews')
      .send({ resumeId: ownResumeId, difficulty: 'Beginner', questionCount: 99 });
    expect(badCount.status).toBe(400);
  });
});

describe('answering, follow-ups and resuming', () => {
  it('rejects a mismatched question id and accepts the current one', async () => {
    const agent = await candidateAgent('answer');
    const ownResumeId = await uploadResume(agent);
    const started = await agent
      .post('/api/interviews')
      .send({ resumeId: ownResumeId, difficulty: 'Intermediate', questionCount: 4 });
    const sessionId = started.body.session.id;

    const wrong = await agent
      .post(`/api/interviews/${sessionId}/answers`)
      .send({ questionId: 'QTEST4', answer: STRONG_ANSWER });
    expect(wrong.status).toBe(400);

    const ok = await agent
      .post(`/api/interviews/${sessionId}/answers`)
      .send({ questionId: 'QTEST1', answer: STRONG_ANSWER });
    expect(ok.status).toBe(200);
    expect(ok.body.evaluation.percentage).toBe(80);
    expect(ok.body.progress.answered).toBe(1);
    expect(ok.body.nextQuestion.id).toBe('QTEST2');
  });

  it('adds an answer-dependent follow-up for a weak answer', async () => {
    const agent = await candidateAgent('followup');
    const ownResumeId = await uploadResume(agent);
    const started = await agent
      .post('/api/interviews')
      .send({ resumeId: ownResumeId, difficulty: 'Intermediate', questionCount: 4 });
    const sessionId = started.body.session.id;

    const res = await agent
      .post(`/api/interviews/${sessionId}/answers`)
      .send({ questionId: 'QTEST1', answer: 'Not much.' });
    expect(res.status).toBe(200);
    expect(res.body.evaluation.percentage).toBe(30);
    expect(res.body.nextQuestion.isFollowUp).toBe(true);
    expect(res.body.nextQuestion.text).toContain('concept-b');
    expect(res.body.progress.total).toBe(5); // follow-up appended
  });

  it('persists progress so an interrupted interview can resume', async () => {
    const agent = await candidateAgent('resume');
    const ownResumeId = await uploadResume(agent);
    const started = await agent
      .post('/api/interviews')
      .send({ resumeId: ownResumeId, difficulty: 'Intermediate', questionCount: 4 });
    const sessionId = started.body.session.id;

    await agent
      .post(`/api/interviews/${sessionId}/answers`)
      .send({ questionId: 'QTEST1', answer: STRONG_ANSWER });

    // "reload" the interview
    const reloaded = await agent.get(`/api/interviews/${sessionId}`);
    expect(reloaded.status).toBe(200);
    expect(reloaded.body.progress.answered).toBe(1);
    expect(reloaded.body.progress.currentQuestion.id).toBe('QTEST2');
    expect(reloaded.body.session.status).toBe('in_progress');

    const next = await agent
      .post(`/api/interviews/${sessionId}/answers`)
      .send({ questionId: 'QTEST2', answer: STRONG_ANSWER });
    expect(next.status).toBe(200);
    expect(next.body.progress.answered).toBe(2);
  });

  it('lists only my interviews', async () => {
    const agent = await candidateAgent('list');
    const ownResumeId = await uploadResume(agent);
    await agent
      .post('/api/interviews')
      .send({ resumeId: ownResumeId, difficulty: 'Beginner', questionCount: 3 });
    const list = await agent.get('/api/interviews');
    expect(list.status).toBe(200);
    expect(list.body.sessions.length).toBe(1);
    expect(list.body.sessions[0].status).toBe('in_progress');
    expect(list.body.sessions[0].resume).toBeDefined();
  });
});

describe('completion and results', () => {
  it('completes an interview and returns a detailed result', async () => {
    const agent = await candidateAgent('complete');
    const ownResumeId = await uploadResume(agent);
    const started = await agent
      .post('/api/interviews')
      .send({ resumeId: ownResumeId, difficulty: 'Intermediate', questionCount: 3 });
    const sessionId = started.body.session.id;

    await agent
      .post(`/api/interviews/${sessionId}/answers`)
      .send({ questionId: 'QTEST1', answer: STRONG_ANSWER });
    await agent
      .post(`/api/interviews/${sessionId}/answers`)
      .send({ questionId: 'QTEST2', answer: 'Short.' });

    const complete = await agent.post(`/api/interviews/${sessionId}/complete`);
    expect(complete.status).toBe(200);
    const result = complete.body.result;
    expect(result.overall.percentage).toBeGreaterThan(0);
    expect(result.overall.percentage).toBeLessThan(100);
    expect(result.answeredCount).toBe(2);
    expect(result.questionCount).toBeGreaterThanOrEqual(3);
    expect(result.skillScores.length).toBeGreaterThan(0);
    expect(Array.isArray(result.strengths)).toBe(true);
    expect(Array.isArray(result.improvements)).toBe(true);
    expect(result.missingConcepts).toContain('concept-b');
    expect(result.recommendations.length).toBeGreaterThan(0);
    expect(result.summary).toContain('rubric-based');

    // result endpoint and list show completion
    const fetched = await agent.get(`/api/interviews/${sessionId}/result`);
    expect(fetched.status).toBe(200);
    expect(fetched.body.result.overall.percentage).toBe(result.overall.percentage);

    const list = await agent.get('/api/interviews');
    expect(list.body.sessions[0].status).toBe('completed');
    expect(list.body.sessions[0].score).toBe(result.overall.percentage);

    // cannot answer after completion
    const late = await agent
      .post(`/api/interviews/${sessionId}/answers`)
      .send({ questionId: 'QTEST3', answer: STRONG_ANSWER });
    expect(late.status).toBe(400);

    // completing again is idempotent
    const again = await agent.post(`/api/interviews/${sessionId}/complete`);
    expect(again.status).toBe(200);
    expect(again.body.result.id).toBe(result.id);
  });

  it("does not expose another candidate's session or results", async () => {
    const owner = await candidateAgent('sessionowner');
    const ownerResume = await uploadResume(owner);
    const started = await owner
      .post('/api/interviews')
      .send({ resumeId: ownerResume, difficulty: 'Beginner', questionCount: 3 });
    const sessionId = started.body.session.id;
    await owner
      .post(`/api/interviews/${sessionId}/answers`)
      .send({ questionId: 'QTEST1', answer: STRONG_ANSWER });
    await owner.post(`/api/interviews/${sessionId}/complete`);

    const intruder = await candidateAgent('intruder');
    expect((await intruder.get(`/api/interviews/${sessionId}`)).status).toBe(404);
    expect((await intruder.get(`/api/interviews/${sessionId}/result`)).status).toBe(404);
    expect(
      (
        await intruder
          .post(`/api/interviews/${sessionId}/answers`)
          .send({ questionId: 'QTEST2', answer: STRONG_ANSWER })
      ).status
    ).toBe(404);
  });

  it('requires at least one answer before finishing', async () => {
    const agent = await candidateAgent('empty');
    const ownResumeId = await uploadResume(agent);
    const started = await agent
      .post('/api/interviews')
      .send({ resumeId: ownResumeId, difficulty: 'Beginner', questionCount: 3 });
    const res = await agent.post(`/api/interviews/${started.body.session.id}/complete`);
    expect(res.status).toBe(400);
  });
});
