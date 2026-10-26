export type InterviewPhase = 'IDLE' | 'CONNECTING' | 'AI_SPEAKING' | 'LISTENING' |
  'TRANSCRIBING' | 'REVIEWING' | 'EVALUATING' | 'PAUSED' | 'RECONNECTING' | 'COMPLETED' | 'ERROR';

export const PHASE_LABELS: Record<InterviewPhase, string> = {
  IDLE: 'Ready to join', CONNECTING: 'Connecting', AI_SPEAKING: 'Interviewer speaking',
  LISTENING: 'Your turn', TRANSCRIBING: 'Transcribing your answer', REVIEWING: 'Review your transcript',
  EVALUATING: 'Reviewing your answer', PAUSED: 'Paused', RECONNECTING: 'Reconnecting',
  COMPLETED: 'Interview complete', ERROR: 'Needs your attention',
};
export function canScoreTranscript(text: string, reviewRequired: boolean, confirmed: boolean) {
  return Boolean(text.trim()) && (!reviewRequired || confirmed);
}

export function isGreetingTranscript(text: string, candidateName: string) {
  const clean = (value: string) => value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  const match = /^(hello|hi|hey|good morning|good afternoon|good evening)\b(.*)$/.exec(clean(text));
  if (!match) return false;
  const remaining = match[2].trim().split(' ').filter(Boolean);
  const allowed = new Set([...clean(candidateName).split(' '), 'ava', 'there', 'interviewer']);
  return remaining.length <= 5 && remaining.every(word => allowed.has(word));
}
