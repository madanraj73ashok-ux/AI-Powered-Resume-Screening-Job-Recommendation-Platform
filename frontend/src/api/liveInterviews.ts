import client from './client';
import { InterviewSession, InterviewProgress } from './interviews';

export interface VoiceConfiguration {
  ready: boolean; sttReady: boolean; ttsReady: boolean; voices: { id: string; name: string }[];
  mode: string; setup?: string;
}
export interface LiveState {
  session: InterviewSession; progress: InterviewProgress; candidateName: string; resumeName: string;
  interviewerText: string; elapsedSeconds: number;
  events: { type: string; at: string; faceCount?: number }[];
}
export async function getVoiceConfiguration(): Promise<VoiceConfiguration> {
  return (await client.get('/interviews/configuration')).data;
}
export async function getLiveState(id: string): Promise<LiveState> {
  return (await client.get(`/interviews/${id}/live`)).data;
}
export async function getQuestionSpeech(id: string, signal: AbortSignal, kind: 'question' | 'greeting' = 'question'): Promise<{ audio: ArrayBuffer; text: string }> {
  const response = await client.post(`/interviews/${id}/live/speech`, { kind }, { responseType: 'arraybuffer', signal, timeout: 60000 });
  return { audio: response.data, text: decodeURIComponent(response.headers['x-interviewer-text'] ?? '') };
}
export async function saveLiveTranscript(id: string, questionId: string, text: string) {
  await client.put(`/interviews/${id}/live/transcript`, { questionId, text, reviewRequired: true });
}
export async function liveEvent(id: string, type: string, faceCount?: number) {
  await client.post(`/interviews/${id}/live/events`, { type, ...(faceCount !== undefined ? { faceCount } : {}) });
}
