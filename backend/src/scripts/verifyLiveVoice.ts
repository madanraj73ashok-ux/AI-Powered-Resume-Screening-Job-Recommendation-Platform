/** Real local HTTP + authenticated WebSocket + Whisper + Piper integration.
 * Uses synthetic speech and a synthetic resume, never a person's microphone.
 * Run with the three services already running.
 */
import { readFile } from 'fs/promises';
import path from 'path';
import { WebSocket } from 'ws';

const api = 'http://localhost:4000/api';
let cookie = '';
async function call(route: string, init: RequestInit = {}) {
  const response = await fetch(api + route, { ...init, headers: { Cookie: cookie, ...init.headers } });
  if (!response.ok) throw new Error(`${route}: ${response.status} ${await response.text()}`);
  return response;
}
function pcm16(wav: Buffer) {
  let rate = 0, channels = 0, bits = 0, samples: Buffer | null = null;
  for (let offset = 12; offset + 8 <= wav.length;) {
    const size = wav.readUInt32LE(offset + 4), name = wav.toString('ascii', offset, offset + 4);
    if (name === 'fmt ') { channels = wav.readUInt16LE(offset + 10); rate = wav.readUInt32LE(offset + 12); bits = wav.readUInt16LE(offset + 22); }
    if (name === 'data') samples = wav.subarray(offset + 8, offset + 8 + size);
    offset += 8 + size + (size % 2);
  }
  if (!samples || channels !== 1 || bits !== 16 || !rate) throw new Error('Expected mono PCM16 WAV');
  const count = samples.length / 2;
  const output = Buffer.alloc(Math.floor(count * 16000 / rate) * 2);
  for (let i = 0; i < output.length / 2; i++) {
    const at = i * rate / 16000, lower = Math.floor(at), fraction = at - lower;
    const a = samples.readInt16LE(Math.min(count - 1, lower) * 2), b = samples.readInt16LE(Math.min(count - 1, lower + 1) * 2);
    output.writeInt16LE(Math.round(a * (1 - fraction) + b * fraction), i * 2);
  }
  return output;
}
async function main() {
  const capture = await fetch('http://localhost:5173/src/live/pcm-worklet.js');
  if (!capture.ok || !(capture.headers.get('content-type') ?? '').includes('javascript') ||
      !(await capture.text()).includes('registerProcessor')) throw new Error('Microphone AudioWorklet asset is not being served as JavaScript');
  const registered = await call('/auth/register', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Synthetic Voice Integration', email: `voice-integration-${Date.now()}@test.local`, password: 'VoiceTest!2026', role: 'candidate' }) });
  cookie = registered.headers.getSetCookie()[0].split(';')[0];
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(await readFile(path.resolve(__dirname, '../tests/fixtures/walte-okune-resume.docx')))],
    { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), 'synthetic-voice-test.docx');
  const resume = (await (await call('/resumes', { method: 'POST', body: form })).json()) as { resume: { id: string } };
  const configured = await (await call('/interviews', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ resumeId: resume.resume.id, mode: 'voice', interviewType: 'Technical', difficulty: 'Beginner', questionCount: 3, targetDurationMinutes: 10 }) })).json() as { session: { id: string } };
  const id = configured.session.id;
  const state = await (await call(`/interviews/${id}/live`)).json() as { progress: { currentQuestion: { id: string } } };
  const questionAudio = await call(`/interviews/${id}/live/speech`, { method: 'POST' });
  const questionBytes = Buffer.from(await questionAudio.arrayBuffer());
  if (questionBytes.toString('ascii', 0, 4) !== 'RIFF') throw new Error('No actual question WAV');
  const reference = 'My background is robotics engineering. My goal is an engineering role where I can apply Python. For example, I use it to process sensor data because reliable analysis matters.';
  const synthesis = await fetch('http://127.0.0.1:8000/speech/synthesize', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: reference }) });
  if (!synthesis.ok) throw new Error('Synthetic test speech failed');
  const audio = pcm16(Buffer.from(await synthesis.arrayBuffer()));
  const ws = new WebSocket(`ws://localhost:5173/api/interviews/${id}/live/audio`, { origin: 'http://localhost:5173', headers: { Cookie: cookie } });
  const queue: Record<string, unknown>[] = [], waiting: { type: string; resolve: (value: Record<string, unknown>) => void }[] = [];
  ws.on('message', bytes => {
    const message = JSON.parse(bytes.toString());
    const index = waiting.findIndex(w => w.type === message.type);
    if (message.type === 'error') console.error(message.message);
    if (index >= 0) waiting.splice(index, 1)[0].resolve(message); else queue.push(message);
  });
  const next = (type: string) => {
    const index = queue.findIndex(m => m.type === type);
    if (index >= 0) return Promise.resolve(queue.splice(index, 1)[0]);
    return new Promise<Record<string, unknown>>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out waiting for ${type}`)), 60000);
      waiting.push({ type, resolve: value => { clearTimeout(timeout); resolve(value); } });
    });
  };
  ws.on('error', error => console.error(error.message));
  try {
    await next('ready'); ws.send(JSON.stringify({ type: 'start', questionId: state.progress.currentQuestion.id })); await next('listening');
    for (let offset = 0; offset < audio.length; offset += 2048) {
      ws.send(audio.subarray(offset, offset + 2048));
      await new Promise(resolve => setTimeout(resolve, 64));
    }
    ws.send(JSON.stringify({ type: 'finish' }));
    const recognized = await next('final');
    if (!String(recognized.text).toLowerCase().includes('robotics')) throw new Error('Expected actual speech was not recognized');
    const reloaded = await (await call(`/interviews/${id}/live`)).json() as { session: { live: { draftTranscript: string }; answers: unknown[] } };
    if (reloaded.session.live.draftTranscript !== recognized.text || reloaded.session.answers.length) throw new Error('Draft did not survive reload, or was scored without confirmation');
    const scored = await (await call(`/interviews/${id}/answers`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questionId: state.progress.currentQuestion.id, answer: recognized.text }) })).json();
    const finished = await (await call(`/interviews/${id}/complete`, { method: 'POST' })).json() as { result: { liveReport: { humanReviewRequired: boolean }; answeredCount: number } };
    if (!finished.result.liveReport.humanReviewRequired || finished.result.answeredCount !== 1) throw new Error('Report metadata not persisted');
    console.log(JSON.stringify({ passed: true, fixture: 'synthetic DOCX and synthesized audio; not a human microphone test',
      questionAudioBytes: questionBytes.length, audioSeconds: audio.length / 32000, recognized: recognized.text,
      transcriptPersisted: true, explicitConfirmationBeforeScoring: true, evaluation: scored,
      reportGenerated: true, reportUrl: `http://localhost:5173/interview/results/${id}` }, null, 2));
  } finally { ws.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
