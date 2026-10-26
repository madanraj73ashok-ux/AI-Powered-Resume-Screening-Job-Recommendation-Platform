import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { WebSocket } from 'ws';
import { Server } from 'http';
import { AddressInfo } from 'net';
import { createApp } from '../app';
import { attachLiveAudio } from '../services/liveAudio';
import { Resume } from '../models/Resume';
import { InterviewEvent } from '../models/InterviewEvent';
import { InterviewSession } from '../models/InterviewSession';

// Protocol/persistence tests are hermetic. Real speech is tested separately by verify_voice.py.
vi.mock('../services/aiEngine', () => ({
  AiEngineError: class extends Error { status = 503; },
  generateQuestions: vi.fn(async (input: { difficulty: string }) => ({ generatedBy: 'curated test bank',
    questions: [1, 2, 3].map(n => ({ id: `live-q${n}`, text: n === 1 ? 'Please introduce yourself.' : `Explain Python example ${n}.`,
      type: n === 1 ? 'introduction' : 'fundamentals', difficulty: input.difficulty,
      skill: 'Python', expectedConcepts: ['example'], maxMarks: 10, followUpTemplates: [] })) })),
  evaluateAnswer: vi.fn(async () => ({ marksAwarded: 8, maxMarks: 10, percentage: 80,
    explanation: 'Test rubric feedback', matchedConcepts: ['example'], missingConcepts: [],
    breakdown: { technicalAccuracy: 0.8 }, similarity: 0.5, suggestedFollowUp: null })),
  engineFetch: vi.fn(async (path: string) => path === '/speech/status'
    ? new Response(JSON.stringify({ ready: true, sttReady: true, ttsReady: true, voices: [{ id: 'lessac', name: 'Local voice' }] }))
    : path === '/speech/transcribe'
      ? new Response(JSON.stringify({ text: 'Synthetic protocol test transcript.', reviewRequired: false }))
      : new Response(Buffer.from('RIFF-test-audio'), { headers: { 'Content-Type': 'audio/wav' } })),
}));

