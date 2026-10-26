# Local voice interview implementation plan

## Phase A: architecture (before implementation)

Preserve Phase 1–4, all existing text routes and candidate ownership rules.
Reuse resume.service, interview.service, questions.py, scoring.py, InterviewSession,
InterviewResult, the candidate sidebar, setup page and results dashboard.

Implement in order:

1. B/C: local faster-whisper CPU INT8 transcription with Silero VAD, Piper WAV
   synthesis, explicit model provisioning, model readiness and bounded concurrency.
2. D: authenticated Express WebSocket coordination (cookie JWT, origin/ownership,
   payload and resource limits), per-turn partial/final transcript transport,
   existing answer evaluation and deterministic conversational follow-ups.
3. E: React live mode, microphone AudioWorklet capture, half-duplex turn state
   machine, local audio playback, subtitles, original animated SVG interviewer,
   timer, reconnect, replay, mute and accessible text fallback.
4. F: optional webcam preview and browser-local MediaPipe face count events.
   No recording, identity matching, emotion inference or score penalties.
5. G: persist transcript drafts, confirmed answers, event timestamps, interview
   configuration and report metadata in MongoDB, with authorized retrieval.
6. H: unit/integration tests, real local speech round-trip, regression suites,
   builds and browser checks. Clearly separate simulated tests from hardware checks.

New dependencies: backend ws + @types/ws; frontend @mediapipe/tasks-vision;
Python faster-whisper, piper-tts. No cloud inference, browser cloud speech APIs,
paid models or authentication tokens in URLs.

New Express routes: GET /api/interviews/configuration, GET /:id/live,
PUT /:id/live/transcript, POST /:id/live/events, POST /:id/live/speech and
WebSocket /api/interviews/:id/live/audio. Existing start/answers/complete/result
routes are extended rather than replaced. Vite proxies WebSocket upgrades.
New FastAPI routes: /speech/status, /speech/transcribe, /speech/synthesize.
Browser streams 16 kHz mono PCM16 frames through Express; no direct access to
the internal engine and no media files are retained. Transcription is chunked
near-real-time, not token-streaming ASR. The user can review recognition text
before it becomes a scored answer.

Speech device, compute type and model path are configurable. CPU INT8 is the
portable default. Optional CUDA inference requires compatible CUDA/cuDNN libraries.
Latency and recognition quality must be measured; no GPU performance is assumed.

Model downloads require explicit provisioning and never occur on a request.
The small offline speech models were downloaded with explicit user approval.
If unavailable, live setup reports unavailable models and offers text mode.

Design: dark navy, restrained cyan, two call panels, transcript/control strip,
human-readable state and privacy copy. Original illustrated avatar with blinking,
idle motion and playback-amplitude mouth movement; no claim of generated video.

## Installation and operation

Run from the repository root in PowerShell (core dependencies are already installed):

```powershell
npm.cmd --prefix backend install
npm.cmd --prefix frontend install
.\ai-engine\.venv\Scripts\python.exe -m pip install -r ai-engine/requirements-voice.txt
node scripts/setup-camera-assets.mjs
Set-Location ai-engine
.\.venv\Scripts\python.exe scripts/setup_voice.py --download
```

The explicit speech setup downloads faster-whisper tiny.en (~75 MB) and the
English Piper Lessac medium voice (~63 MB), their configurations and a model
card. Local SHA-256 receipts are saved alongside the models. Camera setup copies
the installed MediaPipe WASM and downloads the official ~230 KB short-range face
model. Provisioning needs network access; interviewing does not. No API key is used.
Models and copied assets are ignored by Git; re-run provisioning on a new checkout.
Keep the generated model card and review its dataset license before redistributing
the voice. Piper is GPL-licensed; MediaPipe is Apache-2.0.

Start three terminals:

