import { useCallback, useEffect, useRef, useState } from 'react';
import { getLiveState, getQuestionSpeech, liveEvent, LiveState, saveLiveTranscript } from '../api/liveInterviews';
import { completeInterview, submitAnswer } from '../api/interviews';
import { apiErrorMessage } from '../api/client';
import { InterviewMedia } from './media';
import { canScoreTranscript, InterviewPhase, isGreetingTranscript } from './state';

export function useLiveInterview(id: string) {
  const [data, setData] = useState<LiveState | null>(null);
  const [phase, setPhase] = useState<InterviewPhase>('IDLE');
  const [transcript, setTranscript] = useState('');
  const [partial, setPartial] = useState('');
  const [error, setError] = useState('');
  const [level, setLevel] = useState(0), [outputLevel, setOutputLevel] = useState(0);
  const [connected, setConnected] = useState(false), [muted, setMuted] = useState(false);
  const [autoContinue, setAutoContinue] = useState(true), [countdown, setCountdown] = useState<number | null>(null);
  const [reviewRequired, setReviewRequired] = useState(true);
  const [elapsed, setElapsed] = useState(0);
  const state = useRef<LiveState | null>(null), socket = useRef<WebSocket | null>(null);
  const media = useRef<InterviewMedia | null>(null), generation = useRef(0);
  const mounted = useRef(true), joined = useRef(false), auto = useRef(true), mute = useRef(false);
  const submitting = useRef(false), transcriptRef = useRef('');
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const reconnect = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retries = useRef(0), connectRef = useRef<() => Promise<void>>();
  const abort = useRef<AbortController | null>(null), submitRef = useRef<(text: string, confirmed: boolean) => Promise<void>>();

  const clearCountdown = useCallback(() => { if (timer.current) clearInterval(timer.current); timer.current = null; setCountdown(null); }, []);
  const event = useCallback((type: string) => { void liveEvent(id, type).catch(() => undefined); }, [id]);
  const load = useCallback(async () => {
    const next = await getLiveState(id);
    if (!mounted.current) return next;
    const before = state.current?.progress.currentQuestion?.id;
    if (before && before !== next.progress.currentQuestion?.id) {
      const saved = next.session.live?.draftQuestionId === next.progress.currentQuestion?.id ? next.session.live?.draftTranscript ?? '' : '';
      transcriptRef.current = saved; setTranscript(saved); setPartial(''); clearCountdown();
    }
    state.current = next; setData(next); setElapsed(next.elapsedSeconds);
    if (next.session.status === 'completed') setPhase('COMPLETED');
    return next;
  }, [id, clearCountdown]);

  useEffect(() => {
    mounted.current = true;
    void load().then(next => {
      if (!mounted.current) return;
      const draft = next.session.live?.draftQuestionId === next.progress.currentQuestion?.id ? next.session.live?.draftTranscript ?? '' : '';
      setTranscript(draft); transcriptRef.current = draft;
      if (next.session.status === 'completed') setPhase('COMPLETED');
    }).catch(err => { if (mounted.current) setError(apiErrorMessage(err)); });
    const clock = setInterval(() => setElapsed(value => value + 1), 1000);
    return () => {
      mounted.current = false; joined.current = false; generation.current++; abort.current?.abort();
      clearInterval(clock); if (timer.current) clearInterval(timer.current);
      if (reconnect.current) clearTimeout(reconnect.current);
      socket.current?.close(); media.current?.dispose(); media.current = null;
    };
  }, [load]);

  function cancelTurn() {
    generation.current++; abort.current?.abort(); clearCountdown();
    media.current?.setListening(false); media.current?.stopSpeech(); setLevel(0);
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify({ type: 'cancel' }));
  }

  useEffect(() => {
    const hide = () => {
      if (document.hidden && joined.current) {
        cancelTurn(); setPhase('PAUSED');
        setError('Interview paused while this page is in the background. Resume when you are ready.');
      }
    };
    document.addEventListener('visibilitychange', hide);
    return () => document.removeEventListener('visibilitychange', hide);
  }, [clearCountdown]);

  async function connect() {
    if (socket.current?.readyState === WebSocket.OPEN) return;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(`${protocol}//${location.host}/api/interviews/${id}/live/audio`);
      socket.current = ws;
      const deadline = setTimeout(() => { ws.close(); reject(new Error('Audio connection timed out.')); }, 10000);
      ws.onmessage = message => {
        if (!mounted.current || socket.current !== ws) return;
        const result = JSON.parse(String(message.data));
        if (result.type === 'ready') { clearTimeout(deadline); retries.current = 0; setConnected(true); resolve(); }
        else if (result.type === 'listening') {
          if (!mute.current && joined.current) { media.current?.setListening(true); setPhase('LISTENING'); }
          else ws.send(JSON.stringify({ type: 'cancel' }));
        } else if (result.type === 'partial') setPartial(result.text);
        else if (result.type === 'state') { media.current?.setListening(false); setLevel(0); setPhase('TRANSCRIBING'); }
        else if (result.type === 'final') {
          media.current?.setListening(false); setLevel(0); setPartial('');
          if (result.questionId !== state.current?.progress.currentQuestion?.id) return;
          if (!result.reviewRequired && isGreetingTranscript(result.text, state.current?.candidateName ?? '')) {
            clearCountdown(); transcriptRef.current = ''; setTranscript('');
            setPhase('AI_SPEAKING');
            void saveLiveTranscript(id, result.questionId, '').then(() => speak('greeting')).catch(() => {
              setError('The greeting could not be acknowledged. Replay the question or retry.'); setPhase('PAUSED');
            });
            return;
          }
          setTranscript(result.text); transcriptRef.current = result.text; setReviewRequired(result.reviewRequired);
          if (!result.text.trim()) { setError('No clear speech was recognized. No score was assigned. Listen again or switch to text.'); setPhase('PAUSED'); return; }
          setPhase('REVIEWING');
          if (auto.current && !result.reviewRequired && !mute.current) {
            clearCountdown(); let seconds = 4; setCountdown(seconds);
            timer.current = setInterval(() => {
              seconds--; setCountdown(seconds);
              if (seconds <= 0) { clearCountdown(); void submitRef.current?.(result.text, true); }
            }, 1000);
          } else setError(result.reason ?? 'Review the transcript, then submit when ready.');
        } else if (result.type === 'error') { cancelTurn(); setError(result.message); setPhase('PAUSED'); }
      };
      ws.onerror = () => { clearTimeout(deadline); reject(new Error('Audio connection failed.')); };
      ws.onclose = () => {
        clearTimeout(deadline);
        if (socket.current !== ws) return;
        socket.current = null;
        if (!mounted.current) return;
        setConnected(false); media.current?.setListening(false); clearCountdown();
        reject(new Error('Audio connection closed.'));
        if (joined.current) {
          generation.current++; abort.current?.abort(); media.current?.stopSpeech(); setPhase('RECONNECTING');
          if (retries.current < 3) {
            retries.current++;
            reconnect.current = setTimeout(() => {
              void connectRef.current?.().then(() => load()).then(() => {
                if (mounted.current) { setPhase('PAUSED'); setError('Connection restored. Replay the question or resume when ready.'); }
              }).catch(() => undefined);
            }, 1000 * 2 ** (retries.current - 1));
          } else setError('Audio could not reconnect. Rejoin or use text mode; saved answers are preserved.');
        }
      };
    });
  }
  connectRef.current = connect;

  useEffect(() => {
    const questionId = data?.progress.currentQuestion?.id;
    if (phase !== 'REVIEWING' || !questionId || !transcript.trim()) return;
    const pending = setTimeout(() => {
      void saveLiveTranscript(id, questionId, transcript).catch(() => {
        if (mounted.current && state.current?.progress.currentQuestion?.id === questionId) {
          setError('Transcript edits could not be saved. Keep this page open and retry before leaving.');
        }
      });
    }, 700);
    return () => clearTimeout(pending);
  }, [data?.progress.currentQuestion?.id, id, phase, transcript]);

  async function listen() {
    clearCountdown(); setError(''); setPartial('');
    if (!connected && socket.current?.readyState !== WebSocket.OPEN) await connect();
    const q = state.current?.progress.currentQuestion;
    if (!q) { setPhase('PAUSED'); return; }
    if (mute.current) { setPhase('PAUSED'); return; }
    socket.current?.send(JSON.stringify({ type: 'start', questionId: q.id }));
  }

  async function speak(kind: 'question' | 'greeting' = 'question') {
    cancelTurn(); const tag = generation.current;
    setError(''); setPhase('AI_SPEAKING');
    try {
      await load(); if (tag !== generation.current) return;
      if (state.current?.session.status === 'completed') return;
      abort.current = new AbortController();
      const speech = await getQuestionSpeech(id, abort.current.signal, kind);
      if (tag !== generation.current) return;
      if (state.current && speech.text) { state.current = { ...state.current, interviewerText: speech.text }; setData(state.current); }
      await media.current?.play(speech.audio);
      if (tag !== generation.current || !joined.current) return;
      if (state.current?.progress.currentQuestion) await listen(); else setPhase('PAUSED');
    } catch (err) {
      if (tag !== generation.current) return;
      setError('Question audio could not play. Replay it, answer using the visible subtitles, or use text mode.'); setPhase('PAUSED');
    }
  }

  async function join() {
    cancelTurn();
    const tag = generation.current;
    setError(''); setPhase('CONNECTING');
    try {
      if (!media.current) media.current = new InterviewMedia((buffer, rms) => {
        if (socket.current?.readyState === WebSocket.OPEN && socket.current.bufferedAmount < 128000) {
          socket.current.send(buffer); setLevel(Math.min(1, rms * 6));
        } else if (socket.current?.bufferedAmount && socket.current.bufferedAmount >= 128000) {
          media.current?.setListening(false); setPhase('PAUSED'); setError('Audio connection is too slow. Resume after reconnecting.');
        }
      }, setOutputLevel);
      await media.current.open();
      if (!mounted.current || tag !== generation.current) { media.current?.releaseMicrophone(); return; }
      joined.current = true; mute.current = false; setMuted(false);
      await connect();
      if (!mounted.current || tag !== generation.current) return;
      if (transcriptRef.current.trim()) { setPhase('REVIEWING'); setError('Your saved transcript is ready to review.'); }
      else await speak();
    } catch (err) {
      if (!mounted.current || tag !== generation.current) return;
      joined.current = false; media.current?.releaseMicrophone();
      const denied = err instanceof DOMException && ['NotAllowedError', 'PermissionDeniedError'].includes(err.name);
      const timedOut = err instanceof Error && err.message.includes('permission timed out');
      const missing = err instanceof DOMException && err.name === 'NotFoundError';
      const busyDevice = err instanceof DOMException && err.name === 'NotReadableError';
      setError(denied ? 'Microphone permission was denied. Allow microphone access and rejoin, or use text mode.' : missing ?
        'No microphone was found. Connect or enable an audio input device, then rejoin.' : busyDevice ?
        'The microphone could not start. Check your system microphone privacy settings and whether another app is using the device.' : timedOut ?
        'Microphone permission is still awaiting a response. Allow access and rejoin, or use text mode.' :
        `Audio setup failed${err instanceof Error ? `: ${err.message}` : '.'} Rejoin or use text mode.`);
      setPhase('ERROR');
    }
  }

  async function score(text: string, confirmed: boolean) {
    if (submitting.current || !canScoreTranscript(text, reviewRequired, confirmed)) return;
    const q = state.current?.progress.currentQuestion; if (!q) return;
    submitting.current = true; cancelTurn(); setPhase('EVALUATING'); setError('');
    try {
      await saveLiveTranscript(id, q.id, text);
      await submitAnswer(id, q.id, text);
      transcriptRef.current = ''; setTranscript(''); setPartial('');
      await load();
      if (joined.current) await speak(); else setPhase('PAUSED');
    } catch (err) { setError(apiErrorMessage(err)); setPhase('REVIEWING'); }
    finally { submitting.current = false; }
  }
  submitRef.current = score;

  function edit(text: string) { clearCountdown(); setTranscript(text); transcriptRef.current = text; setReviewRequired(true); }
  function pause() { cancelTurn(); setPhase('PAUSED'); event('speech_interrupted'); }
  function toggleMute() {
    const value = !mute.current; mute.current = value; setMuted(value);
    event(value ? 'mic_muted' : 'mic_unmuted');
    if (value && phase === 'LISTENING') {
      clearCountdown(); media.current?.setListening(false);
      socket.current?.send(JSON.stringify({ type: 'finish' }));
    } else if (value) pause();
    else if (joined.current) void listen().catch(() => setError('Reconnect to resume listening.'));
  }
  async function finish() {
    cancelTurn(); setPhase('EVALUATING');
    try { await completeInterview(id); joined.current = false; socket.current?.close(); media.current?.dispose(); setPhase('COMPLETED'); }
    catch (err) { setError(apiErrorMessage(err)); setPhase('PAUSED'); }
  }
  async function fallback() {
    cancelTurn(); setPhase('PAUSED'); joined.current = false; socket.current?.close(); media.current?.dispose();
    if (transcriptRef.current.trim() && state.current?.progress.currentQuestion) {
      await saveLiveTranscript(id, state.current.progress.currentQuestion.id, transcriptRef.current);
    }
    event('text_fallback');
  }
  return { data, phase, transcript, partial, error, level, outputLevel, connected, muted,
    autoContinue, countdown, elapsed, reviewRequired, join, speak, listen, edit, pause, toggleMute, finish, fallback,
    submit: () => score(transcriptRef.current, true),
    finishSpeaking: () => { media.current?.setListening(false); socket.current?.send(JSON.stringify({ type: 'finish' })); },
    review: () => clearCountdown(),
    setAutoContinue: (value: boolean) => { auto.current = value; setAutoContinue(value); if (!value) clearCountdown(); },
  };
}
