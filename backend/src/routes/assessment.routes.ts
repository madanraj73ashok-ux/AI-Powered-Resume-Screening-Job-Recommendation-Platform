import { Router, Request, Response, NextFunction } from 'express';
import {
  startAssessment,
  submitAssessmentAnswer,
  getAssessmentStatus,
  resetAssessment,
} from '../services/assessment.service';
import { startAssessmentSchema, submitAnswerSchema } from '../services/assessment.service';
import { validateBody } from '../middleware/validate';
import { ApiError } from '../middleware/errors';

function requireUserId(req: Request): string {
  if (!req.user) throw new ApiError(401, 'Authentication required');
  return req.user.id;
}

const router = Router();

// POST /api/assessment/start - start a new assessment test
router.post(
  '/start',
  validateBody(startAssessmentSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = requireUserId(req);
      const { assessment, questions } = await startAssessment(
        userId,
        req.body
      );
      res.status(201).json({ assessment, questions });
    } catch (err) {
      next(err);
    }
  }
);

// POST /api/assessment/:id/answer - submit an answer
router.post(
  '/:id/answer',
  validateBody(submitAnswerSchema),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const userId = requireUserId(req);
      const { assessment, isLast, progress } = await submitAssessmentAnswer(
        req.params.id,
        userId,
        req.body
      );
      res.json({ assessment, isLast, progress });
    } catch (err) {
      next(err);
    }
  }
);

// GET /api/assessment/:id/status - get assessment status and questions
router.get('/:id/status', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = requireUserId(req);
    const { assessment, progress, questions } = await getAssessmentStatus(
      req.params.id,
      userId
    );
    res.json({ assessment, progress, questions });
  } catch (err) {
    next(err);
  }
});

// POST /api/assessment/:id/reset - reset/retake assessment
router.post('/:id/reset', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = requireUserId(req);
    const assessment = await resetAssessment(req.params.id, userId);
    res.json(assessment);
  } catch (err) {
    next(err);
  }
});

export const assessmentRoutes = router;