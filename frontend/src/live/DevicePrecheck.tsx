import { useEffect, useRef, useState } from 'react';
import { InterviewMedia } from './media';
import { getQuestionSpeech } from '../api/liveInterviews';

export function DevicePrecheck({ id, disabled }: { id: string; disabled: boolean }) {
  const [level, setLevel] = useState(0), [mic, setMic] = useState(false), [message, setMessage] = useState('');
  const [speaking, setSpeaking] = useState(false), [connection, setConnection] = useState('Not checked');
  const media = useRef<InterviewMedia | null>(null), socket = useRef<WebSocket | null>(null);
  const version = useRef(0), abort = useRef<AbortController | null>(null);
  const connectionTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  function closeConnection() {
    if (connectionTimeout.current !== null) clearTimeout(connectionTimeout.current);
    connectionTimeout.current = null;
    const previous = socket.current; socket.current = null;
    if (previous) { previous.onmessage = null; previous.onerror = null; previous.onclose = null; previous.close(); }
  }
  function stop() { version.current++; abort.current?.abort(); media.current?.dispose(); media.current = null;
    closeConnection(); setMic(false); setSpeaking(false); setLevel(0); }
  useEffect(() => () => { version.current++; abort.current?.abort(); media.current?.dispose(); closeConnection(); }, []);
  useEffect(() => { if (disabled) stop(); }, [disabled]);
  const compatible = window.isSecureContext && typeof navigator.mediaDevices?.getUserMedia === 'function'
    && typeof window.AudioContext === 'function' && typeof window.AudioWorkletNode === 'function' && typeof window.WebSocket === 'function';
  async function microphone() {
    if (mic) { stop(); return; }
    stop(); const tag = version.current;
    try {
      media.current = new InterviewMedia((_pcm, rms) => setLevel(rms), () => undefined);
      await media.current.open(); if (tag !== version.current) return;
      media.current.setListening(true); setMic(true); setMessage('Speak to check input level. This check does not send or transcribe audio. Stop the check before joining.');
    } catch (error) { if (tag === version.current) setMessage(`Microphone check: ${error instanceof Error ? error.message : 'Unable to open microphone.'}`); }
  }
  async function speaker() {
    stop(); const tag = version.current; setSpeaking(true); setMessage('Preparing the actual local interviewer voice…');
    try {
      const player = new InterviewMedia(() => undefined, () => undefined); media.current = player;
      await player.prepareAudio(); if (tag !== version.current) return;
      const controller = new AbortController(); abort.current = controller;
      const speech = await getQuestionSpeech(id, controller.signal);
      if (tag !== version.current) return; setMessage('Playing the interviewer greeting and current question.');
      await player.play(speech.audio); if (tag === version.current) { setSpeaking(false); setMessage('Voice playback finished. Confirm that you could hear it; browser audio output cannot verify your speakers.'); }
    } catch { if (tag === version.current) { setSpeaking(false); setMessage('The local voice could not play. Check audio output, replay, or use text mode.'); } }
  }
  function checkConnection() {
    closeConnection();
    const started = performance.now(); setConnection('Checking authenticated local audio connection…');
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/interviews/${id}/live/audio`); socket.current = ws;
    connectionTimeout.current = setTimeout(() => { if (socket.current === ws) { closeConnection(); setConnection('Connection timed out. Text mode remains available.'); } }, 10000);
    ws.onmessage = event => { if (socket.current !== ws) return;
      try { if (JSON.parse(String(event.data)).type === 'ready') {
        setConnection(`Local audio handshake: ${Math.round(performance.now() - started)} ms. This is not an internet bandwidth measurement.`); closeConnection();
      } } catch { /* Ignore malformed messages until the timeout. */ } };
    ws.onerror = () => { if (socket.current === ws) { closeConnection(); setConnection('Audio connection unavailable or another tab has an active microphone session.'); } };
    ws.onclose = () => { if (socket.current === ws) { closeConnection(); setConnection('Audio connection closed before the check completed.'); } };
  }
  return <details className="call-notice" open={!disabled}>
    <summary className="cursor-pointer font-semibold">Device and connection pre-check</summary>
    <p className="my-2">{compatible ? 'Required browser APIs are available.' : 'Some browser audio capabilities are unavailable. Use localhost/HTTPS, a compatible browser, or text mode.'} Use headphones to reduce echo.</p>
    <div className="flex flex-wrap gap-2">
      <button className="call-button secondary" disabled={disabled || !compatible} onClick={() => void microphone()}>{mic ? 'Stop microphone check' : 'Test microphone level'}</button>
      <button className="call-button secondary" disabled={disabled} onClick={() => void speaker()}>Test interviewer audio</button>
      {(mic || speaking) && <button className="call-button secondary" onClick={stop}>Stop device test</button>}
      <button className="call-button secondary" disabled={disabled} onClick={checkConnection}>Check audio connection</button>
    </div>
    {mic && <p role="status">Digital microphone input: {level > 0 ? Math.round(20 * Math.log10(level)) : '−∞'} dBFS. A moving level confirms captured samples; speaking affects this measurement.</p>}
    <p className="mt-2" role="status">{message}</p><p className="mt-2">{connection}</p>
  </details>;
}
