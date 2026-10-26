import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import InterviewSessionPage from '../pages/InterviewSession';
import * as interviews from '../api/interviews';

vi.mock('../api/interviews', async (original) => ({
  ...await original<typeof import('../api/interviews')>(),
  getInterview: vi.fn(), submitAnswer: vi.fn(), completeInterview: vi.fn(),
}));
vi.mock('../context/AuthContext', () => ({ useAuth: () => ({ user: { name: 'Test Candidate' } }) }));
vi.mock('../components/Toast', () => ({ useToast: () => ({ show: vi.fn() }) }));

const question = {
  id: 'q1', text: 'Explain Python lists and tuples.', type: 'fundamentals', difficulty: 'Beginner' as const,
  expectedConcepts: ['mutability'], maxMarks: 8, followUpTemplates: [], isFollowUp: false,
  rubric: { technicalAccuracy: 'Explain mutability accurately.' },
};
const session = {
  id: 'session1', user: 'user1', resume: 'resume1', difficulty: 'Beginner' as const,
  status: 'in_progress' as const, questions: [question], answers: [], currentIndex: 0,
  totalQuestions: 1, startedAt: new Date().toISOString(),
};
function renderSession() {
  return render(<MemoryRouter initialEntries={['/interview/session1']}><Routes>
    <Route path="/interview/:id" element={<InterviewSessionPage />} />
    <Route path="/interview/results/:id" element={<p>Saved interview report</p>} />
  </Routes></MemoryRouter>);
}
beforeEach(() => vi.resetAllMocks());

describe('candidate interview workflow', () => {
  it('can finish after reloading an interview with all answers saved', async () => {
    vi.mocked(interviews.getInterview).mockResolvedValue({ session, progress: {
      answered: 1, total: 1, percentage: 100, currentQuestion: null, completed: false,
    } });
    vi.mocked(interviews.completeInterview).mockResolvedValue({} as never);
    renderSession();
    fireEvent.click(await screen.findByRole('button', { name: 'Finish interview' }));
    expect(screen.getByText('1 of 1 questions answered.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, finish and view results' }));
    expect(await screen.findByText('Saved interview report')).toBeInTheDocument();
    expect(interviews.completeInterview).toHaveBeenCalledWith('session1');
  });

  it('waits for submission and continuation before showing the follow-up', async () => {
    vi.mocked(interviews.getInterview).mockResolvedValue({ session, progress: {
      answered: 0, total: 1, percentage: 0, currentQuestion: question, completed: false,
    } });
    vi.mocked(interviews.submitAnswer).mockResolvedValue({
      evaluation: { marksAwarded: 2, maxMarks: 8, percentage: 25, explanation: 'Review mutability.',
        matchedConcepts: [], missingConcepts: ['mutability'], breakdown: { technicalAccuracy: 0.2 } },
      nextQuestion: { ...question, id: 'q2', text: 'Give a practical example.', isFollowUp: true },
      isLastQuestion: false, progress: { answered: 1, total: 2, percentage: 50 },
    });
    renderSession();
    const input = await screen.findByLabelText('Your answer');
    expect(screen.getByRole('button', { name: 'Submit answer' })).toBeDisabled();
    fireEvent.change(input, { target: { value: 'Lists can be changed.' } });
    expect(interviews.submitAnswer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }));
    expect(await screen.findByText('Review mutability.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Give a practical example.' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next question' }));
    expect(screen.getByRole('heading', { name: 'Give a practical example.' })).toBeInTheDocument();
    expect(screen.getByLabelText('Your answer')).toHaveValue('');
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  });

  it('retains an unsubmitted answer when evaluation fails', async () => {
    vi.mocked(interviews.getInterview).mockResolvedValue({ session, progress: {
      answered: 0, total: 1, percentage: 0, currentQuestion: question, completed: false,
    } });
    vi.mocked(interviews.submitAnswer).mockRejectedValue(new Error('offline'));
    renderSession();
    fireEvent.change(await screen.findByLabelText('Your answer'), { target: { value: 'My answer is preserved.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Submit answer' }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(screen.getByLabelText('Your answer')).toHaveValue('My answer is preserved.');
    expect(screen.getByRole('button', { name: 'Submit answer' })).toBeEnabled();
  });
});
