# Phase 4 — Personalized interview engine

The existing React → Express → FastAPI → MongoDB architecture is retained. No paid
API keys or external model calls are needed. Phases 5–9 remain pending.

## Candidate workflow

1. Register a candidate account, then sign in at http://localhost:5173.
2. Upload a PDF/DOCX and review the extracted profile and claim-level analysis.
3. Choose **AI Interview**, a resume, Beginner/Intermediate/Advanced difficulty and
   a base question count (5, 8, 10 or 12 in the UI; 3–12 through the API).
4. Answer one question at a time. Nothing is submitted automatically. The local
   engine returns marks, dimension scores, covered/missing concepts and feedback.
5. Use **Next question** to continue. Low-scoring base answers can insert one
   follow-up targeting a missing concept; follow-ups never create follow-ups.
6. **Save & exit** preserves submitted answers; **Continue** resumes the pending
   question. Unsubmitted drafts are not persisted.
7. Finish with confirmation, including after reloading the final question. Early
   finishing is supported after one answer; unanswered questions receive zero.
8. **Interview Results** lists reports with overall score, skill performance,
   strengths, weak skills/answers, missing concepts, recommendations and the full
   question/answer review.

Questions explicitly identify their origin as curated banks and deterministic
resume personalization, not a generative language model. Sources include skills,
project descriptions, employment history and supported analysis findings. Rubrics
name the question's expected concepts and use four weights: technical accuracy
40%, completeness 25%, practical examples 20%, understanding 15%.

## API contract

All Express interview routes require an authenticated **candidate**. MongoDB
ownership is checked for resumes, sessions, answers, completion and results.

| Method | Route | Behavior |
| --- | --- | --- |
| POST | `/api/interviews` | Start from `{ resumeId, difficulty, questionCount }` |
| GET | `/api/interviews` | List the candidate's sessions and scores |
| GET | `/api/interviews/:id` | Resume: session, saved answers, progress and current question |
| POST | `/api/interviews/:id/answers` | Submit `{ questionId, answer }`, evaluate, save and advance |
| POST | `/api/interviews/:id/complete` | Freeze progress and create/retrieve the report |
| GET | `/api/interviews/:id/result` | Retrieve the candidate's report |

The answer endpoint performs evaluation and persistence together; there is no
client-controlled score endpoint. FastAPI exposes internal `/generate-questions`,
`/evaluate-answer` and `/interview/options` routes. Keep the engine bound to loopback.

Answers are trimmed and limited to 8,000 characters. Invalid difficulty/count,
out-of-order answers, empty answers and completed-session writes are rejected.
Unavailable engine calls return a retryable 503 and do not advance the interview.
Optimistic concurrency prevents duplicate concurrent submissions and answer/finish
races. Conflicts return 409 with reload guidance. Reports have a unique session
index; completion uses an idempotent upsert. Repeating completion repairs the
case where the session was frozen before report creation was interrupted.

## Files changed in this Phase 4 completion pass

- `ai-engine/app/questions.py`: stable question IDs, concept-specific rubric text,
  actual finding claims, architecture questions at Advanced level, experience
  coverage and skill attribution for verification questions.
- `ai-engine/tests/test_interview.py`: deterministic/bounded scoring, sparse
  fallback, rubric, source coverage and difficulty regression tests.
- `backend/src/models/InterviewSession.ts`: optimistic concurrency.
- `backend/src/models/InterviewResult.ts`: one report per session.
- `backend/src/services/interview.service.ts`: conflict handling, follow-up rubrics,
  completion recovery, weak-answer recommendations and skipped-concept coverage.
- `backend/src/tests/interviews.test.ts`: concurrency, persistence recovery,
  validation, engine failure and ownership regressions.
- `frontend/src/components/Layout.tsx`: mobile navigation and exact interview tab matching.
- `frontend/src/pages/InterviewSession.tsx`: finish-after-reload recovery, early finish,
  rubric display, accessible progress, character limit and clear save semantics.
