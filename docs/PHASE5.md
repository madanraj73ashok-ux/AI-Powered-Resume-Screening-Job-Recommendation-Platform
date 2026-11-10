# Phase 5 — Job matching, real vacancies and application tracking

The existing React → Express → FastAPI → MongoDB architecture is retained. No paid
API keys and no fabricated vacancies. Discovery is the only feature that uses the
internet: anonymous reads of public company job boards.

## Candidate workflow

1. Review a resume (Phase 1–2 flow unchanged).
2. Open **Job matches** (also reachable from a role-directions card on the resume
   review page). Role directions appear without any interview.
3. Real vacancies are listed with an explainable match estimate, matched and
   missing skills, the provider/source and its last successful check time.
4. Open a vacancy (`Apply Now` / `View Job`) on the employer’s site and apply there.
5. Press **I’ve applied** and confirm. **My Applications** then tracks
   the status, and **Saved jobs** holds bookmarks. Opening a link never records an
   application; nothing is auto-submitted.

## Real sources only

Configured boards live in `backend/src/config/jobSources.json` and are read through
documented public APIs:

| Provider | Endpoint | Notes |
| --- | --- | --- |
| Greenhouse | `https://boards-api.greenhouse.io/v1/boards/{token}/jobs` | `absolute_url`, `updated_at`, `location.name`, `content` (HTML-encoded) |
| Lever | `https://api.lever.co/v0/postings/{token}?mode=json` | `hostedUrl`, documented `applyUrl`, `descriptionPlain`, `createdAt` |

`python scripts/verify_job_sources.py` checks every configured token against the
live API and prints the posting count and one real title. All 16 seeded boards
returned real postings when checked (MongoDB, Cloudflare, Stripe, Datadog, Reddit,
Figma, Anthropic, Coinbase, Paytm, JumpCloud, Zimperium, Brillio, Level AI,
Entrata, Weekday, Smart Working Solutions).

Discovery rules:

- Requests are serialized with a 1s pause (Lever robots.txt asks for a crawl delay).
- Per board, at most `JOB_MAX_PER_SOURCE` (default 60) postings are stored —
  early-career titles first, then the most recently posted.
- A posting is stored only from a provider response. Nothing is invented.
- Postings the board stops returning are marked `expired`; they are never deleted.
- A failed board keeps its stored postings, records a short error and shows as
  unavailable in the UI. A refresh error never removes data.
- Refreshes are lazy (when a candidate opens Job matches and a board is due) and
  manual (the button, which respects the `JOB_REFRESH_MINUTES` window).
- Per-posting skills/levels/links are parsed once, by the local engine
  (`POST /jobs/parse`), and reused on later refreshes.

## Matching model

`ai-engine/app/jobs.py` remains the deterministic matching authority:

| Component | Weight |
| --- | --- |
| Required-skill coverage | 40% |
| Project/experience (documented) evidence | 20% |
| Interview evidence (currently unavailable; weight redistributed) | 20% |
| Text relevance | 10% |
| Eligibility & candidate-entered preferences | 10% |

Components without data are `null`; their weight is redistributed across the
remaining components and the actual weights are shown per job. Certifications do
not count as hands-on evidence. Missing interview evidence (no scored interview)
or unknown experience reweights rather than guessing. The matching pool is
bounded (`JOB_MATCH_LIMIT`, default 300) and takes an even share per board so a
board refreshed last cannot crowd out the others. Every percentage is labeled an
explainable relevance estimate — not a probability of hiring.

Resume skills and text are sent to the local engine only. Existing interview
results do not record whether answers were candidate-authored or AI-assisted,
so their scores are excluded from matching until provenance can be established.

## Honest application links

`classify_application_url` (ai-engine) returns `{linkKind, linkLabel, url,
verified, reason}`:

- `apply_now` — **Apply Now** only for a provider-documented posting-specific
  application form (Lever’s `applyUrl` pattern; Greenhouse’s documented
  `embed/job_app` form).
- `view_job` — **View Job** for a job-specific posting page where the employer
  hosts the form (e.g. Greenhouse postings, whose public JSON has no separate
  application URL).
- `search_openings` — **Search Openings** only for board/search pages.
- `unavailable` — no safe HTTPS link exists, so no link button is rendered.

Non-HTTPS schemes (`javascript:`, `data:`, `file:`, `ftp:`, `http:`) are rejected.

## API contract

All routes require an authenticated **candidate**; the server owns all scoring and
ownership checks.

