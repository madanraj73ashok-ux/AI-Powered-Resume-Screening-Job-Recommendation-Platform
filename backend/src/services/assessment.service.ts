import { z } from 'zod';
import { ApiError } from '../middleware/errors';
import { Assessment, IAssessment, IAssessmentAnswer, IAssessmentResult, ISkillScore, IThresholds } from '../models/Assessment';
import { getResumeOwned } from './resume.service';
import { InterviewSession, InterviewSessionDoc } from '../models/InterviewSession';

export const startAssessmentSchema = z.object({
  resumeId: z.string().min(1, 'A resume is required'),
  questionCount: z.coerce.number().int().min(1).max(20).default(10),
  thresholds: z.any().optional(),
});

export const submitAnswerSchema = z.object({
  questionId: z.string().min(1, 'questionId is required'),
  text: z.string().min(1, 'An answer is required'),
  isCorrect: z.boolean().optional(),
  marksAwarded: z.number().optional(),
});

const DEFAULT_THRESHOLDS: IThresholds = {
  passScore: 50,
  qualificationScore: 60,
  minQuestions: 3,
  retakeAfterDays: 7,
};

function getThresholds(doc: IAssessment): IThresholds {
  const thresholds = doc.thresholds;
  if (typeof thresholds === 'object' && thresholds !== null) {
    return {
      passScore: thresholds.passScore ?? DEFAULT_THRESHOLDS.passScore,
      qualificationScore: thresholds.qualificationScore ?? DEFAULT_THRESHOLDS.qualificationScore,
      minQuestions: thresholds.minQuestions ?? DEFAULT_THRESHOLDS.minQuestions,
      retakeAfterDays: thresholds.retakeAfterDays ?? DEFAULT_THRESHOLDS.retakeAfterDays,
    };
  }
  return DEFAULT_THRESHOLDS;
}

export async function startAssessment(
  userId: string,
  input: { resumeId: string; questionCount?: number; thresholds?: IThresholds }
): Promise<{ assessment: IAssessment; questions: Array<{ id: string; type: string; question: string }> }> {
  const resume = await getResumeOwned(input.resumeId, userId);

  const questionCount = input.questionCount ?? 10;

  // Generate technical multiple-choice questions based on resume skills
  const questions = generateTechnicalQuestions(resume, questionCount);

  const assessment = await Assessment.create({
    user: userId,
    resume: resume._id,
    status: 'in_progress',
    questionCount,
    answeredCount: 0,
    score: 0,
    currentIndex: 0,
    questions,
    answers: [],
    thresholds: input.thresholds,
  });

  return { assessment, questions };
}

export async function submitAssessmentAnswer(
  assessmentId: string,
  userId: string,
  input: { questionId: string; text: string; isCorrect?: boolean; marksAwarded?: number }
): Promise<{ assessment: IAssessment; isLast: boolean; progress: { answered: number; total: number; percentage: number } }> {
  const assessment = await Assessment.findById(assessmentId);
  if (!assessment) {
    throw new ApiError(404, 'Assessment not found');
  }
  if (assessment.user.toString() !== userId) {
    throw new ApiError(403, 'Not authorized to answer this assessment');
  }
  if (assessment.status === 'completed') {
    throw new ApiError(400, 'This assessment is already completed');
  }

  const currentQuestion = assessment.questions[assessment.currentIndex];
  if (!currentQuestion) {
    throw new ApiError(400, 'No question is pending');
  }

  const isCorrect = input.isCorrect ?? checkAnswerCorrect(currentQuestion, input.text);
  const marksAwarded = input.marksAwarded ?? (isCorrect ? currentQuestion.maxMarks : 0);

  assessment.answers.push({
    questionId: currentQuestion.id,
    text: input.text,
    isCorrect,
    marksAwarded,
    maxMarks: currentQuestion.maxMarks,
    answeredAt: new Date(),
  });

  assessment.answeredCount += 1;
  assessment.currentIndex += 1;

  const isLast = assessment.currentIndex >= assessment.questions.length;
  if (isLast) {
    assessment.status = 'completed';
    assessment.completedAt = new Date();
    await assessment.save();
  } else {
    await assessment.save();
  }

  const progress = {
    answered: assessment.answeredCount,
    total: assessment.questionCount,
    percentage: assessment.questionCount ? Math.round((assessment.answeredCount / assessment.questionCount) * 100) : 0,
  };

  return { assessment, isLast, progress };
}

