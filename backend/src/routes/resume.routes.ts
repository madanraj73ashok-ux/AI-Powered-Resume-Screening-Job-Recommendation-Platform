import { Router } from 'express';
import multer from 'multer';
import { requireAuth, requireRole } from '../middleware/auth';
import { ApiError } from '../middleware/errors';
import { env } from '../config/env';
import {
  uploadHandler,
  listHandler,
  detailHandler,
  downloadHandler,
  updateProfileHandler,
  analyzeHandler,
  deleteHandler,
} from '../controllers/resume.controller';

const router = Router();

const ALLOWED_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);

// Files stay in memory here and are written to a private per-user folder by
// the service (never into a publicly served directory).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadMb * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    const name = (file.originalname || '').toLowerCase();
    const extOk = name.endsWith('.pdf') || name.endsWith('.docx');
    // Some clients send a generic MIME type; content is verified by magic
    // bytes in the service layer before the file is accepted.
    const genericMime = !file.mimetype || file.mimetype === 'application/octet-stream';
    const mimeOk = ALLOWED_MIMES.has(file.mimetype) || genericMime;
    if (!extOk || !mimeOk) {
      cb(new ApiError(400, 'Only PDF and DOCX files are accepted.'));
      return;
    }
    cb(null, true);
  },
});

router.use(requireAuth, requireRole('candidate'));

router.post('/', upload.single('file'), uploadHandler);
router.get('/', listHandler);
router.get('/:id', detailHandler);
router.get('/:id/file', downloadHandler);
router.put('/:id', updateProfileHandler);
router.post('/:id/analyze', analyzeHandler);
router.delete('/:id', deleteHandler);

export default router;
