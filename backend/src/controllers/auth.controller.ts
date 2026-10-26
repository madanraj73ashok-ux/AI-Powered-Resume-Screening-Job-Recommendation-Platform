import { Request, Response, NextFunction } from 'express';
import { env } from '../config/env';
import {
  register,
  login,
  registerSchema,
  loginSchema,
  getUserById,
} from '../services/auth.service';
import { validateBody } from '../middleware/validate';
import { ApiError } from '../middleware/errors';

const COOKIE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24h, matches JWT expiry

function setSessionCookie(res: Response, token: string): void {
  res.cookie('vh_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: env.cookieSecure,
    maxAge: COOKIE_MAX_AGE_MS,
    path: '/',
  });
}

export const validateRegister = validateBody(registerSchema);
export const validateLogin = validateBody(loginSchema);

export async function registerHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await register(req.body);
    setSessionCookie(res, result.token);
    res.status(201).json({ user: result.user });
  } catch (err) {
    next(err);
  }
}

export async function loginHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await login(req.body);
    setSessionCookie(res, result.token);
    res.json({ user: result.user });
  } catch (err) {
    next(err);
  }
}

export function logoutHandler(_req: Request, res: Response): void {
  res.clearCookie('vh_token', { path: '/' });
  res.json({ ok: true });
}

export async function meHandler(req: Request, res: Response, next: NextFunction) {
  try {
    if (!req.user) throw new ApiError(401, 'Authentication required');
    const user = await getUserById(req.user.id);
    if (!user) throw new ApiError(401, 'Session no longer valid');
    res.json({ user });
  } catch (err) {
    next(err);
  }
}