```powershell
# Terminal 1, from the repository root
Set-Location ai-engine
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

```powershell
# Terminal 2, from the repository root
npm.cmd --prefix backend run dev
```

```powershell
# Terminal 3, from the repository root
npm.cmd --prefix frontend run dev
```

Open http://localhost:5173 and sign in as a candidate. Under AI Interview choose
Live voice interview, a resume, type, difficulty, target duration and speaking speed.
Choose Start AI interview, then Enable microphone & join. Browser microphone
permission is requested only on that action. Camera and face-presence checks are
independent opt-ins. Permission prompts time out after 15 seconds for the microphone;
text fallback remains available throughout the wait.

Use headphones for reliable turn-taking. During question playback the microphone
track is disabled. After playback, 16 kHz PCM travels over a cookie-authenticated
same-origin WebSocket to Express. Short cumulative windows are sent to local
Whisper, with Silero VAD and an energy-based end-of-turn heuristic. Partials update
approximately every five seconds, when speech is present and inference is idle.
After about 1.5 seconds of silence, or Done speaking, a final transcription is
saved as a draft. There is a 90-second utterance cap. This is near-real-time
chunked transcription, not a streaming token decoder or full-duplex conversation.

Clear transcripts can auto-continue after a four-second correction window; this
setting is visible and can be disabled. Uncertain or empty recognition never
auto-scores. The Review / edit action cancels auto-continue. Review edits are saved
after a short debounce. Reloading a final draft restores it without auto-submitting.
Confirmed transcript text uses the original answer evaluator, and the next actual
bank question can change difficulty. Follow-ups target gaps in the previous answer.
No open-ended language-model generation is claimed or required.

Short recognized greetings such as "hello" or "hello" followed by the candidate's
name are handled as conversational greetings. The interviewer acknowledges them
and repeats the current question; they are not submitted as scored answers.
The capture AudioWorklet is bundled through Vite's asset graph so it cannot be
silently replaced by the SPA fallback HTML when public assets are not watched.

Mute, replay, pause, optional camera and end-session controls have real behavior.
The illustrated avatar uses actual playback amplitude for mouth motion. Its
blinking/idle animation is cosmetic. The waveform uses captured/playback amplitude.
Subtitles show the question being spoken; phoneme-level alignment is not implemented.

No raw audio or video is written to storage. Raw buffers are bounded and released
on completion/cancellation/disconnection. MongoDB holds confirmed answers, final
draft transcripts, scores, configuration and allow-listed timestamped event data.
Camera processing happens locally in the browser; only event type/count/time is sent.

## Runtime options

The portable default is CPU INT8 with a small English model. Plan for at least
1–2 GB of free memory for the speech runtimes, beyond the app and OS; use measured
memory/latency for production sizing. Optional CUDA can be selected before starting:

```powershell
$env:WHISPER_DEVICE = 'cuda'
$env:WHISPER_COMPUTE_TYPE = 'int8_float16'
# Optional: point at a separately provisioned local CTranslate2 model folder
$env:WHISPER_MODEL_PATH = 'C:\path\to\local-whisper-model'
```

CUDA requires compatible CUDA/cuDNN libraries as documented by faster-whisper.
There is no automatic GPU dependency or large-model download. Leave these variables
unset for CPU mode. Restart after changing dependencies or model paths. The pinned
Windows wheels include compatible PyAV/CTranslate2/setuptools versions; core
resume/text features remain independent of these optional packages.

An additional already-provisioned Piper voice can be registered with
`PIPER_VOICE_PATH` (absolute `.onnx` path with an adjacent `.onnx.json`) and
`PIPER_VOICE_NAME` (display name). Only available configured voices appear in setup;
no voice model is downloaded by selecting it.

## Reliability, security and limitations

- WebSocket upgrades require the configured frontend Origin, a valid httpOnly
  JWT cookie, candidate role, an owned active voice session, and available
  connection capacity. No token travels in a URL. Existing REST ownership remains.
- One audio connection per candidate, four total per API process, per-frame and
  utterance limits, control-rate limits, heartbeat and bounded session lifetime.
  Heartbeat detects dead peers; the browser retries three times and then offers
  rejoin or text mode. Audio in transit can be lost; only acknowledged final drafts
  and submitted answers are durable. Reconnect pauses for user confirmation.
- Microphone tracks, camera tracks, AudioWorklet nodes, playback sources, timers,
  model instances and sockets are released on relevant exit paths. A late-granted
  microphone after timeout/cancellation is stopped.
- The existing development MongoDB memory fallback is temporary. Configure a
  durable MONGODB_URI for data across backend restarts.
- Interview duration is elapsed wall time including pauses and setup; the target
  does not guarantee a question count or force completion.
- Transcription can mishear names, accents, noisy audio and technical words.
  Recognition heuristics are not calibrated confidence estimates. Review the
  transcript. No speaking-rate, accent, appearance, emotion or identity score exists.
- Face detection can be wrong or unavailable; warnings are advisory and never
  affect marks. It does not establish liveness, identity, attention or honesty.
  Detection is throttled to one small frame check every two seconds. Physical
  camera preview and real face-count accuracy need device testing.
- Report content includes candidate/resume snapshot, configuration, elapsed time,
  rubric results, literal transcript markers for examples/reasoning, claim review,
  question/answer evidence and optional camera-event timestamps. These indicators
  require human review before consequential hiring decisions. They are not factual
  verification or a validated measure of communication competence.
- Existing authorized candidate report access is retained. Recruiter/admin access
  to other candidates' results is not broadened; a future assignment-based policy
  is needed before enabling recruiter review.
- Existing resume parsing limitations still affect personalization. Candidates can
  review/correct extracted profiles before starting. No model may invent history.
  This update excludes section headings and name initials from skill/project data,
  recognizes singular/academic project and internship headings, preserves literal
  achievements/responsibilities, and recovers degree lines from merged headings.
  These changes apply to fresh extraction; prior records/reports are not rewritten.
- Ollama and photorealistic avatars are optional extensions, not implemented here.

## Verification commands

```powershell
# Keep the AI engine running for live regression suites
npm.cmd --prefix backend test
npm.cmd --prefix frontend test
npm.cmd run typecheck
npm.cmd run build
Set-Location ai-engine
.\.venv\Scripts\python.exe -m pytest -q
.\.venv\Scripts\python.exe scripts/verify_voice.py
Set-Location ..
npx.cmd --prefix backend tsx backend/src/scripts/verifyLiveVoice.ts
```

`verify_voice.py` synthesizes two fixed test phrases, transcribes the actual WAV
samples and calculates word error rate. `verifyLiveVoice.ts` registers a synthetic
test candidate, uploads a synthetic DOCX, obtains real question audio, streams a
synthesized answer through the authenticated WebSocket, checks draft persistence
before scoring, confirms the answer and generates a report. It deliberately finishes
early; unanswered questions receive zero. Neither script is a human microphone test.

Observed local speech checks: 0.000 and 0.053 word error rate on the two synthetic
samples. Cold synthesis/transcription: 4.58s/5.58s; warm second sample: 1.13s/1.63s.
These sample measurements do not establish accuracy or latency for real candidates.
The full HTTP/WebSocket/speech/report integration passed with an exactly recognized
synthetic 10.5-second answer and a persisted, explicitly confirmed transcript.

## Primary implementation references

- [faster-whisper API, CPU/GPU requirements and Silero VAD](https://github.com/SYSTRAN/faster-whisper)
- [Piper Python synthesis API](https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/API_PYTHON.md)
- [MediaPipe local model setup and face detection](https://developers.google.com/edge/mediapipe/solutions/vision/face_detector/web_js)

## Checkpoint status

Implementation and synthetic-speech integration are present. Physical microphone,
speaker playback and camera accuracy are not claimed verified: the browser check
exposed a microphone asset delivery failure, which has been corrected and the
served JavaScript content verified. Rejoin after updating/reloading the app.
Permission denial, timeout, late stream cleanup and text fallback are covered by
automated tests. A real human voice/device session remains an explicit verification
step. Phase 5 job discovery/matching is a separate pending task in this checkpoint.
