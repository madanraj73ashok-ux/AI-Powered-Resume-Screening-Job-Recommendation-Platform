import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import mongoose from 'mongoose';
import { createApp } from '../app';
import { engineFetch } from '../services/aiEngine';
import { fetchProviderJobs, ProviderError, ProviderJob, providerApiUrl } from '../services/jobProviders';
import {
  ensureSourcesSeeded,
  pendingRefresh,
  refreshSources,
} from '../services/jobDiscovery.service';
import { Job } from '../models/Job';
import { JobSource } from '../models/JobSource';
import { JobApplication } from '../models/JobApplication';
import { SavedJob } from '../models/SavedJob';
import { Resume } from '../models/Resume';
import { InterviewResult } from '../models/InterviewResult';

// Only the local engine and the public job-board fetches are mocked.
// Auth, MongoDB and all route/service logic stay real.
vi.mock('../services/aiEngine', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/aiEngine')>()),
  engineFetch: vi.fn(),
}));
vi.mock('../services/jobProviders', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../services/jobProviders')>()),
  fetchProviderJobs: vi.fn(),
}));

const app = createApp();

const TEST_SOURCES = [
  { provider: 'greenhouse', token: 'test-acme', company: 'Acme' },
  { provider: 'lever', token: 'test-choom', company: 'Choom' },
];

function providerJob(overrides: Partial<ProviderJob> = {}): ProviderJob {
  return {
    externalId: '1',
    title: 'Software Engineer Intern',
    company: 'Acme',
    location: 'Bengaluru, India',
    arrangement: 'onsite',
    url: 'https://boards.greenhouse.io/test-acme/jobs/1',
    description: 'Requirements\nPython',
    postedAt: new Date('2026-10-01T00:00:00Z'),
    ...overrides,
  };
}

const LEVER_JOB = providerJob({
  externalId: '9',
  title: 'Junior Backend Engineer',
  company: 'Choom',
  url: 'https://jobs.lever.co/test-choom/23534d2b-3e2e-4759-b498-0bb15b2fb995',
  applyUrl: 'https://jobs.lever.co/test-choom/23534d2b-3e2e-4759-b498-0bb15b2fb995/apply',
});

/** The engine mock answers /jobs/parse and /jobs/match realistically. */
function mockEngine() {
  vi.mocked(engineFetch).mockImplementation(async (path, init) => {
    const body = JSON.parse(String(init?.body ?? '{}')) as {
      jobs: { id: string; title: string; requiredSkills?: string[]; applyUrl?: string }[];
    };
    if (path === '/jobs/parse') {
      return new Response(
        JSON.stringify({
          jobs: body.jobs.map((job) => ({
            requiredSkills: ['Python'],
            preferredSkills: ['SQL'],
            requirementsConfidence: 'requirements section',
            minExperienceYears: null,
            experienceEvidence: null,
            level: 'Internship',
            description: `${job.title} description`,
            link: job.applyUrl
              ? { linkKind: 'apply_now', linkLabel: 'Apply Now', url: job.applyUrl, verified: true, reason: 'verified form' }
              : { linkKind: 'view_job', linkLabel: 'View Job', url: '', verified: false, reason: 'employer page' },
          })),
          linkLabels: { apply_now: 'Apply Now', view_job: 'View Job', search_openings: 'Search Openings', unavailable: 'Link unavailable' },
        })
      );
    }
    if (path === '/jobs/match') {
      return new Response(
        JSON.stringify({
          skills: [{ skill: 'Python', categories: ['Mentioned in resume'] }],
          roles: [{ role: 'Python Developer', matchingSkills: ['Python'], coverage: 25, note: 'Role idea from a curated map.' }],
          matches: body.jobs.map((job) => ({
            jobId: job.id,
            score: 72,
            requiredSkills: job.requiredSkills ?? ['Python'],
            preferredSkills: [],
            requirementsConfidence: 'requirements section',
            level: 'Internship',
            minExperienceYears: null,
            matchingSkills: ['Python'],
            missingSkills: [],
            missingPreferredSkills: [],
            components: { skillCoverage: { value: 100, weight: 50 } },
            explanation: ['1/1 description skills are documented in the resume.'],
            learningPath: [],
            gapNote: 'Not found in the supplied evidence does not mean the candidate lacks the skill.',
            scoreNote: 'Explainable relevance estimate, not a probability of hiring.',
          })),
        })
      );
    }
    return new Response('not found', { status: 404 });
  });
}

