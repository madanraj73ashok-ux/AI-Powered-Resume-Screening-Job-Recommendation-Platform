import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { CandidateCamera } from '../live/CandidateCamera';
import { InterviewerAvatar } from '../live/InterviewerAvatar';
import { useLiveInterview } from '../live/useLiveInterview';
import { PHASE_LABELS } from '../live/state';
import { AudioWaveform } from '../live/AudioWaveform';
import '../live/live.css';

function time(seconds: number) { return `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`; }
export default function LiveInterviewPage() {
  const { id = '' } = useParams(); const navigate = useNavigate();
  const live = useLiveInterview(id);
  const [confirmEnd, setConfirmEnd] = useState(false), [editing, setEditing] = useState(false);
  const [fallbackFailed, setFallbackFailed] = useState(false);
  const endDialog = useRef<HTMLDialogElement>(null);
  useEffect(() => { if (confirmEnd && !endDialog.current?.open) endDialog.current?.showModal(); }, [confirmEnd]);
  useEffect(() => { if (live.phase === 'COMPLETED') navigate(`/interview/results/${id}`, { replace: true }); }, [id, live.phase, navigate]);
  const question = live.data?.progress.currentQuestion;
  const busy = ['CONNECTING', 'TRANSCRIBING', 'EVALUATING', 'RECONNECTING'].includes(live.phase);
  const joined = !['IDLE', 'ERROR'].includes(live.phase);
  const targetReached = live.elapsed >= (live.data?.session.targetDurationMinutes ?? 20) * 60;
  const fallback = async () => { try { await live.fallback(); navigate(`/interview/${id}`); } catch { setFallbackFailed(true); } };

  return <div className="live-interview">
    <header className="call-header">
      <div><Link to="/interview" className="call-back">← Interviews</Link><h1>AI interview <span>/ {live.data?.session.interviewType ?? 'Mixed'}</span></h1></div>
      <div className="call-header-meta"><span className={`connection-dot ${live.connected ? 'online' : ''}`} />
        <span>{live.connected ? 'Local audio connected' : live.phase === 'RECONNECTING' ? 'Reconnecting…' : 'Not connected'}</span>
        <span className="call-timer" aria-label="Interview elapsed time">{time(live.elapsed)}</span>
        <button className="call-button danger" disabled={live.phase === 'EVALUATING'} onClick={() => { live.pause(); setConfirmEnd(true); }}>End interview</button>
      </div>
    </header>

    <div className="call-intro"><span className="live-pill">VOICE INTERVIEW</span><p>A conversation about your experience. One question at a time.</p>
      <span>{question?.difficulty ?? live.data?.session.difficulty ?? 'Intermediate'} · {live.data?.session.targetDurationMinutes ?? 20} min target</span></div>
    {live.error && <div role="alert" className="call-notice">{live.error}</div>}
    {fallbackFailed && <div role="alert" className="call-notice">Transcript edits could not be saved. Copy your visible answer before leaving, or retry when connected.{' '}
      <Link className="underline" to={`/interview/${id}`}>Continue to text mode</Link></div>}
    {targetReached && <div className="call-notice">You have reached the target duration. You can finish now or continue at your own pace.</div>}
    {!live.data && <p role="status">Loading your saved interview…</p>}

    <div className="call-grid">
      <section className="call-panel interviewer-panel" aria-label="Virtual interviewer">
        <div className="call-panel-top"><span className="live-pill">VERIHIRE INTERVIEWER</span><span aria-live="polite">{PHASE_LABELS[live.phase]}</span></div>
        <InterviewerAvatar level={live.outputLevel} speaking={live.phase === 'AI_SPEAKING'} />
        <div className="question-subtitles" aria-live="polite"><span className="eyebrow">{question ? `QUESTION ${Math.min((live.data?.progress.answered ?? 0) + 1, live.data?.progress.total ?? 1)} OF ${live.data?.progress.total}` : 'QUESTIONS COMPLETE'}</span>
          <h2>{live.data?.interviewerText ?? 'Your interviewer will greet you when you join.'}</h2>
          {question?.isFollowUp && <span className="follow-up-label">Follow-up to your previous answer</span>}
        </div>
        <div className="call-progress" role="progressbar" aria-label="Interview progress" aria-valuenow={live.data?.progress.percentage ?? 0} aria-valuemin={0} aria-valuemax={100}>
          <div style={{ width: `${live.data?.progress.percentage ?? 0}%` }} />
        </div>
      </section>
      <CandidateCamera id={id} disabled={live.phase === 'COMPLETED' || confirmEnd} />
    </div>

    <section className="transcript-panel" aria-label="Live transcript">
      <div className="transcript-heading"><div><span className="eyebrow">YOUR ANSWER</span><h2>{live.phase === 'LISTENING' ? 'We’re listening.' : live.phase === 'AI_SPEAKING' ? 'Your microphone is paused while Ava speaks.' : 'Live transcript'}</h2></div>
        <AudioWaveform level={live.phase === 'AI_SPEAKING' ? live.outputLevel : live.level} active={live.phase === 'AI_SPEAKING' || live.phase === 'LISTENING'} />
      </div>
      {editing ? <><label className="sr-only" htmlFor="live-transcript">Review recognized answer</label><textarea id="live-transcript" value={live.transcript} maxLength={8000} onChange={e => live.edit(e.target.value)} /></> :
        <p className={`transcript-text ${!live.transcript && !live.partial ? 'is-empty' : ''}`} aria-live="polite">{live.partial || live.transcript || 'Your words will appear here. Speech is transcribed on the local engine; nothing is recorded.'}</p>}
      {live.countdown !== null && <p className="auto-countdown" role="status">Continuing in {live.countdown}s. Review the transcript to correct recognition errors.</p>}
      <div className="transcript-actions">
        <label><input type="checkbox" checked={live.autoContinue} onChange={e => live.setAutoContinue(e.target.checked)} /> Auto-continue after clear speech</label>
        {live.transcript && <button className="call-button secondary" disabled={busy} onClick={() => { live.review(); setEditing(true); }}>Review / edit transcript</button>}
        {live.transcript && <button className="call-button" disabled={busy} onClick={() => { setEditing(false); void live.submit(); }}>Submit reviewed answer</button>}
      </div>
    </section>

    <footer className="call-controls">
      {!joined ? <button className="call-button primary" disabled={!live.data || busy} onClick={() => void live.join()}>Enable microphone &amp; join</button> : <>
        <button className={`call-button ${live.muted ? 'muted' : ''}`} disabled={busy} onClick={live.toggleMute}>{live.muted ? 'Unmute microphone' : 'Mute microphone'}</button>
        <button className="call-button secondary" disabled={busy || !live.data} onClick={() => void live.speak()}>Repeat question</button>
        {live.phase === 'AI_SPEAKING' ? <button className="call-button secondary" onClick={live.pause}>Pause interviewer</button> : null}
        {live.phase === 'LISTENING' ? <button className="call-button primary" onClick={live.finishSpeaking}>Done speaking</button> : null}
        {['PAUSED', 'RECONNECTING', 'ERROR'].includes(live.phase) && question ? <button className="call-button primary" onClick={() => void live.join()}>Rejoin / resume</button> : null}
      </>}
      <button className="call-button text-button" disabled={live.phase === 'EVALUATING'} onClick={() => void fallback()}>Use text mode</button>
      {!question && live.data && <button className="call-button primary" onClick={() => setConfirmEnd(true)}>Finish &amp; view report</button>}
    </footer>
    <p className="call-disclosure">Local speech · near-real-time chunks · illustrated avatar · curated, resume-based questions. No audio/video recording. Camera events never affect your score.</p>

    {confirmEnd && <dialog ref={endDialog} className="call-dialog" onCancel={() => setConfirmEnd(false)} aria-labelledby="end-title">
      <h2 id="end-title">Finish this interview?</h2><p>{live.data?.progress.answered ?? 0} of {live.data?.progress.total ?? 0} questions answered. Unsubmitted speech is not scored. Unanswered questions receive zero marks.</p>
      {(live.data?.progress.answered ?? 0) === 0 && <p>Submit at least one answer to generate a report. You can leave and resume later.</p>}
      <div><button className="call-button secondary" onClick={() => setConfirmEnd(false)}>Keep interviewing</button>
        <button className="call-button danger" disabled={busy || !live.data?.progress.answered} onClick={() => void live.finish()}>Finish &amp; view report</button>
        <Link className="call-button text-button" to="/interview">Leave &amp; resume later</Link></div>
    </dialog>}
  </div>;
}
