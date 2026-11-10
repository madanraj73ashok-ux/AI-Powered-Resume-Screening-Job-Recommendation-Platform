import { Router } from 'express';
import { requireAuth, requireRole } from '../middleware/auth';
import { validateBody } from '../middleware/validate';
import {
  applicationSchema,
  createApplicationHandler,
  getMatchesHandler,
  getRolesHandler,
  getSourcesHandler,
  listSavedHandler,
  preferencesSchema,
  refreshHandler,
  refreshSchema,
  saveJobHandler,
  setPreferencesHandler,
  unsaveJobHandler,
} from '../controllers/job.controller';

const router = Router();

// Job discovery, matching, saving and application tracking are candidate-only.
router.use(requireAuth, requireRole('candidate'));

router.get('/matches', getMatchesHandler);
router.get('/roles', getRolesHandler);
router.get('/sources', getSourcesHandler);
router.post('/refresh', validateBody(refreshSchema), refreshHandler);
router.put('/preferences', validateBody(preferencesSchema), setPreferencesHandler);
router.get('/saved', listSavedHandler);
router.post('/:jobId/save', saveJobHandler);
router.delete('/:jobId/save', unsaveJobHandler);
router.post('/:jobId/applications', validateBody(applicationSchema), createApplicationHandler);

export default router;