async function user(role = 'candidate') {
  const agent = request.agent(app);
  const registration = await agent.post('/api/auth/register').send({
    name: 'Jobs Test Candidate',
    email: `jobs-${Date.now()}-${Math.random()}@test.local`,
    password: 'JobsTest!2026',
    role,
  });
  expect(registration.status).toBe(201);
  return { agent, id: registration.body.user.id as string };
}

async function seedResume(userId: string) {
  return Resume.create({
    user: userId,
    originalName: 'job-test.pdf',
    storageName: 'job-test.pdf',
    mimeType: 'application/pdf',
    size: 120,
    fullText: 'Python developer. Built a web application with Python.',
    profile: { skills: [{ skill: 'Python' }], projects: [{ text: 'Built a web application with Python.' }] },
  });
}

/** The matches handler may start a background refresh; settle it before the next test. */
async function settlePendingRefresh(): Promise<void> {
  const pending = pendingRefresh();
  if (pending) await pending.catch(() => undefined);
}

/** Keep only the two synthetic boards enabled for the duration of a test. */
async function enableTestSources() {
  await ensureSourcesSeeded();
  await JobSource.updateMany({}, { $set: { enabled: false } });
  for (const source of TEST_SOURCES) {
    await JobSource.updateOne(
      { provider: source.provider, token: source.token },
      {
        $set: { company: source.company, boardUrl: `https://example.test/${source.token}`, enabled: true },
        $setOnInsert: { lastStatus: 'never' },
      },
      { upsert: true }
    );
  }
}

beforeEach(async () => {
  await settlePendingRefresh();
  process.env.JOB_SOURCE_PACE_MS = '0';
  vi.mocked(engineFetch).mockReset();
  vi.mocked(fetchProviderJobs).mockReset();
  mockEngine();
  await enableTestSources();
});

afterEach(async () => {
  // Background refreshes write through source.save(); settle them before cleanup.
  await settlePendingRefresh();
  delete process.env.JOB_SOURCE_PACE_MS;
  await Promise.all([
    Job.deleteMany({}),
    JobSource.deleteMany({}),
    JobApplication.deleteMany({}),
    SavedJob.deleteMany({}),
    Resume.deleteMany({}),
    InterviewResult.deleteMany({}),
  ]);
});

