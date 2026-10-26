import { Router, Request, Response, NextFunction } from 'express';
import { User } from '../models/User';
import { requireAuth, requireRole } from '../middleware/auth';

const router = Router();

/**
 * GET /api/admin/users - list all users (admin only).
 * Never returns password hashes (User toJSON strips them).
 */
router.get(
  '/users',
  requireAuth,
  requireRole('admin'),
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const users = await User.find().sort({ createdAt: -1 }).limit(500);
      res.json({ users: users.map((u) => u.toPublic()) });
    } catch (err) {
      next(err);
    }
  }
);

export default router;
