import { useEffect, useRef, useState } from 'react';
import { liveEvent } from '../api/liveInterviews';
import type { FaceDetector } from '@mediapipe/tasks-vision';

export function CandidateCamera({ id, disabled = false }: { id: string; disabled?: boolean }) {
  const video = useRef<HTMLVideoElement>(null), stream = useRef<MediaStream | null>(null);
  const detector = useRef<FaceDetector | null>(null), generation = useRef(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const mounted = useRef(true);
  const [enabled, setEnabled] = useState(false), [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('Camera is optional. No audio or video is recorded.');
  const [monitor, setMonitor] = useState(false);
  const log = (type: string, faceCount?: number) => { void liveEvent(id, type, faceCount).catch(() => undefined); };

  function release() {
    generation.current++; if (timer.current) clearInterval(timer.current); timer.current = null;
    stream.current?.getTracks().forEach(track => track.stop()); stream.current = null;
    detector.current?.close(); detector.current = null;
    if (video.current) video.current.srcObject = null;
  }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; release(); }; }, []);
  useEffect(() => { if (disabled) { release(); setEnabled(false); } }, [disabled]);

  async function toggle() {
    if (enabled) { release(); setEnabled(false); setMessage('Camera off.'); log('camera_off'); return; }
    const tag = ++generation.current; setBusy(true);
    try {
      const camera = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 } }, audio: false });
      if (tag !== generation.current) { camera.getTracks().forEach(track => track.stop()); return; }
      stream.current = camera; setEnabled(true); log('camera_on');
      if (video.current) { video.current.srcObject = camera; await video.current.play(); }
      setMessage(monitor ? 'Loading local face-presence checks…' : 'Camera preview only. Presence checks are off.');
      if (monitor) {
        try {
          const { FaceDetector, FilesetResolver } = await import('@mediapipe/tasks-vision');
          const vision = await FilesetResolver.forVisionTasks('/mediapipe');
          const instance = await FaceDetector.createFromOptions(vision, { baseOptions: { modelAssetPath: '/models/blaze_face_short_range.tflite' },
            runningMode: 'VIDEO', minDetectionConfidence: 0.6 });
          if (tag !== generation.current) { instance.close(); return; }
          detector.current = instance;
          let previous = '', pending = '', stable = 0;
          timer.current = setInterval(() => {
            if (!video.current || video.current.readyState < 2) return;
            try {
              const count = instance.detectForVideo(video.current, performance.now()).detections.length;
              const type = count === 0 ? 'no_face' : count > 1 ? 'multiple_faces' : 'face_visible';
              stable = pending === type ? stable + 1 : 1; pending = type;
              if (stable >= 2 && previous !== type) {
                previous = type; log(type, count);
                setMessage(count === 0 ? 'No face detected. Adjust the camera if you want; this does not affect your score.' :
                  count > 1 ? 'Multiple faces detected. This is an advisory event only.' : 'One face visible. Presence check only; identity is not verified.');
              }
            } catch { setMessage('Presence checks are unavailable. Your interview can continue.'); }
          }, 2000);
        } catch { setMessage('Local face detector unavailable. Camera preview still works; your score is unaffected.'); log('detector_unavailable'); }
      }
    } catch {
      if (tag !== generation.current) return;
      release(); setEnabled(false); setMessage('Camera permission was denied or no camera is available. You can continue without it.'); log('camera_unavailable');
    } finally { if (mounted.current) setBusy(false); }
  }
  return <section className="call-panel candidate-panel" aria-label="Candidate camera">
    <div className="call-panel-top"><span className="live-pill">YOU</span><span>{enabled ? 'Camera on' : 'Camera off'}</span></div>
    <div className="camera-stage">
      <video ref={video} autoPlay muted playsInline className={enabled ? '' : 'camera-hidden'} aria-label="Your live camera preview" />
      {!enabled && <div className="camera-empty"><span aria-hidden="true">◉</span><h2>Your space</h2><p>Join with your voice.<br />Camera is always your choice.</p></div>}
      <span className="participant-tag">Candidate · local preview</span>
    </div>
    <div className="camera-settings">
      <label><input type="checkbox" checked={monitor} disabled={enabled || busy || disabled} onChange={e => setMonitor(e.target.checked)} />
        Optional face-presence checks</label>
      <p role="status">{message}</p>
      <button className="call-button secondary" onClick={() => void toggle()} disabled={busy || disabled}>
        {busy ? 'Opening camera…' : enabled ? 'Turn camera off' : 'Enable camera'}
      </button>
      <p className="privacy-note">Face counts stay local except timestamped presence events. No identity, attention or honesty inference.</p>
    </div>
  </section>;
}
