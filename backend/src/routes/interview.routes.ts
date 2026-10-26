import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import {
  validateStart,
  validateAnswer,
  startHandler,
  listHandler,
  detailHandler,
  answerHandler,
  completeHandler,
  resultHandler,
} from '../controllers/interview.controller';

const router = Router();

router.use(requireAuth, requireRole('candidate'));

router.post('/', validateStart, startHandler);
router.get('/', listHandler);
router.get('/:id', detailHandler);
router.post('/:id/answers', validateAnswer, answerHandler);
router.post('/:id/complete', completeHandler);
router.get('/:id/result', resultHandler);

export default router;
