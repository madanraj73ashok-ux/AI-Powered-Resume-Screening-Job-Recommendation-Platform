import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { useLiveInterview } from '../live/useLiveInterview';
import { CandidateCamera } from '../live/CandidateCamera';
import { canScoreTranscript, isGreetingTranscript } from '../live/state';
import InterviewStartPage from '../pages/InterviewStart';
import * as liveAPI from '../api/liveInterviews';
import * as interviews from '../api/interviews';
import { listResumes } from '../api/resumes';

const mediaMocks = vi.hoisted(() => ({ open: vi.fn(), play: vi.fn(), setListening: vi.fn(), stopSpeech: vi.fn(),
  dispose: vi.fn(), releaseMicrophone: vi.fn() }));
vi.mock('../live/media', () => ({ InterviewMedia: class {
  open = mediaMocks.open; play = mediaMocks.play; setListening = mediaMocks.setListening;
  stopSpeech = mediaMocks.stopSpeech; dispose = mediaMocks.dispose; releaseMicrophone = mediaMocks.releaseMicrophone;
} }));
vi.mock('../api/liveInterviews', () => ({ getLiveState: vi.fn(), getQuestionSpeech: vi.fn(),
  saveLiveTranscript: vi.fn(), liveEvent: vi.fn(), getVoiceConfiguration: vi.fn() }));
vi.mock('../api/interviews', async original => ({ ...await original<typeof import('../api/interviews')>(),
  submitAnswer: vi.fn(), completeInterview: vi.fn(), listInterviews: vi.fn(), startInterview: vi.fn() }));