const app = createApp();
let server: Server, base: string, closeAudio: () => void;
beforeAll(async () => {
  server = app.listen(0, '127.0.0.1'); closeAudio = attachLiveAudio(server);
  await new Promise<void>(resolve => server.once('listening', resolve));
  base = `ws://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(async () => { closeAudio(); await new Promise<void>(resolve => server.close(() => resolve())); });

async function candidate(role = 'candidate') {
  const agent = request.agent(app);
  const registered = await agent.post('/api/auth/register').send({ name: 'Voice Tester',
    email: `voice-${Date.now()}-${Math.random()}@test.local`, password: 'TestVoice!2026', role });
  expect(registered.status).toBe(201);
  const cookie = (registered.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
  return { agent, cookie, user: registered.body.user.id };
}
async function session() {
  const owner = await candidate();
  const resume = await Resume.create({ user: owner.user, originalName: 'voice-test.pdf', storageName: 'voice-test.pdf',
    mimeType: 'application/pdf', size: 100, fullText: 'Python projects', profile: { name: 'Actual Resume Name', skills: [{ skill: 'Python' }] } });
  const response = await owner.agent.post('/api/interviews').send({ resumeId: resume.id, mode: 'voice',
    interviewType: 'Mixed', difficulty: 'Intermediate', questionCount: 3, targetDurationMinutes: 10 });
  expect(response.status).toBe(201);
  return { ...owner, id: response.body.session.id, resumeId: resume.id };
}
function socketInbox(url: string, cookie: string) {
  const ws = new WebSocket(url, { origin: 'http://localhost:5173', headers: { Cookie: cookie } });
  const messages: Record<string, unknown>[] = [];
  const waiters: { type: string; resolve: (data: Record<string, unknown>) => void }[] = [];
  ws.on('message', bytes => {
    const data = JSON.parse(bytes.toString());
    const index = waiters.findIndex(w => w.type === data.type);
    if (index >= 0) waiters.splice(index, 1)[0].resolve(data); else messages.push(data);
  });
  return { ws, wait(type: string): Promise<Record<string, unknown>> {
    const index = messages.findIndex(m => m.type === type);
    if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]);
    return new Promise(resolve => waiters.push({ type, resolve }));
  } };
}

describe('local live interview API', () => {
  it('requires candidate authentication for configuration', async () => {
    expect((await request(app).get('/api/interviews/configuration')).status).toBe(401);
    const recruiter = await candidate('recruiter');
    expect((await recruiter.agent.get('/api/interviews/configuration')).status).toBe(403);
  });

  it('saves configuration and exposes current subtitles without answer hints', async () => {
    const own = await session();
    const state = await own.agent.get(`/api/interviews/${own.id}/live`);
    expect(state.status).toBe(200);
    expect(state.body.candidateName).toBe('Actual Resume Name');
    expect(state.body.interviewerText).toContain('Welcome');
    expect(state.body.session.mode).toBe('voice');
    expect(state.body.session.targetDurationMinutes).toBe(10);
    expect((await own.agent.post('/api/interviews').send({ resumeId: own.resumeId, mode: 'voice', targetDurationMinutes: 11 })).status).toBe(400);
  });

  it('persists transcript drafts across reload and rejects stale drafts', async () => {
    const own = await session();
    expect((await own.agent.put(`/api/interviews/${own.id}/live/transcript`).send({ questionId: 'live-q1', text: 'My reviewed transcript.' })).status).toBe(200);
    const reloaded = await own.agent.get(`/api/interviews/${own.id}/live`);
    expect(reloaded.body.session.live.draftTranscript).toBe('My reviewed transcript.');
    expect((await own.agent.put(`/api/interviews/${own.id}/live/transcript`).send({ questionId: 'wrong', text: 'Stale' })).status).toBe(409);
    expect((await own.agent.put(`/api/interviews/${own.id}/live/transcript`).send({ questionId: 'live-q1', text: 'x'.repeat(8001) })).status).toBe(400);
  });

  it('enforces ownership for transcripts, events and question audio', async () => {
    const own = await session(), intruder = await candidate();
    expect((await intruder.agent.get(`/api/interviews/${own.id}/live`)).status).toBe(404);
    expect((await intruder.agent.put(`/api/interviews/${own.id}/live/transcript`).send({ questionId: 'live-q1', text: 'Other user' })).status).toBe(404);
    expect((await intruder.agent.post(`/api/interviews/${own.id}/live/events`).send({ type: 'no_face' })).status).toBe(404);
    expect((await intruder.agent.post(`/api/interviews/${own.id}/live/speech`)).status).toBe(404);
  });

  it('stores bounded presence metadata without media or score penalties', async () => {
    const own = await session();
    expect((await own.agent.post(`/api/interviews/${own.id}/live/events`).send({ type: 'multiple_faces', faceCount: 2, frame: 'not-stored' })).status).toBe(201);
    const event = await InterviewEvent.findOne({ session: own.id }).lean();
    expect(event?.faceCount).toBe(2); expect(event).not.toHaveProperty('frame');
    expect((await own.agent.post(`/api/interviews/${own.id}/live/events`).send({ type: 'cheating_detected' })).status).toBe(400);
    await own.agent.post(`/api/interviews/${own.id}/answers`).send({ questionId: 'live-q1', answer: 'An example technical answer.' });
    const complete = await own.agent.post(`/api/interviews/${own.id}/complete`);
    expect(complete.status).toBe(200);
    expect(complete.body.result.liveReport.humanReviewRequired).toBe(true);
    expect(complete.body.result.liveReport.candidateName).toBe('Actual Resume Name');
    expect(complete.body.result.overall.marksAwarded).toBe(8);
    expect((await own.agent.post(`/api/interviews/${own.id}/live/speech`)).status).toBe(409);
  });

  it('coordinates authenticated PCM, saves final transcript, and supports reconnect', async () => {
    const own = await session();
    const audio = socketInbox(`${base}/api/interviews/${own.id}/live/audio`, own.cookie);
    expect((await audio.wait('ready')).sampleRate).toBe(16000);
    audio.ws.send(JSON.stringify({ type: 'start', questionId: 'live-q1' }));
    await audio.wait('listening');
    audio.ws.send(Buffer.alloc(2048, 20)); audio.ws.send(JSON.stringify({ type: 'finish' }));
    const final = await audio.wait('final');
    expect(final.text).toBe('Synthetic protocol test transcript.');
    expect((await InterviewSession.findById(own.id))?.answers).toHaveLength(0);
    expect((await InterviewSession.findById(own.id))?.live?.draftTranscript).toBe(final.text);
    await new Promise<void>(resolve => { audio.ws.once('close', resolve); audio.ws.close(); });
    const again = socketInbox(`${base}/api/interviews/${own.id}/live/audio`, own.cookie);
    await again.wait('ready');
    again.ws.send(JSON.stringify({ type: 'start', questionId: 'live-q1' })); await again.wait('listening');
    const closed = new Promise<number>(resolve => again.ws.once('close', code => resolve(code)));
    again.ws.send(Buffer.alloc(32769)); expect(await closed).toBe(1009);
  });

  it('rejects missing cookies, hostile origins, and another candidate on WebSocket upgrade', async () => {
    const own = await session(), intruder = await candidate();
    for (const [cookie, origin, expected] of [['', 'http://localhost:5173', 401],
      [own.cookie, 'https://untrusted.invalid', 403], [intruder.cookie, 'http://localhost:5173', 404]] as const) {
      const status = await new Promise<number>(resolve => {
        const ws = new WebSocket(`${base}/api/interviews/${own.id}/live/audio`, { origin, headers: { Cookie: cookie } });
        ws.on('error', () => undefined);
        ws.on('unexpected-response', (_req, response) => { response.resume(); ws.terminate(); resolve(response.statusCode ?? 0); });
      });
      expect(status).toBe(expected);
    }
  });
});