describe('job discovery from real public boards', () => {
  it('requests job descriptions from the documented Greenhouse feed', () => {
    expect(new URL(providerApiUrl('greenhouse', 'acme')).searchParams.get('content')).toBe('true');
  });
  it('requires authentication and rejects recruiters on every candidate endpoint', async () => {
    const jobId = '64b7f0f0f0f0f0f0f0f0f0f0';
    const anonymous = [
      request(app).get('/api/jobs/matches'),
      request(app).get('/api/jobs/saved'),
      request(app).post('/api/jobs/refresh').send({}),
      request(app).post(`/api/jobs/${jobId}/save`),
      request(app).get('/api/applications'),
    ];
    for (const call of anonymous) expect((await call).status).toBe(401);

    const recruiter = await user('recruiter');
    expect((await recruiter.agent.get('/api/jobs/matches')).status).toBe(403);
    expect((await recruiter.agent.get('/api/jobs/saved')).status).toBe(403);
    expect((await recruiter.agent.post('/api/jobs/refresh').send({})).status).toBe(403);
    expect((await recruiter.agent.post(`/api/jobs/${jobId}/save`)).status).toBe(403);
    expect((await recruiter.agent.patch(`/api/applications/${jobId}`).send({ status: 'Withdrawn' })).status).toBe(403);
    expect(fetchProviderJobs).not.toHaveBeenCalled();
  });

  it('stores only real postings, dedupes, labels links and expires vanished postings', async () => {
    vi.mocked(fetchProviderJobs).mockImplementation(async (source) =>
      source.token === 'test-acme'
        ? [providerJob(), providerJob({ externalId: '2', title: 'Junior Data Analyst' })]
        : [LEVER_JOB]
    );
    const first = await refreshSources({ force: true });
    expect(first).toEqual({ refreshed: 2, skipped: 0, errors: 0 });
    expect(await Job.countDocuments({})).toBe(3);

    const lever = await Job.findOne({ externalId: '9' });
    expect(lever?.linkKind).toBe('apply_now');
    expect(lever?.linkLabel).toBe('Apply Now');
    expect(lever?.linkVerified).toBe(true);
    expect(lever?.applyUrl).toContain('/apply');
    expect(lever?.provider).toBe('lever');
    const greenhouse = await Job.findOne({ externalId: '1' });
    expect(greenhouse?.linkKind).toBe('view_job');
    expect(greenhouse?.linkVerified).toBe(false);
    expect(greenhouse?.requiredSkills).toEqual(['Python']);

    // The board stops returning one posting: it is expired, never deleted.
    vi.mocked(fetchProviderJobs).mockImplementation(async (source) =>
      source.token === 'test-acme'
        ? [providerJob({ title: 'Updated Software Engineer Intern' })]
        : [LEVER_JOB]
    );
    await refreshSources({ force: true });
    expect(await Job.countDocuments({})).toBe(3);
    expect((await Job.findOne({ externalId: '2' }))?.status).toBe('expired');
    expect(await Job.countDocuments({ status: 'active' })).toBe(2);
    expect(await Job.countDocuments({ dedupeKey: 'greenhouse:test-acme:1' })).toBe(1);
    expect((await Job.findOne({ dedupeKey: 'greenhouse:test-acme:1' }))?.title).toBe('Updated Software Engineer Intern');
  });

  it('skips boards that were checked recently and reports the freshness window', async () => {
    vi.mocked(fetchProviderJobs).mockResolvedValue([providerJob()]);
    const first = await refreshSources({ force: true });
    expect(first.refreshed).toBe(2);
    const callsAfterFirst = vi.mocked(fetchProviderJobs).mock.calls.length;

    const second = await refreshSources();
    expect(second).toEqual({ refreshed: 0, skipped: 2, errors: 0 });
    expect(vi.mocked(fetchProviderJobs).mock.calls.length).toBe(callsAfterFirst);

    const owner = await user();
    const response = await owner.agent.post('/api/jobs/refresh').send({});
    expect(response.status).toBe(200);
    expect(response.body.summary.skipped).toBe(2);
    const acme = response.body.sources.find((s: { company: string }) => s.company === 'Acme');
    expect(acme.status).toBe('ok');
    expect(acme.lastCheckedAt).toBeTruthy();
    expect(acme.boardUrl).toContain('example.test');
    const forced = await owner.agent.post('/api/jobs/refresh').send({ force: true });
    expect(forced.body.summary.skipped).toBe(2);
    expect(vi.mocked(fetchProviderJobs).mock.calls.length).toBe(callsAfterFirst);
    expect((await owner.agent.post('/api/jobs/refresh').send({ force: 'yes' })).status).toBe(400);
  });

  it('keeps stored postings and reports an unavailable board without inventing jobs', async () => {
    vi.mocked(fetchProviderJobs).mockResolvedValue([providerJob()]);
    await refreshSources({ force: true });

    vi.mocked(fetchProviderJobs).mockImplementation(async (source) => {
      if (source.token === 'test-acme') throw new ProviderError('The job board answered with HTTP 403.');
      return [LEVER_JOB];
    });
    const failed = await refreshSources({ force: true });
    expect(failed.errors).toBe(1);
    expect(failed.refreshed).toBe(1);

    const acme = await JobSource.findOne({ token: 'test-acme' });
    expect(acme?.lastStatus).toBe('error');
    expect(acme?.lastError).toContain('403');
    const retained = await Job.findOne({ sourceKey: 'greenhouse:test-acme' });
    expect(retained?.status).toBe('active');
    // Acme keeps only its previously stored posting; Choom's vanished one is
    // expired and its new one stored. Nothing is invented for the failed board.
    expect(await Job.countDocuments({ status: 'active' })).toBe(2);
    expect(await Job.countDocuments({})).toBe(3);
  });
});

