import { Request, Response, NextFunction } from 'express';
import { ApiError } from './errors';
import { env } from '../config/env';
import jwt from 'jsonwebtoken';
import { UserRole } from '../models/User';

export interface AuthUser {
  id: string;
  role: UserRole;
  email: string;
  name: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export function signToken(user: AuthUser): string {
  return jwt.sign(
    { sub: user.id, role: user.role, email: user.email, name: user.name },
    env.jwtSecret,
    { expiresIn: env.jwtExpiresIn as jwt.SignOptions['expiresIn'] }
  );
}

/** Require a valid JWT (cookie or Authorization header). */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const bearer = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
  const token = req.cookies?.vh_token ?? bearer;
  if (!token) {
    next(new ApiError(401, 'Authentication required'));
    return;
  }
  try {
    const payload = jwt.verify(token, env.jwtSecret) as jwt.JwtPayload;
    if (!payload.sub || !payload.role) throw new Error('invalid payload');
    req.user = {
      id: String(payload.sub),
      role: payload.role as UserRole,
      email: String(payload.email ?? ''),
      name: String(payload.name ?? ''),
    };
    next();
  } catch {
    next(new ApiError(401, 'Invalid or expired session'));
  }
}

/** Require one of the given roles (must follow requireAuth). */
export function requireRole(...roles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      next(new ApiError(401, 'Authentication required'));
      return;
    }
    if (!roles.includes(req.user.role)) {
      next(new ApiError(403, 'You do not have permission to perform this action'));
      return;
    }
    next();
  };
}
