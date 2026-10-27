import client from './client';

export type Difficulty = 'Beginner' | 'Intermediate' | 'Advanced';

export interface SessionSummary {
  id: string;
  resume: string;
  difficulty: Difficulty;
  status: 'in_progress' | 'completed';
  totalQuestions: number;
  answered: number;
  currentIndex: number;
  startedAt: string;
  completedAt?: string;
  score: number | null;
  mode?: 'text' | 'voice';
  interviewType?: string;
  candidateName?: string;
  resumeName?: string;
}

export interface InterviewQuestion {
  id: string;
  text: string;
  type: string;
  difficulty: Difficulty;
  skill?: string;
  sourceClaim?: string;
  expectedConcepts: string[];
  rubric?: Record<string, string>;
  maxMarks: number;
  followUpTemplates: string[];
  isFollowUp: boolean;
  parentQuestionId?: string;
}

export interface InterviewAnswer {
  questionId: string;
  text: string;
  marksAwarded: number;
  maxMarks: number;
  percentage: number;
  explanation: string;
  matchedConcepts: string[];
  missingConcepts: string[];
  breakdown?: Record<string, number>;
  similarity?: number;
  suggestedFollowUp?: string;
  answeredAt: string;
}

export interface InterviewSession {
  id: string;
  user: string;
  resume: string;
  difficulty: Difficulty;
  status: 'in_progress' | 'completed';
  questions: InterviewQuestion[];
  answers: InterviewAnswer[];
  currentIndex: number;
  totalQuestions: number;
  generator?: string;
  startedAt: string;
  completedAt?: string;
  mode?: 'text' | 'voice';
  interviewType?: string;
  targetDurationMinutes?: number;
  live?: { draftQuestionId?: string; draftTranscript?: string; reviewRequired?: boolean };
}

export interface InterviewProgress {
  answered: number;
  total: number;
  percentage: number;
  currentQuestion: InterviewQuestion | null;
  completed: boolean;
}

export interface Evaluation {
  marksAwarded: number;
  maxMarks: number;
  percentage: number;
  explanation: string;
  matchedConcepts: string[];
  missingConcepts: string[];
  breakdown: Record<string, number>;
  similarity?: number;
  suggestedFollowUp?: string;
}

export interface InterviewResult {
  id: string;
  user: string;
  session: string;
  resume?: string;
  difficulty: string;
  overall: {
    marksAwarded: number;
    maxMarks: number;
    percentage: number;
  };
  answeredCount: number;
  questionCount: number;
  skillScores: {
    skill: string;
    questions: number;
    marksAwarded: number;
    maxMarks: number;
    percentage: number;
  }[];
  strengths: string[];
  improvements: string[];
  missingConcepts: string[];
  recommendations: string[];
  summary?: string;
  createdAt: string;
  liveReport?: { interviewType: string; durationSeconds: number; targetDurationMinutes: number;
    candidateName?: string; resumeName?: string; interviewDate?: string;
    presenceEvents?: { type: string; at: string; faceCount?: number }[];
    communicationFeedback: string; humanReviewRequired: boolean; limitations: string;
    resumeConsistencyFindings: { claim?: string; question: string; answer: string | null; status: string }[] };
}

export interface StartInterviewInput {
  resumeId: string;
  difficulty: Difficulty;
  questionCount: number;
  mode?: 'text' | 'voice';
  interviewType?: string;
  targetDurationMinutes?: number;
  voice?: string;
  speakingRate?: number;
  adaptiveDifficulty?: boolean;
  confirmedDomains?: string[];
}

export async function startInterview(
  input: StartInterviewInput
): Promise<{ session: InterviewSession; progress: InterviewProgress }> {
  const res = await client.post('/interviews', input);
  return res.data;
}

export async function listInterviews(): Promise<SessionSummary[]> {
  const res = await client.get('/interviews');
  return res.data.sessions;
}

export async function getInterview(
  id: string
): Promise<{ session: InterviewSession; progress: InterviewProgress }> {
  const res = await client.get(`/interviews/${id}`);
  return res.data;
}

export async function submitAnswer(
  id: string,
  questionId: string,
  answer: string
): Promise<{
  evaluation: Evaluation;
  nextQuestion: InterviewQuestion | null;
  isLastQuestion: boolean;
  progress: { answered: number; total: number; percentage: number };
}> {
  const res = await client.post(`/interviews/${id}/answers`, { questionId, answer });
  return res.data;
}

export async function completeInterview(
  id: string
): Promise<{ result: InterviewResult; session: { id: string; status: string } }> {
  const res = await client.post(`/interviews/${id}/complete`);
  return res.data;
}

export async function getInterviewResult(id: string): Promise<InterviewResult> {
  const res = await client.get(`/interviews/${id}/result`);
  return res.data.result;
}

export function difficultyBadgeColor(
  diff: string
): 'slate' | 'green' | 'amber' | 'red' | 'navy' {
  switch (diff) {
    case 'Beginner':
      return 'green';
    case 'Intermediate':
      return 'navy';
    case 'Advanced':
      return 'amber';
    default:
      return 'slate';
  }
}

// Assessment endpoints
export interface AssessmentQuestion {
  id: string;
  type: string;
  question: string;
  options?: string[];
}

export interface AssessmentProgress {
  answered: number;
  total: number;
  percentage: number;
}

export interface SubmitAnswerInput {
  questionId: string;
  text: string;
}

export async function startAssessment(
  resumeId: string,
  questionCount?: number,
  thresholds?: any
): Promise<{ assessment: any; questions: AssessmentQuestion[] }> {
  const response = await client.post('/assessments/start', {
    resumeId,
    questionCount,
    thresholds,
  });
  return response.data;
}

export async function submitAssessmentAnswer(
  assessmentId: string,
  input: SubmitAnswerInput
): Promise<{ isLast: boolean; progress: AssessmentProgress; assessment: any }> {
  const response = await client.post(`/assessments/${assessmentId}/answer`, input);
  return response.data;
}

export async function getAssessmentStatus(
  assessmentId: string,
  userId: string
): Promise<{
  assessment: any;
  progress: AssessmentProgress;
  questions: AssessmentQuestion[];
}> {
  const response = await client.get(`/assessments/${assessmentId}/status`, {
    params: { userId },
  });
  return response.data;
}

export async function resetAssessment(assessmentId: string, _userId: string): Promise<any> {
  const response = await client.post(`/assessments/${assessmentId}/reset`, {});
  return response.data;
}