describe('candidate job matching', () => {
  it('uses the selected owned resume and refuses another candidate’s resume', async () => {
    const owner = await user();
    const other = await user();
    const first = await seedResume(owner.id);
    const second = await seedResume(owner.id);
    second.originalName = 'second.pdf';
    second.profile.skills = [{ skill: 'SQL' }];
    await second.save();
    const foreign = await seedResume(other.id);
    const response = await owner.agent.get(`/api/jobs/matches?resumeId=${second.id}`);
    expect(response.status).toBe(200);
    expect(response.body.selectedResumeId).toBe(second.id);
    expect(response.body.availableResumes.map((r: { id: string }) => r.id)).toEqual(expect.arrayContaining([first.id, second.id]));
    const matchCall = vi.mocked(engineFetch).mock.calls.find(([path]) => path === '/jobs/match');
    expect(JSON.parse(String(matchCall?.[1]?.body)).profile.skills[0].skill).toBe('SQL');
    expect((await owner.agent.get(`/api/jobs/matches?resumeId=${foreign.id}`)).status).toBe(404);
    expect((await owner.agent.get(`/api/jobs/roles?resumeId=${foreign.id}`)).status).toBe(404);
  });
  it('returns a friendly no-resume state without calling the matching engine', async () => {
    const owner = await user();
    const response = await owner.agent.get('/api/jobs/matches');
    expect(response.status).toBe(200);
    expect(response.body.resumeMissing).toBe(true);
    expect(response.body.matches).toEqual([]);
    expect(engineFetch).not.toHaveBeenCalled();
  });

  it('merges engine scores with stored real vacancies and applies transparent filters', async () => {
    vi.mocked(fetchProviderJobs).mockImplementation(async (source) =>
      source.token === 'test-acme' ? [providerJob()] : [LEVER_JOB]
    );
    await refreshSources({ force: true });
    const owner = await user();
    await seedResume(owner.id);

    await owner.agent.put('/api/jobs/preferences').send({ location: 'Bengaluru', experienceYears: 1 });
    const response = await owner.agent.get('/api/jobs/matches');
    expect(response.status).toBe(200);
    expect(response.body.preferences).toEqual({ location: 'Bengaluru', experienceYears: 1 });
    expect(response.body.matches).toHaveLength(2);
    expect(response.body.roles[0].role).toBe('Python Developer');
    expect(response.body.interviewEvidenceUsed).toBe(false);

    const lever = response.body.matches.find((m: { provider: string }) => m.provider === 'lever');
    expect(lever.company).toBe('Choom');
    expect(lever.linkKind).toBe('apply_now');
    expect(lever.applyUrl).toContain('/apply');
    expect(lever.title).toBe('Junior Backend Engineer');
    expect(lever.saved).toBe(false);

    const greenhouse = response.body.matches.find((m: { provider: string }) => m.provider === 'greenhouse');
    expect(greenhouse.sourceCompany).toBe('Acme');
    expect(greenhouse.sourceLastCheckedAt).toBeTruthy();
    expect(greenhouse.linkKind).toBe('view_job');

    // The engine received the candidate evidence and entered preferences.
    const matchCall = vi.mocked(engineFetch).mock.calls.find(([path]) => path === '/jobs/match');
    const sent = JSON.parse(String(matchCall?.[1]?.body));
    expect(sent.preferences).toEqual({ location: 'Bengaluru', experienceYears: 1 });
    expect(sent.jobs).toHaveLength(2);
    expect(sent.profile.projects[0].text).toContain('Python');

    expect((await owner.agent.get('/api/jobs/matches?level=Internship')).body.matches).toHaveLength(2);
    expect((await owner.agent.get('/api/jobs/matches?search=choom')).body.matches).toHaveLength(1);
    expect((await owner.agent.get('/api/jobs/matches?search=choom&level=Experienced')).body.matches).toHaveLength(0);
    expect((await owner.agent.get('/api/jobs/matches?minScore=90')).body.matches).toHaveLength(0);
    expect((await owner.agent.get('/api/jobs/matches?savedOnly=true')).body.matches).toHaveLength(0);

    const job = await Job.findOne({ provider: 'lever' });
    await owner.agent.post(`/api/jobs/${job!.id}/save`);
    const savedOnly = await owner.agent.get('/api/jobs/matches?savedOnly=true');
    expect(savedOnly.body.matches).toHaveLength(1);
    expect(savedOnly.body.matches[0].saved).toBe(true);
    expect((await owner.agent.get('/api/jobs/matches?level=Experienced&savedOnly=true')).body.matches).toHaveLength(0);
  });

  it('does not treat an older result with unknown answer provenance as demonstrated evidence', async () => {
    vi.mocked(fetchProviderJobs).mockResolvedValue([providerJob()]);
    await refreshSources({ force: true });
    const owner = await user();
    await seedResume(owner.id);
    const sessionId = new mongoose.Types.ObjectId();
    await InterviewResult.create({
      user: owner.id,
      session: sessionId,
      difficulty: 'Intermediate',
      overall: { marksAwarded: 8, maxMarks: 10, percentage: 80 },
      skillScores: [{ skill: 'Python', questions: 2, marksAwarded: 16, maxMarks: 20, percentage: 80 }],
    });
    const response = await owner.agent.get('/api/jobs/matches');
    expect(response.body.interviewEvidenceUsed).toBe(false);
    const matchCall = vi.mocked(engineFetch).mock.calls.find(([path]) => path === '/jobs/match');
    const sent = JSON.parse(String(matchCall?.[1]?.body));
    expect(sent.interviewScores).toEqual([]);
  });

  it('returns role directions for resume review without requiring an interview', async () => {
    const owner = await user();
    const before = await owner.agent.get('/api/jobs/roles');
    expect(before.body.resumeMissing).toBe(true);

    await seedResume(owner.id);
    const response = await owner.agent.get('/api/jobs/roles');
    expect(response.status).toBe(200);
    expect(response.body.resumeMissing).toBe(false);
    expect(response.body.roles[0].role).toBe('Python Developer');
    const matchCall = vi.mocked(engineFetch).mock.calls.find(([path]) => path === '/jobs/match');
    expect(JSON.parse(String(matchCall?.[1]?.body)).jobs).toEqual([]);
  });
});