| Method | Route | Behaviour |
| --- | --- | --- |
| GET | `/api/jobs/matches` | Stored vacancies merged with engine scores; filters: `search`, `level`, `arrangement`, `location`, `minScore`, `savedOnly` |
| GET | `/api/jobs/roles` | Role directions only (no interview required) |
| GET | `/api/jobs/sources` | Candidate-safe board status list |
| POST | `/api/jobs/refresh` | Refresh due boards (`{force?}`), returns a summary + statuses |
| PUT | `/api/jobs/preferences` | Candidate-entered location/arrangement/experience years |
| GET | `/api/jobs/saved` | Saved jobs with a brief vacancy snapshot |
| POST / DELETE | `/api/jobs/:id/save` | Idempotent bookmark toggle (never an application) |
| POST | `/api/jobs/:id/applications` | Explicit candidate confirmation; idempotent |
| GET | `/api/applications` | The candidate’s applications with status history |
| PATCH | `/api/applications/:id` | Status change (validated enum), appends history |

MongoDB models: `Job`, `JobSource`, `SavedJob`, `JobApplication` (dedupe by
`sourceKey:externalId`, unique per user/job saves and applications).
Candidates never see other candidates’ matches, saves or applications.

## Security and privacy

- Discovery sends no candidate data to providers; requests are anonymous reads.
- Only public vacancy fields are stored (title, company, location, skills,
  description, public URLs) plus provider and last-checked timestamps.
- All job/application routes are candidate-only and user-scoped; a foreign
  application id returns 404 without confirming existence.
- Error messages stored per board are short, candidate-safe strings.
- Opening an application link is a plain `target="_blank" rel="noopener noreferrer"`
  link; it never triggers a write.

## Files changed in this pass

- `ai-engine/app/jobs.py`: link classification, provider-parsed skill input,
  description-free match results, `POST /jobs/parse`.
- `ai-engine/tests/test_job_links.py`: link labels, injection-as-data, parse
  validation, roles-only matching, pre-parsed skills.
- `backend/src/models/{Job,JobSource,SavedJob,JobApplication}.ts`,
  `services/{jobProviders,jobDiscovery.service,jobMatch.service}.ts`,
  `controllers/job.controller.ts`, `routes/{job,application}.routes.ts`,
  `config/jobSources.json`, env settings, `User.jobPreferences`, `app.ts` wiring.
- `backend/src/tests/jobs.test.ts`: 14 tests (RBAC, dedupe/expiry, freshness,
  outage handling, matching merge/filters, interview evidence, role directions,
  saves, application confirmation/status history/ownership, preferences).
- `frontend/src/{api/jobs.ts, pages/Jobs.tsx, pages/Applications.tsx,
  components/{VacancyLink,RoleSuggestions}.tsx}` plus nav, routes and the
  resume-review card.
- `frontend/src/test/jobs.test.tsx`: resume-missing, honest labels/links, explicit
  application confirmation, unavailable-board state, empty-vs-filtered states.
- `scripts/verify_job_sources.py`, `.env.example`, `README.md`.

## Verification evidence (this machine)

Commands:

```
npm --prefix backend test           -> 11 files, 85 tests passed
npm --prefix frontend test          -> 6 files, 27 tests passed
npm --prefix frontend run build     -> tsc --noEmit + vite build, success
cd ai-engine && .\.venv\Scripts\python.exe -m pytest -q -o addopts=  -> 84 passed
```

An earlier recorded end-to-end check through the running services (local MongoDB, real boards,
synthetic sample resume `backend/src/tests/fixtures/walte-okune-resume.pdf`):

- Forced refresh of all 16 boards: **86s wall time**, 16 refreshed / 0 errors;
  3,759 postings seen at the providers.
- Matches: 300 scored vacancies (bounded pool), top estimate 61%; 291 `apply_now`
  / 9 `view_job` at that moment.
- After the per-board pool fairness fix: 299 matches across all 16 companies,
  147 Lever (`apply_now`) / 152 Greenhouse (`view_job`).
- Role directions from the synthetic resume: Junior NLP Engineer 50%, ML Intern
  50%, Python Developer 25%, Junior Data Analyst 25%, Embedded/Robotics Intern 25%.
- Browsing matches/saved pages created **0** applications; explicit confirmation
  created exactly 1 with history; saving a job produced 1 saved entry.
- Network latency varied widely during verification (roughly 5–20s per board
  response); the default provider timeout was raised to 30s
  (`JOB_PROVIDER_TIMEOUT_MS`). A full first refresh may take several minutes on a
  slow connection; the UI states this and the server finishes even if a client
  disconnects.

A later browser check verified that selecting different uploaded resumes changes
the recommendations and that listings display their source check time. It did not
submit an application or establish candidate interview performance.

## Limitations / next steps

- Vacancy availability, counts and freshness depend on the boards; nothing is cached
  beyond the configured caps, and stale boards are labelled rather than hidden.
- Only the two documented provider APIs are supported; no scraping or pagination
  beyond the per-board cap.
- No admin UI yet for adding/removing boards (edit `jobSources.json` + refresh);
  admin dashboards remain Phase 7.
- The live check used a synthetic resume and one candidate; a human multi-candidate
  walkthrough is still required before calling this release-ready.
