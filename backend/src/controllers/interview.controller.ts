import { Request, Response, NextFunction } from 'express';
import * as interviewService from '../services/interview.service';
import { validateBody } from '../middleware/validate';
import {
  startInterviewSchema,
  submitAnswerSchema,
} from '../services/interview.service';
import { ApiError } from '../middleware/errors';

export const validateStart = validateBody(startInterviewSchema);
export const validateAnswer = validateBody(submitAnswerSchema);

function requireUserId(req: Request): string {
  if (!req.user) throw new ApiError(401, 'Authentication required');
  return req.user.id;
}

export async function startHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const session = await interviewService.startInterview(requireUserId(req), req.body);
    const described = interviewService.describeSession(session);
    res.status(201).json(described);
  } catch (err) {
    next(err);
  }
}

export async function listHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const sessions = await interviewService.listSessions(requireUserId(req));
    res.json({
      sessions: sessions.map((s) => ({
        id: s.id,
        resume: s.resume,
        difficulty: s.difficulty,
        status: s.status,
        totalQuestions: s.questions.length,
        answered: s.answers.length,
        currentIndex: s.currentIndex,
        startedAt: s.startedAt,
        completedAt: s.completedAt,
        score:
          s.status === 'completed'
            ? Math.round(
                (s.answers.reduce((sum, a) => sum + a.marksAwarded, 0) /
                  Math.max(
                    1,
                    s.questions.reduce((sum, q) => sum + q.maxMarks, 0)
                  )) *
                  100
              )
            : null,
      })),
    });
  } catch (err) {
    next(err);
  }
}

export async function detailHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const session = await interviewService.getSessionOwned(
      req.params.id,
      requireUserId(req)
    );
    res.json(interviewService.describeSession(session));
  } catch (err) {
    next(err);
  }
}

export async function answerHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await interviewService.submitAnswer(
      req.params.id,
      requireUserId(req),
      req.body
    );
    res.json({
      evaluation: result.evaluation,
      nextQuestion: result.nextQuestion,
      isLastQuestion: result.isLastQuestion,
      progress: {
        answered: result.session.answers.length,
        total: result.session.questions.length,
        percentage: result.session.questions.length
          ? Math.round(
              (result.session.answers.length / result.session.questions.length) * 100
            )
          : 0,
      },
    });
  } catch (err) {
    next(err);
  }
}

export async function completeHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const { session, result } = await interviewService.completeInterview(
      req.params.id,
      requireUserId(req)
    );
    res.json({ result, session: { id: session.id, status: session.status } });
  } catch (err) {
    next(err);
  }
}

export async function resultHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await interviewService.getResultOwned(
      req.params.id,
      requireUserId(req)
    );
    res.json({ result });
  } catch (err) {
    next(err);
  }
}
