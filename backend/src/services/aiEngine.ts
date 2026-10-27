import env from '../config/env';

/**
 * Client for the internal Python AI engine (FastAPI on localhost).
 * The engine is a private service; it is never called from the browser.
 * All processing is local — no paid external AI APIs.
 */
export class AiEngineError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
    this.name = 'AiEngineError';
  }
}

const TIMEOUT_MS = 45000;

export async function engineFetch(path: string, init?: RequestInit): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${env.aiEngineUrl}${path}`, { ...init, signal: controller.signal });
  } catch (err) {
    throw new AiEngineError(
      'The local AI engine is not reachable. Start it with: cd ai-engine; ' +
        '.\\.venv\\Scripts\\uvicorn.exe app.main:app --host 127.0.0.1 --port 8000',
      503
    );
  } finally {
    clearTimeout(timer);
  }
}

export interface EngineExtraction {
  pages: { page: number; chars: number }[];
  fullText: string;
  profile: Record<string, unknown>;
}

export async function extractFromBuffer(
  filename: string,
  buffer: Buffer,
  mime: string
): Promise<EngineExtraction> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(buffer)], { type: mime }), filename);
  const res = await engineFetch('/extract', { method: 'POST', body: form });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new AiEngineError(body.detail || 'The document could not be parsed.', res.status >= 500 ? 503 : 422);
  }
  return (await res.json()) as EngineExtraction;
}

export interface EngineAnalysis {
  summary: Record<string, unknown>;
  findings: Record<string, unknown>[];
}

export async function analyzeResumeText(
  profile: Record<string, unknown>,
  fullText: string
): Promise<EngineAnalysis> {
  const res = await engineFetch('/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ profile, fullText }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new AiEngineError(body.detail || 'Analysis failed.', 422);
  }
  return (await res.json()) as EngineAnalysis;
}

// ------------------------- Interview engine calls -------------------------

export interface EngineQuestion {
  id: string;
  text: string;
  type: string;
  difficulty: 'Beginner' | 'Intermediate' | 'Advanced';
  skill?: string;
  sourceClaim?: string;
  expectedConcepts: string[];
  rubric?: Record<string, string>;
  maxMarks: number;
  followUpTemplates: string[];
  isFollowUp?: boolean;
  parentQuestionId?: string;
  domain?: string;
  bankVersion?: string;
  rubricVersion?: string;
}

export interface EngineGeneration {
  difficulty: string;
  count: number;
  questions: EngineQuestion[];
  generatedBy: string;
  note: string;
}

export interface EngineEvaluation {
  marksAwarded: number;
  maxMarks: number;
  percentage: number;
  matchedConcepts: string[];
  missingConcepts: string[];
  breakdown: Record<string, number>;
  similarity: number;
  explanation: string;
  suggestedFollowUp: string | null;
  answerWordCount: number;
}

export async function generateQuestions(input: {
  profile: Record<string, unknown>;
  findings: unknown[];
  difficulty: string;
  count: number;
  seed: string;
  interviewType?: string;
  confirmedDomains?: string[];
}): Promise<EngineGeneration> {
  const res = await engineFetch('/generate-questions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new AiEngineError(body.detail || 'Question generation failed.', 422);
  }
  return (await res.json()) as EngineGeneration;
}

export async function evaluateAnswer(input: {
  question: Record<string, unknown>;
  answer: string;
  difficulty: string;
}): Promise<EngineEvaluation> {
  const res = await engineFetch('/evaluate-answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new AiEngineError(body.detail || 'Answer evaluation failed.', 422);
  }
  return (await res.json()) as EngineEvaluation;
}

export async function engineHealth(): Promise<boolean> {
  try {
    const res = await engineFetch('/health');
    return res.ok;
  } catch {
    return false;
  }
}