export async function getAssessmentStatus(
  assessmentId: string,
  userId: string
): Promise<{ assessment: IAssessment; progress: { answered: number; total: number; percentage: number }; questions: Array<{ id: string; type: string; question: string; isAnswered: boolean }> }> {
  const assessment = await Assessment.findById(assessmentId);
  if (!assessment) {
    throw new ApiError(404, 'Assessment not found');
  }
  if (assessment.user.toString() !== userId) {
    throw new ApiError(403, 'Not authorized to view this assessment');
  }

  const answeredQuestionIds = new Set(assessment.answers.map((a: IAssessmentAnswer) => a.questionId));
  const questions = (assessment.questions || []).map((q: any) => ({
    id: q.id,
    type: q.type,
    question: q.question,
    isAnswered: answeredQuestionIds.has(q.id),
  }));

  const progress = {
    answered: assessment.answeredCount,
    total: assessment.questionCount,
    percentage: assessment.questionCount ? Math.round((assessment.answeredCount / assessment.questionCount) * 100) : 0,
  };

  return { assessment, progress, questions };
}

export async function resetAssessment(assessmentId: string, userId: string): Promise<IAssessment> {
  const assessment = await Assessment.findById(assessmentId);
  if (!assessment) {
    throw new ApiError(404, 'Assessment not found');
  }
  if (assessment.user.toString() !== userId) {
    throw new ApiError(403, 'Not authorized to reset this assessment');
  }
  assessment.status = 'reset';
  assessment.answeredCount = 0;
  assessment.score = 0;
  assessment.answers = [];
  assessment.currentIndex = 0;
  await assessment.save();
  return assessment;
}