vi.mock('../api/resumes', async original => ({ ...await original<typeof import('../api/resumes')>(), listResumes: vi.fn() }));
vi.mock('../components/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }));

class TestSocket {
  static OPEN = 1;
  static instances: TestSocket[] = [];
  readyState = 1; bufferedAmount = 0;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null; onerror: (() => void) | null = null;
  constructor() { TestSocket.instances.push(this); queueMicrotask(() => this.emit({ type: 'ready' })); }
  emit(data: object) { this.onmessage?.({ data: JSON.stringify(data) }); }
  send(data: string | ArrayBuffer) {
    if (typeof data === 'string' && JSON.parse(data).type === 'start') queueMicrotask(() => this.emit({ type: 'listening' }));
  }
  close() { this.readyState = 3; this.onclose?.(); }
}
const question = { id: 'voice-q1', text: 'Introduce yourself.', type: 'introduction', difficulty: 'Beginner' as const,
  expectedConcepts: ['background'], maxMarks: 8, followUpTemplates: [], isFollowUp: false };
const state = { candidateName: 'Voice Tester', resumeName: 'test.pdf', interviewerText: 'Welcome. Introduce yourself.', elapsedSeconds: 0, events: [],
  session: { id: 'v1', user: 'u1', resume: 'r1', difficulty: 'Beginner' as const, status: 'in_progress' as const,
    questions: [question], answers: [], currentIndex: 0, totalQuestions: 1, startedAt: new Date().toISOString(), mode: 'voice' as const },
  progress: { answered: 0, total: 1, percentage: 0, currentQuestion: question, completed: false } };

beforeEach(() => {
  vi.resetAllMocks(); TestSocket.instances = []; vi.stubGlobal('WebSocket', TestSocket);
  vi.mocked(liveAPI.getLiveState).mockResolvedValue(state);
  vi.mocked(liveAPI.liveEvent).mockResolvedValue(undefined);
  vi.mocked(liveAPI.saveLiveTranscript).mockResolvedValue(undefined);
  vi.mocked(liveAPI.getQuestionSpeech).mockResolvedValue({ audio: new ArrayBuffer(8), text: 'Welcome. Introduce yourself.' });
  mediaMocks.open.mockResolvedValue(undefined); mediaMocks.play.mockResolvedValue(undefined);
});

describe('live voice turn-taking', () => {
  it('acknowledges a recognized greeting aloud without scoring it', async () => {
    const hook = renderHook(() => useLiveInterview('v1'));
    await waitFor(() => expect(hook.result.current.data).not.toBeNull());
    await act(async () => { await hook.result.current.join(); });
    act(() => TestSocket.instances[0].emit({ type: 'final', questionId: 'voice-q1', text: 'Hello', reviewRequired: false }));
    await waitFor(() => expect(liveAPI.getQuestionSpeech).toHaveBeenCalledWith('v1', expect.any(AbortSignal), 'greeting'));
    expect(interviews.submitAnswer).not.toHaveBeenCalled();
    expect(liveAPI.saveLiveTranscript).toHaveBeenCalledWith('v1', 'voice-q1', '');
    hook.unmount();
  });
  it('requests no microphone until the candidate joins and pauses capture during playback', async () => {
    let finishPlayback: () => void = () => undefined;
    mediaMocks.play.mockImplementation(() => new Promise<void>(resolve => { finishPlayback = resolve; }));
    const hook = renderHook(() => useLiveInterview('v1'));
    await waitFor(() => expect(hook.result.current.data).not.toBeNull());
    expect(mediaMocks.open).not.toHaveBeenCalled();
    let joined: Promise<void>;
    act(() => { joined = hook.result.current.join(); });
    await waitFor(() => expect(hook.result.current.phase).toBe('AI_SPEAKING'));
    expect(mediaMocks.setListening).toHaveBeenCalledWith(false);
    expect(mediaMocks.setListening).not.toHaveBeenCalledWith(true);
    await act(async () => { finishPlayback(); await joined; });
    await waitFor(() => expect(hook.result.current.phase).toBe('LISTENING'));
    expect(mediaMocks.setListening).toHaveBeenCalledWith(true);
    hook.unmount(); expect(mediaMocks.dispose).toHaveBeenCalled();
  });

  it('shows a permission error and never scores when microphone access is denied', async () => {
    mediaMocks.open.mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError'));
    const hook = renderHook(() => useLiveInterview('v1'));
    await act(async () => { await hook.result.current.join(); });
    expect(hook.result.current.phase).toBe('ERROR');
    expect(hook.result.current.error).toContain('Microphone permission was denied');
    expect(interviews.submitAnswer).not.toHaveBeenCalled();
    hook.unmount();
  });

  it('requires confirmation for uncertain recognition and allows transcript correction', async () => {
    const hook = renderHook(() => useLiveInterview('v1'));
    await waitFor(() => expect(hook.result.current.data).not.toBeNull());
    await act(async () => { await hook.result.current.join(); });
    act(() => TestSocket.instances[0].emit({ type: 'final', questionId: 'voice-q1', text: 'Test uncertain recognition.', reviewRequired: true }));
    expect(hook.result.current.phase).toBe('REVIEWING'); expect(hook.result.current.countdown).toBeNull();
    expect(interviews.submitAnswer).not.toHaveBeenCalled();
    act(() => hook.result.current.edit('Corrected by the candidate.'));
    vi.mocked(interviews.submitAnswer).mockResolvedValue({} as never);
    await act(async () => { await hook.result.current.submit(); });
    expect(interviews.submitAnswer).toHaveBeenCalledWith('v1', 'voice-q1', 'Corrected by the candidate.');
    hook.unmount();
  });

  it('does not invent a transcript or a score when speech recognition returns silence', async () => {
    const hook = renderHook(() => useLiveInterview('v1'));
    await waitFor(() => expect(hook.result.current.data).not.toBeNull());
    await act(async () => { await hook.result.current.join(); });
    act(() => TestSocket.instances[0].emit({ type: 'final', questionId: 'voice-q1', text: '', reviewRequired: true }));
    expect(hook.result.current.phase).toBe('PAUSED'); expect(hook.result.current.error).toContain('No score');
    expect(interviews.submitAnswer).not.toHaveBeenCalled(); hook.unmount();
  });

  it('restores a final transcript after browser refresh without auto-scoring it', async () => {
    vi.mocked(liveAPI.getLiveState).mockResolvedValue({ ...state, session: { ...state.session,
      live: { draftQuestionId: 'voice-q1', draftTranscript: 'Saved recognized answer.' } } });
    const hook = renderHook(() => useLiveInterview('v1'));
    await waitFor(() => expect(hook.result.current.transcript).toBe('Saved recognized answer.'));
    expect(interviews.submitAnswer).not.toHaveBeenCalled(); hook.unmount();
  });
});

describe('optional media and accessible fallback', () => {
  it('camera denial leaves the interview usable and logs only an advisory event', async () => {
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError')) } });
    render(<CandidateCamera id="v1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Enable camera' }));
    expect(await screen.findByText(/Camera permission was denied/)).toBeInTheDocument();
    expect(liveAPI.liveEvent).toHaveBeenCalledWith('v1', 'camera_unavailable', undefined);
    expect(interviews.submitAnswer).not.toHaveBeenCalled();
  });

  it('keeps text interviews available when local speech models are unavailable', async () => {
    vi.mocked(listResumes).mockResolvedValue([{ id: 'r1', originalName: 'test.pdf', profile: {}, createdAt: new Date().toISOString() }] as never);
    vi.mocked(interviews.listInterviews).mockResolvedValue([]);
    vi.mocked(liveAPI.getVoiceConfiguration).mockResolvedValue({ ready: false, sttReady: false, ttsReady: false, voices: [], mode: 'local' });
    render(<MemoryRouter><InterviewStartPage /></MemoryRouter>);
    expect(await screen.findByRole('button', { name: 'Start AI interview' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Interview mode'), { target: { value: 'text' } });
    expect(screen.getByRole('button', { name: 'Start AI interview' })).toBeEnabled();
  });

  it('never scores blank or unconfirmed uncertain transcripts', () => {
    expect(canScoreTranscript('', false, true)).toBe(false);
    expect(canScoreTranscript('uncertain', true, false)).toBe(false);
    expect(canScoreTranscript('confirmed', true, true)).toBe(true);
  });
  it('recognizes short greetings without treating technical answers as greetings', () => {
    expect(isGreetingTranscript('Hello Ragul', 'RAGUL R')).toBe(true);
    expect(isGreetingTranscript('Hello Ava!', 'RAGUL R')).toBe(true);
    expect(isGreetingTranscript('I built a hello world project.', 'RAGUL R')).toBe(false);
  });
});
