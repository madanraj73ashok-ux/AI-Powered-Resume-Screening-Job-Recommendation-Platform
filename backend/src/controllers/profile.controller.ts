import { Request, Response, NextFunction } from 'express';
import {
  updateProfileSchema,
  changePasswordSchema,
  updateProfile,
  changePassword,
} from '../services/profile.service';
import { validateBody } from '../middleware/validate';
import { ApiError } from '../middleware/errors';

export const validateUpdateProfile = validateBody(updateProfileSchema);
export const validateChangePassword = validateBody(changePasswordSchema);

export async function updateProfileHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    if (!req.user) throw new ApiError(401, 'Authentication required');
    const user = await updateProfile(req.user.id, req.body);
    res.json({ user });
  } catch (err) {
    next(err);
  }
}

export async function changePasswordHandler(
  req: Request,
  res: Response,
  next: NextFunction
) {
  try {
    if (!req.user) throw new ApiError(401, 'Authentication required');
    await changePassword(req.user.id, req.body);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
}