// Helper: generate technical multiple-choice questions based on resume
function generateTechnicalQuestions(resume: any, count: number): Array<{ id: string; type: string; question: string; options: string[]; answer: string; maxMarks: number }> {
  const skills = new Set<string>();
  
  // Extract skills from resume profile and analysis
  if (resume.profile && typeof resume.profile === 'object') {
    const profile = resume.profile as any;
    if (profile.skills && Array.isArray(profile.skills)) {
      profile.skills.forEach((s: string) => skills.add(s.toLowerCase()));
    }
    if (profile.technicalSkills && Array.isArray(profile.technicalSkills)) {
      profile.technicalSkills.forEach((s: string) => skills.add(s.toLowerCase()));
    }
  }
  
  if (resume.analysis && resume.analysis?.findings && Array.isArray(resume.analysis.findings)) {
    resume.analysis.findings.forEach((f: any) => {
      if (f.skill) skills.add(f.skill.toLowerCase());
    });
  }

  // If no skills from resume, use defaults
  if (skills.size === 0) {
    skills.add('javascript');
    skills.add('python');
    skills.add('database');
  }

  const skillList = Array.from(skills);
  const questions: Array<{ id: string; type: string; question: string; options: string[]; answer: string; maxMarks: number }> = [];

  const techQuestions = [
    {
      type: 'multiple_choice',
      template: 'What is the primary purpose of {{skill}} in software development?',
      options: ['User interface creation', 'Data processing and logic', 'Database management only', 'Network configuration'],
      answer: 'Data processing and logic',
    },
    {
      type: 'multiple_choice',
      template: 'Which of the following is a common use case for {{skill}}?',
      options: ['Building web interfaces', 'Running background jobs', 'System administration', 'All of the above'],
      answer: 'All of the above',
    },
    {
      type: 'multiple_choice',
      template: 'In {{skill}}, what does "CRUD" stand for?',
      options: ['Create, Read, Update, Delete', 'Calculate, Read, Update, Delete', 'Create, Read, Upload, Debug', 'Convert, Read, Update, Debug'],
      answer: 'Create, Read, Update, Delete',
    },
    {
      type: 'multiple_choice',
      template: 'Which data structure provides O(1) average time complexity for lookups?',
      options: ['Linked list', 'Array', 'Hash table', 'Binary tree'],
      answer: 'Hash table',
    },
    {
      type: 'multiple_choice',
      template: 'What is the purpose of a database index?',
      options: ['To slow down write operations', 'To speed up read queries', 'To store backup data', 'To enforce uniqueness only'],
      answer: 'To speed up read queries',
    },
    {
      type: 'multiple_choice',
      template: 'Which of the following is NOT a relational database?',
      options: ['PostgreSQL', 'MongoDB', 'MySQL', 'SQLite'],
      answer: 'MongoDB',
    },
    {
      type: 'multiple_choice',
      template: 'What does HTTP GET typically do?',
      options: ['Send data to server', 'Retrieve data from server', 'Update server state', 'Delete resources'],
      answer: 'Retrieve data from server',
    },
    {
      type: 'multiple_choice',
      template: 'Which keyword is used to define a function in JavaScript?',
      options: ['function', 'def', 'lambda', 'fn'],
      answer: 'function',
    },
    {
      type: 'multiple_choice',
      template: 'What is the main advantage of using prepared statements?',
      options: ['Faster execution', 'Prevent SQL injection', 'Better formatting', 'Easier debugging'],
      answer: 'Prevent SQL injection',
    },
    {
      type: 'multiple_choice',
      template: 'Which testing concept ensures code works as expected?',
      options: ['Unit testing', 'Code obfuscation', 'Minification', 'Compilation'],
      answer: 'Unit testing',
    },
  ];

  // Select questions matching available skills, fall back to general tech questions
  let selected = 0;
  for (const q of techQuestions) {
    if (selected >= count) break;
    
    const matchingSkill = skillList.find(skill => 
      q.template.toLowerCase().includes(skill.toLowerCase())
    );
    
    const questionText = q.template.replace('{{skill}}', matchingSkill || skillList[0] || 'technical knowledge');
    
    questions.push({
      id: `q${questions.length + 1}`,
      type: q.type,
      question: questionText,
      options: q.options,
      answer: q.answer,
      maxMarks: 10,
    });
    
    selected++;
  }

  // Fill remaining with general questions if needed
  while (questions.length < count) {
    const generalQ = techQuestions[questions.length % techQuestions.length];
    const questionText = generalQ.template.replace('{{skill}}', skillList[0] || 'technical knowledge');
    
    questions.push({
      id: `q${questions.length + 1}`,
      type: generalQ.type,
      question: questionText,
      options: generalQ.options,
      answer: generalQ.answer,
      maxMarks: 10,
    });
  }

  return questions;
}

// Helper: check if answer is correct based on expected answer
function checkAnswerCorrect(question: any, answerText: string): boolean {
  const lowerAnswer = (answerText || '').toLowerCase().trim();
  const lowerExpected = (question.answer || '').toLowerCase().trim();
  
  // Exact match
  if (lowerAnswer === lowerExpected) return true;
  
  // Contains check for partial correctness
  if (lowerExpected.split(' ').some((word: string) => lowerAnswer.includes(word))) return true;
  
  // Keyword overlap check
  const answerWords = new Set(lowerAnswer.split(' '));
  const expectedWords = new Set(lowerExpected.split(' '));
  const overlap = Array.from(expectedWords).filter((word: unknown) => typeof word === 'string' && answerWords.has(word)).length;
  const matchRatio = expectedWords.size > 0 ? overlap / expectedWords.size : 0;
  
  return matchRatio >= 0.5;
}

export default { startAssessment, submitAssessmentAnswer, getAssessmentStatus, resetAssessment };