- `frontend/src/pages/InterviewStart.tsx`: dynamic question-count explanation.
- `frontend/src/test/interview.test.tsx`: submit/continue behavior, follow-up UI,
  evaluation failure and finishing after a final-answer reload.
- `README.md`, `docs/PHASE4.md`: status, operation and verification documentation.
- `docs/verification/phase4-interview-report.png`: browser verification screenshot.

Existing interview routes, controllers, engine scoring, API bindings, results
page, dashboard and sidebar entries were inspected and reused. Pre-existing
changes to Assessment.ts, assessment.service.ts, AssessmentTest.tsx and
frontend/src/api/interviews.ts were preserved.

## Verification — October 26, 2026

- Python: **33 passed**; one upstream Starlette/AnyIO deprecation warning.
- Backend: **56 passed across 8 files**, including both live interview tests and
  all four live resume tests against FastAPI. No live suites skipped.
- Frontend: **7 passed across 2 files**. React Router emits v7 future-flag warnings.
- Backend and frontend TypeScript checks pass.
- Backend compilation and Vite production build pass.
- Browser: candidate registration and login → actual synthetic PDF upload →
  extracted profile/analysis → Intermediate interview → scored answers → exit and
  resume at question 2 → targeted follow-up after a weak answer → all six answers
  submitted → reload at 100% → finish confirmation → detailed report.
  The verified report scored **44/55 (80%)**, with six answered questions (five
  base questions plus one follow-up). This is a test result, not a model-quality benchmark.
  [View the browser evidence](verification/phase4-interview-report.png).

## Exact Windows PowerShell commands

Run each service in its own terminal:

```powershell
# Terminal 1
Set-Location 'E:\Resume uploading\ai-engine'
.\.venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
```

```powershell
# Terminal 2
Set-Location 'E:\Resume uploading'
npm.cmd --prefix backend run dev
```

```powershell
# Terminal 3
Set-Location 'E:\Resume uploading'
npm.cmd --prefix frontend run dev
```

Open http://localhost:5173. Use a candidate account for interviews; admin and
recruiter roles cannot use candidate interview endpoints.

```powershell
# Verification; keep the engine running for the live backend tests
Set-Location 'E:\Resume uploading'
npm.cmd --prefix backend test
npm.cmd --prefix frontend test
npm.cmd run typecheck
npm.cmd run build
Set-Location 'E:\Resume uploading\ai-engine'
.\.venv\Scripts\python.exe -m pytest -q
```

## Known limitations

- Expected-concept matching, synonyms, TF-IDF and structural heuristics provide
  practice feedback. They cannot reliably verify factual correctness, detect
  contradictions, or measure genuine understanding; keyword-heavy answers can
  score too highly and valid paraphrases can be missed. No learned generative
  interviewer or code execution is used.
- Follow-ups target one missing concept from the immediately preceding answer.
  They do not reason over the entire conversation. The hard session cap is 15.
- Sparse resumes can yield fewer questions than requested. Unknown skills use
  generic application templates. Question generation and scoring currently target
  English; resume extraction quality limits personalization.
- A supported finding type is needed for finding-specific verification questions;
  contact-data findings are not treated as technical interview questions.
- Only submitted answers are stored. Missing concepts remain visible for the
  original answer even if a later follow-up covers them.
- Sessions and reports persist across browser interruptions in MongoDB. The
  development in-memory fallback loses all database data on backend restart.
  Configure `MONGODB_URI` for a durable MongoDB server to retain data across
  restarts (and optionally set `MONGODB_MEMORY_FALLBACK=false`).
- Existing completed reports are immutable snapshots; later scoring/rubric
  changes apply to new sessions and do not rewrite prior results.
- Adding a unique report index requires existing data to have at most one report
  per session. There is no destructive duplicate cleanup in this implementation.