describe('saved jobs and application tracking', () => {
  it('saves jobs idempotently, scoped to the owning candidate', async () => {
    vi.mocked(fetchProviderJobs).mockResolvedValue([providerJob()]);
    await refreshSources({ force: true });
    const job = await Job.findOne({});
    const owner = await user();
    const other = await user();

    expect((await owner.agent.post(`/api/jobs/${job!.id}/save`)).body.saved).toBe(true);
    expect((await owner.agent.post(`/api/jobs/${job!.id}/save`)).body.saved).toBe(true);
    expect(await SavedJob.countDocuments({})).toBe(1);

    const list = await owner.agent.get('/api/jobs/saved');
    expect(list.body.saved).toHaveLength(1);
    expect(list.body.saved[0].job.title).toBe('Software Engineer Intern');
    expect((await other.agent.get('/api/jobs/saved')).body.saved).toHaveLength(0);

    expect((await owner.agent.post('/api/jobs/64b7f0f0f0f0f0f0f0f0f0f0/save')).status).toBe(404);
    expect((await owner.agent.post('/api/jobs/not-an-id/save')).status).toBe(404);

    expect((await owner.agent.delete(`/api/jobs/${job!.id}/save`)).body.saved).toBe(false);
    expect(await SavedJob.countDocuments({})).toBe(0);
  });

  it('never creates an application from browsing; only explicit confirmation does', async () => {
    vi.mocked(fetchProviderJobs).mockResolvedValue([providerJob()]);
    await refreshSources({ force: true });
    const owner = await user();
    await seedResume(owner.id);
    const job = await Job.findOne({});

    await owner.agent.get('/api/jobs/matches');
    await owner.agent.get('/api/jobs/saved');
    await owner.agent.post(`/api/jobs/${job!.id}/save`);
    expect(await JobApplication.countDocuments({})).toBe(0);

    const created = await owner.agent.post(`/api/jobs/${job!.id}/applications`).send({});
    expect(created.status).toBe(201);
    expect(created.body.application.status).toBe('Applied');
    expect(created.body.application.statusHistory).toHaveLength(1);
    expect(created.body.application.job.title).toBe('Software Engineer Intern');
    expect(created.body.application.job.linkLabel).toBe('View Job');

    const again = await owner.agent.post(`/api/jobs/${job!.id}/applications`).send({});
    expect(again.status).toBe(200);
    expect(await JobApplication.countDocuments({})).toBe(1);
  });

  it('updates application status with history, validation and ownership checks', async () => {
    vi.mocked(fetchProviderJobs).mockResolvedValue([providerJob()]);
    await refreshSources({ force: true });
    const job = await Job.findOne({});
    const owner = await user();
    const other = await user();
    const created = await owner.agent.post(`/api/jobs/${job!.id}/applications`).send({});
    const id = created.body.application.id as string;

    expect((await owner.agent.patch(`/api/applications/${id}`).send({ status: 'Hired' })).status).toBe(400);
    expect((await other.agent.patch(`/api/applications/${id}`).send({ status: 'Rejected' })).status).toBe(404);
    expect((await other.agent.get('/api/applications')).body.applications).toHaveLength(0);

    const updated = await owner.agent.patch(`/api/applications/${id}`).send({ status: 'Interview Scheduled' });
    expect(updated.status).toBe(200);
    expect(updated.body.application.status).toBe('Interview Scheduled');
    expect(updated.body.application.statusHistory).toHaveLength(2);
    expect(updated.body.application.statusHistory[1].status).toBe('Interview Scheduled');

    // Re-sending the same status is idempotent and adds no duplicate history.
    await owner.agent.patch(`/api/applications/${id}`).send({ status: 'Interview Scheduled' });
    const list = await owner.agent.get('/api/applications');
    expect(list.body.applications).toHaveLength(1);
    expect(list.body.applications[0].statusHistory).toHaveLength(2);
    expect(list.body.applications[0].job.linkKind).toBe('view_job');
  });

  it('validates candidate job preferences', async () => {
    const owner = await user();
    const ok = await owner.agent.put('/api/jobs/preferences').send({ arrangement: 'Remote', experienceYears: 2 });
    expect(ok.status).toBe(200);
    expect(ok.body.preferences.experienceYears).toBe(2);
    expect((await owner.agent.put('/api/jobs/preferences').send({ experienceYears: -1 })).status).toBe(400);
    expect((await owner.agent.put('/api/jobs/preferences').send({ arrangement: 'Anywhere' })).status).toBe(400);
    expect((await owner.agent.put('/api/jobs/preferences').send({ experienceYears: 2, extra: true })).status).toBe(400);
  });
});
