import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import JobsPage from '../pages/Jobs';
import { VacancyLink } from '../components/VacancyLink';
import * as jobsApi from '../api/jobs';

vi.mock('../api/jobs', async (original) => ({
  ...(await original<typeof import('../api/jobs')>()),
  getMatches: vi.fn(),
  refreshJobs: vi.fn(),
  saveJob: vi.fn(),
  unsaveJob: vi.fn(),
  createApplication: vi.fn(),
  setPreferences: vi.fn(),
}));
vi.mock('../components/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }));

const source: jobsApi.SourceStatus = {
  provider: 'greenhouse',
  sourceKey: 'greenhouse:acme',
  company: 'Acme',
  boardUrl: 'https://boards.greenhouse.io/acme',
  enabled: true,
  lastCheckedAt: '2026-10-27T10:00:00.000Z',
  status: 'ok',
  jobCount: 12,
  error: null,
  stale: false,
};

function match(overrides: Partial<jobsApi.JobMatch> = {}): jobsApi.JobMatch {
  return {
    jobId: 'job1',
    score: 72,
    title: 'Software Engineer Intern',
    company: 'Acme',
    location: 'Bengaluru, India',
    arrangement: 'onsite',
    level: 'Internship',
    provider: 'greenhouse',
    sourceCompany: 'Acme',
    sourceLastCheckedAt: '2026-10-27T10:00:00.000Z',
    sourceStatus: 'ok',
    url: 'https://boards.greenhouse.io/acme/jobs/1',
    applyUrl: null,
    linkKind: 'view_job',
    linkLabel: 'View Job',
    linkVerified: false,
    linkReason: 'Job-specific posting page; the employer hosts the application form there.',
    requiredSkills: ['Python', 'SQL'],
    preferredSkills: [],
    matchingSkills: ['Python'],
    missingSkills: ['SQL'],
    missingPreferredSkills: [],
    requirementsConfidence: 'requirements section',
    minExperienceYears: null,
    components: { skillCoverage: { value: 50, weight: 44 } },
    explanation: ['1/2 description skills are documented in the resume.'],
    learningPath: [{ skill: 'SQL', action: 'Practice joins and grouping.' }],
    gapNote: 'Not found in the supplied evidence does not mean the candidate lacks the skill.',
    scoreNote: 'Explainable relevance estimate, not a probability of hiring.',
    saved: false,
    ...overrides,
  };
}

function response(overrides: Partial<jobsApi.MatchesResponse> = {}): jobsApi.MatchesResponse {
  return {
    discoveryEnabled: true,
    resumeMissing: false,
    interviewEvidenceUsed: false,
    generatedAt: '2026-10-27T10:00:00.000Z',
    refreshing: false,
    preferences: {},
    skills: [],
    roles: [{ role: 'Python Developer', matchingSkills: ['Python'], coverage: 25 }],
    sources: [source],
    matches: [match()],
    ...overrides,
  };
}

function renderJobs() {
  return render(
    <MemoryRouter>
      <JobsPage />
    </MemoryRouter>
  );
}

beforeEach(() => vi.resetAllMocks());

describe('job matches dashboard', () => {
  it('allows choosing which resume is used for matches', async () => {
    vi.mocked(jobsApi.getMatches).mockResolvedValue(response({ selectedResumeId: 'one', availableResumes: [{ id: 'one', name: 'one.pdf' }, { id: 'two', name: 'two.pdf' }] }));
    renderJobs();
    const selector = await screen.findByLabelText('Resume used for matches');
    fireEvent.change(selector, { target: { value: 'two' } });
    await waitFor(() => expect(jobsApi.getMatches).toHaveBeenCalledWith(expect.objectContaining({ resumeId: 'two' })));
  });
  it('does not present an impersonated application URL as a verified form', () => {
    render(<VacancyLink linkKind="apply_now" url="https://jobs.lever.co/acme/23534d2b-3e2e-4759-b498-0bb15b2fb995" applyUrl="https://evil-lever.co/acme/23534d2b-3e2e-4759-b498-0bb15b2fb995/apply" />);
    expect(screen.queryByRole('link', { name: /Apply Now/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /View Job/ })).toHaveAttribute('href', 'https://jobs.lever.co/acme/23534d2b-3e2e-4759-b498-0bb15b2fb995');
  });
  it('asks for a resume instead of inventing matches when none exists', async () => {
    vi.mocked(jobsApi.getMatches).mockResolvedValue(response({ resumeMissing: true, matches: [], roles: [] }));
    renderJobs();
    expect(await screen.findByText('Upload a resume to see job matches')).toBeInTheDocument();
    expect(jobsApi.getMatches).toHaveBeenCalledTimes(1);
  });

  it('shows a real vacancy with honest labels, its link and the provider source line', async () => {
    vi.mocked(jobsApi.getMatches).mockResolvedValue(response());
    renderJobs();
    expect(await screen.findByText('Software Engineer Intern')).toBeInTheDocument();
    expect(screen.getByText('Acme · Bengaluru, India')).toBeInTheDocument();
    expect(screen.getByText('72%')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: /View Job/ });
    expect(link).toHaveAttribute('href', 'https://boards.greenhouse.io/acme/jobs/1');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByText(/SQL · not in your evidence/)).toBeInTheDocument();
    expect(screen.getAllByText(/checked/).length).toBeGreaterThan(0);
    expect(screen.getByText(/not probabilities of hiring/)).toBeInTheDocument();
  });

  it('records an application only after explicit confirmation', async () => {
    vi.mocked(jobsApi.getMatches).mockResolvedValue(response());
    vi.mocked(jobsApi.createApplication).mockResolvedValue({
      id: 'app1',
      status: 'Applied',
      statusHistory: [{ status: 'Applied', at: '2026-10-27T10:05:00.000Z' }],
      appliedAt: '2026-10-27T10:05:00.000Z',
      updatedAt: '2026-10-27T10:05:00.000Z',
      job: null,
    });
    renderJobs();
    fireEvent.click(await screen.findByRole('button', { name: "I've applied" }));
    expect(jobsApi.createApplication).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, record it' }));
    await waitFor(() => expect(jobsApi.createApplication).toHaveBeenCalledWith('job1'));
    expect(await screen.findByText(/Applied · Applied/)).toBeInTheDocument();
  });

  it('shows unavailable boards with their error while keeping stored matches visible', async () => {
    vi.mocked(jobsApi.getMatches).mockResolvedValue(
      response({
        sources: [{ ...source, status: 'error', error: 'The job board answered with HTTP 403.' }],
      })
    );
    renderJobs();
    expect(await screen.findByText(/Some boards are unavailable right now/)).toBeInTheDocument();
    expect(screen.getByText(/HTTP 403/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Search Openings/ })).toHaveAttribute(
      'href',
      'https://boards.greenhouse.io/acme'
    );
    expect(screen.getByText('Software Engineer Intern')).toBeInTheDocument();
  });

  it('distinguishes an empty board list from empty filter results', async () => {
    vi.mocked(jobsApi.getMatches).mockResolvedValue(response({ matches: [], roles: [] }));
    renderJobs();
    expect(await screen.findByText('No vacancies stored yet')).toBeInTheDocument();
    // The header and the empty state both offer a board check.
    expect(screen.getAllByRole('button', { name: 'Check for new jobs' }).length).toBeGreaterThan(0);
  });
});
