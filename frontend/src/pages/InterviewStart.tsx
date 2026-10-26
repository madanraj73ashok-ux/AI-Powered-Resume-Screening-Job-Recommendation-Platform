import { useCallback, useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { apiErrorMessage } from '../api/client';
import {
  Difficulty,
  listInterviews,
  SessionSummary,
  startInterview,
  difficultyBadgeColor,
} from '../api/interviews';
import { listResumes, Resume, formatDate } from '../api/resumes';
import { Alert, Badge, Button, Card, EmptyState, SectionTitle, Spinner } from '../components/ui';
import { useToast } from '../components/Toast';
import { getVoiceConfiguration, VoiceConfiguration } from '../api/liveInterviews';

const DIFFICULTY_HELP: Record<Difficulty, string> = {
  Beginner: 'Fundamentals and definitions. Best for a first run.',
  Intermediate: 'Applied knowledge, examples and trade-offs.',
  Advanced: 'Architecture, debugging and design reasoning.',
};

export default function InterviewStartPage() {
  const navigate = useNavigate();
  const toast = useToast();

  const [resumes, setResumes] = useState<Resume[]>([]);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const [resumeId, setResumeId] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty>('Intermediate');
  const [questionCount, setQuestionCount] = useState(8);
  const [mode, setMode] = useState<'text' | 'voice'>('voice');
  const [interviewType, setInterviewType] = useState('Mixed');
  const [duration, setDuration] = useState(20);
  const [rate, setRate] = useState(1);
  const [voice, setVoice] = useState('lessac');
  const [voiceConfig, setVoiceConfig] = useState<VoiceConfiguration | null>(null);
  useEffect(() => { void getVoiceConfiguration().then(config => {
    setVoiceConfig(config); setVoice(config.voices[0]?.id ?? 'lessac');
  }).catch(() => setVoiceConfig(null)); }, []);

  const load = useCallback(async () => {
    try {
      const [r, s] = await Promise.all([listResumes(), listInterviews()]);
      setResumes(r);
      setSessions(s);
      if (r.length > 0) setResumeId((prev) => prev || r[0].id);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onStart = async () => {
    if (!resumeId) return;
    setStarting(true);
    setError(null);
    try {
      const { session } = await startInterview({ resumeId, difficulty,
        questionCount: mode === 'voice' ? (duration === 10 ? 6 : duration === 20 ? 9 : 12) : questionCount,
        mode, interviewType, targetDurationMinutes: duration, speakingRate: rate, voice });
      toast.show('Interview started.', 'success');
      navigate(mode === 'voice' ? `/interview/live/${session.id}` : `/interview/${session.id}`);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setStarting(false);
    }
  };

  if (loading) return <Spinner label="Loading interviews…" />;

  const inProgress = sessions.filter((s) => s.status === 'in_progress');
  const completed = sessions.filter((s) => s.status === 'completed');
  const analyzed = resumes.some((r) => r.analysis?.analyzedAt);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-navy-900">AI interview</h1>
        <p className="mt-1 text-sm text-slate-500">
          Personalized to your resume, one question at a time. Questions come from a curated
          bank and deterministic personalization — not a generative language model. Answers are
          scored against question-specific rubrics by the local engine.
        </p>
      </div>

      {error ? <Alert>{error}</Alert> : null}

      {resumes.length === 0 ? (
        <EmptyState
          title="Upload a resume first"
          description="The interview is built from your resume's skills, projects, experience and analysis findings."
          action={
            <Link to="/resume/upload">
              <Button>Upload resume</Button>
            </Link>
          }
        />
      ) : (
        <Card>
          <SectionTitle
            title="Start a new interview"
            subtitle="Choose the resume, difficulty and number of questions"
          />
          <div className="mb-5 grid gap-4 md:grid-cols-3">
            <div><label className="label" htmlFor="int-mode">Interview mode</label>
              <select id="int-mode" className="input" value={mode} onChange={e => setMode(e.target.value as 'text' | 'voice')}>
                <option value="voice">Live voice interview</option><option value="text">Text interview</option>
              </select></div>
            {mode === 'voice' && <><div><label className="label" htmlFor="int-type">Interview type</label>
              <select id="int-type" className="input" value={interviewType} onChange={e => setInterviewType(e.target.value)}>
                {['HR', 'Technical', 'Project-based', 'Behavioral', 'Mixed'].map(type => <option key={type}>{type}</option>)}
              </select></div>
              <div><label className="label" htmlFor="int-duration">Target duration</label>
                <select id="int-duration" className="input" value={duration} onChange={e => setDuration(Number(e.target.value))}>
                  {[10, 20, 30].map(value => <option key={value} value={value}>{value} minutes</option>)}
                </select></div>
              <div><label className="label" htmlFor="int-voice">Interviewer voice</label>
                <select id="int-voice" className="input" value={voice} onChange={e => setVoice(e.target.value)}>
                  {voiceConfig?.voices.length ? voiceConfig.voices.map(item => <option key={item.id} value={item.id}>{item.name}</option>) : <option value="lessac">No local voice available</option>}
                </select></div>
              <div><label className="label" htmlFor="int-rate">Speaking speed</label>
                <select id="int-rate" className="input" value={rate} onChange={e => setRate(Number(e.target.value))}>
                  <option value="0.85">Slower</option><option value="1">Normal</option><option value="1.15">Faster</option>
                </select></div></>}
          </div>
          {mode === 'voice' && <div className="mb-5 rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
            <p>{voiceConfig?.ready ? 'Offline speech is ready. Enable the microphone after opening your interview; camera use is optional.' :
              'Local speech is not ready. Complete offline voice setup or choose text interview.'}</p>
            <p className="mt-2 text-xs">Questions are spoken, then your microphone listens. Clear transcripts can auto-submit after a four-second review window.
              Uncertain recognition always needs review. No audio/video is recorded. Duration is a target, not a fixed question count.</p>
          </div>}
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="label" htmlFor="int-resume">
                Resume
              </label>
              <select
                id="int-resume"
                className="input"
                value={resumeId}
                onChange={(e) => setResumeId(e.target.value)}
              >
                {resumes.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.originalName} · {formatDate(r.createdAt)}
                  </option>
                ))}
              </select>
              {!analyzed ? (
                <p className="mt-1 text-xs text-amber-700">
                  Tip: run resume analysis first so findings can drive verification questions.
                </p>
              ) : null}
            </div>
            <div>
              <label className="label" htmlFor="int-difficulty">
                Difficulty
              </label>
              <select
                id="int-difficulty"
                className="input"
                value={difficulty}
                onChange={(e) => setDifficulty(e.target.value as Difficulty)}
              >
                {(['Beginner', 'Intermediate', 'Advanced'] as Difficulty[]).map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">{DIFFICULTY_HELP[difficulty]}</p>
            </div>
            {mode === 'text' && <div>
              <label className="label" htmlFor="int-count">
                Questions
              </label>
              <select
                id="int-count"
                className="input"
                value={questionCount}
                onChange={(e) => setQuestionCount(Number(e.target.value))}
              >
                {[5, 8, 10, 12].map((n) => (
                  <option key={n} value={n}>
                    {n} questions
                  </option>
                ))}
              </select>
            </div>}
          </div>
          <div className="mt-4 flex items-center justify-between gap-3">
            <p className="text-xs text-slate-500">
              Progress is saved after each submitted answer. The resume may support fewer questions;
              targeted follow-ups can increase the total to at most 15.
            </p>
            <Button onClick={() => void onStart()} disabled={starting || !resumeId || (mode === 'voice' && !voiceConfig?.ready)}>
              {starting ? 'Preparing questions…' : 'Start AI interview'}
            </Button>
          </div>
        </Card>
      )}

      {inProgress.length > 0 ? (
        <Card>
          <SectionTitle title="In progress" subtitle="Continue where you left off" />
          <ul className="divide-y divide-slate-100">
            {inProgress.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <div className="text-sm font-medium text-navy-900">
                    {s.difficulty} {s.mode === 'voice' ? `${s.interviewType ?? 'Mixed'} voice ` : ''}interview · {s.answered}/{s.totalQuestions} answered
                  </div>
                  <div className="text-xs text-slate-500">{s.resumeName ? `${s.resumeName} · ` : ''}Started {formatDate(s.startedAt)}</div>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-32">
                    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                      <div
                        className="h-2 rounded-full bg-navy-600"
                        style={{
                          width: `${s.totalQuestions ? Math.round((s.answered / s.totalQuestions) * 100) : 0}%`,
                        }}
                      />
                    </div>
                  </div>
                  <Button variant="secondary" onClick={() => navigate(s.mode === 'voice' ? `/interview/live/${s.id}` : `/interview/${s.id}`)}>
                    Continue
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <SectionTitle title="Interview history" subtitle="Completed interviews and scores" />
        {completed.length === 0 ? (
          <p className="text-sm text-slate-500">No completed interviews yet.</p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {completed.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div>
                  <div className="flex items-center gap-2 text-sm font-medium text-navy-900">
                    {s.difficulty} interview
                    <Badge color={difficultyBadgeColor(s.difficulty)}>{s.difficulty}</Badge>
                  </div>
                  <div className="text-xs text-slate-500">
                    {s.answered} answered · completed {formatDate(s.completedAt ?? s.startedAt)}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-lg font-bold text-navy-900">{s.score ?? 0}%</span>
                  <Button
                    variant="secondary"
                    onClick={() => navigate(`/interview/results/${s.id}`)}
                  >
                    View results
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
