import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import {
  applicationUpdateSchema,
  listApplicationsHandler,
  updateApplicationHandler,
} from '../controllers/job.controller';

const router = Router();

router.use(requireAuth, requireRole('candidate'));

router.get('/', listApplicationsHandler);
router.patch('/:id', validateBody(applicationUpdateSchema), updateApplicationHandler);

export default router;
