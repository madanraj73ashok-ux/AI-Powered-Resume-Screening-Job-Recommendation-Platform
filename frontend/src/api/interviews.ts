import axios from 'axios';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';

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

export interface AssessmentResult {
  assessment: any;
  questions: AssessmentQuestion[];
  progress: AssessmentProgress;
  isLast: boolean;
}

/** Start a new assessment test */
export async function startAssessment(
  resumeId: string,
  questionCount?: number,
  thresholds?: any
): Promise<{ assessmentId: string; questions: AssessmentQuestion[] }> {
  const response = await axios.post(
    `${API_BASE}/assessment/start`,
    { resumeId, questionCount, thresholds },
    { withCredentials: true }
  );
  return response.data;
}

/** Submit an answer */
export async function submitAssessmentAnswer(
  assessmentId: string,
  input: SubmitAnswerInput
): Promise<{ isLast: boolean; progress: AssessmentProgress; assessment: any }> {
  const response = await axios.post(
    `${API_BASE}/assessment/${assessmentId}/answer`,
    input,
    { withCredentials: true }
  );
  return response.data;
}

/** Get assessment status and questions */
export async function getAssessmentStatus(
  assessmentId: string,
  userId: string
): Promise<{
  assessment: any;
  progress: AssessmentProgress;
  questions: AssessmentQuestion[];
}> {
  const response = await axios.get(
    `${API_BASE}/assessment/${assessmentId}/status`,
    { withCredentials: true, params: { userId } }
  );
  return response.data;
}

/** Reset/retake assessment */
export async function resetAssessment(assessmentId: string, userId: string): Promise<any> {
  const response = await axios.post(
    `${API_BASE}/assessment/${assessmentId}/reset`,
    {},
    { withCredentials: true }
  );
  return response.data;
}