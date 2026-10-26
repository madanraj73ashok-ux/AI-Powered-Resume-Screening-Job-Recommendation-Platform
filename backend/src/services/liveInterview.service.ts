import { z } from 'zod';
import { ApiError } from '../middleware/errors';
import { InterviewSession } from '../models/InterviewSession';
import { InterviewEvent, EVENT_TYPES } from '../models/InterviewEvent';
import { getSessionOwned, describeSession } from './interview.service';
import { getResumeOwned } from './resume.service';
import { engineFetch } from './aiEngine';

export const draftSchema = z.object({ questionId: z.string().min(1).max(100), text: z.string().max(8000),
  reviewRequired: z.boolean().default(true) });
export const eventSchema = z.object({ type: z.enum(EVENT_TYPES), faceCount: z.number().int().min(0).max(20).optional() });

export async function requireLive(id: string, userId: string, active = true) {
  const session = await getSessionOwned(id, userId);
  if (session.mode !== 'voice') throw new ApiError(400, 'This is a text interview.');
  if (active && session.status !== 'in_progress') throw new ApiError(409, 'This interview has ended.');
  return session;
}

export async function voiceConfiguration() {
  try {
    const response = await engineFetch('/speech/status');
    if (!response.ok) throw new Error();
    return await response.json();
  } catch {
    return { ready: false, sttReady: false, ttsReady: false, voices: [], mode: 'local-chunked-half-duplex',
      setup: 'Start the local engine and provision the offline speech models. Text interviews remain available.' };
  }
}

export async function liveState(id: string, userId: string, kind: 'question' | 'greeting' = 'question') {
  const session = await requireLive(id, userId, false);
  const resume = await getResumeOwned(session.resume.toString(), userId);
  const question = session.questions[session.currentIndex];
  const candidateName = String(resume.profile.name ?? 'candidate');
  const interviewerText = question ? (kind === 'greeting'
    ? `Hello ${candidateName}. I heard your greeting. Let's begin. ${question.text}`
    : session.currentIndex === 0
    ? `Hello ${candidateName}. Welcome to your ${session.interviewType.toLowerCase()} interview. Take your time; you can pause or switch to text whenever you need. ${question.text}`
    : `${question.isFollowUp ? "Let's explore that a little further." : 'Thank you. Let us move to the next question.'} ${question.text}`)
    : 'Thank you for sharing your experience. Your interview questions are complete. You can now finish and review your report.';
  return { ...describeSession(session), candidateName, resumeName: resume.originalName, interviewerText,
    elapsedSeconds: Math.floor(((session.completedAt ?? new Date()).getTime() - session.startedAt.getTime()) / 1000),
    events: await InterviewEvent.find({ session: id, user: userId }).sort({ at: 1 }).limit(500).lean() };
}

export async function saveDraft(id: string, userId: string, input: z.infer<typeof draftSchema>) {
  const session = await requireLive(id, userId);
  const q = session.questions[session.currentIndex];
  if (!q || q.id !== input.questionId) throw new ApiError(409, 'Question changed. Reload the saved session.');
  const updated = await InterviewSession.updateOne({ _id: id, user: userId, status: 'in_progress',
    currentIndex: session.currentIndex, __v: session.get('__v') },
  { $set: { live: { draftQuestionId: q.id, draftTranscript: input.text.trim(), reviewRequired: input.reviewRequired } } });
  if (!updated.matchedCount) throw new ApiError(409, 'Question changed. Reload the saved session.');
}

export async function logEvent(id: string, userId: string, input: z.infer<typeof eventSchema>) {
  await requireLive(id, userId);
  if (await InterviewEvent.countDocuments({ session: id, user: userId }) >= 500) return;
  await InterviewEvent.create({ session: id, user: userId, ...input });
}

export async function questionAudio(id: string, userId: string, kind: 'question' | 'greeting' = 'question') {
  const state = await liveState(id, userId, kind);
  if (state.session.status !== 'in_progress') throw new ApiError(409, 'This interview has ended.');
  const response = await engineFetch('/speech/synthesize', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: state.interviewerText, voice: state.session.voice, rate: state.session.speakingRate }) });
  if (!response.ok) throw new ApiError(response.status === 429 ? 429 : 503, 'Local speech output is unavailable. Retry or continue in text mode.');
  return { audio: Buffer.from(await response.arrayBuffer()), text: state.interviewerText };
}

export async function transcribeAudio(audio: Buffer) {
  const response = await engineFetch('/speech/transcribe', { method: 'POST',
    headers: { 'Content-Type': 'application/octet-stream' }, body: new Blob([new Uint8Array(audio)]) });
  if (!response.ok) throw new ApiError(response.status === 429 ? 429 : 503, 'Local transcription is unavailable. Retry or use text mode.');
  return z.object({ text: z.string().max(8000), reviewRequired: z.boolean(), reason: z.string().nullable().optional() }).parse(await response.json());
}
