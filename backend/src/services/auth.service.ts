import { z } from 'zod';
import { User, UserDoc, UserRole, hashPassword } from '../models/User';
import { ApiError } from '../middleware/errors';
import { signToken, AuthUser } from '../middleware/auth';

export const registerSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
  email: z.string().trim().email('Invalid email address').max(254),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .max(128, 'Password must be at most 128 characters'),
  // Admin role can never be self-registered; it is created by the seed script.
  role: z.enum(['candidate', 'recruiter']).default('candidate'),
});

export const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1, 'Password is required'),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;

export interface AuthResult {
  user: Record<string, unknown>;
  token: string;
}

export async function register(input: RegisterInput): Promise<AuthResult> {
  const existing = await User.findOne({ email: input.email.toLowerCase() }).lean();
  if (existing) {
    throw new ApiError(409, 'An account with this email already exists');
  }
  const passwordHash = await hashPassword(input.password);
  const user = await User.create({
    name: input.name,
    email: input.email,
    passwordHash,
    role: input.role satisfies UserRole,
  });
  return { user: user.toPublic(), token: signToken(toAuthUser(user)) };
}

export async function login(input: LoginInput): Promise<AuthResult> {
  const user = await User.findOne({ email: input.email.toLowerCase() }).select('+passwordHash');
  if (!user) {
    throw new ApiError(401, 'Invalid email or password');
  }
  const ok = await user.verifyPassword(input.password);
  if (!ok) {
    throw new ApiError(401, 'Invalid email or password');
  }
  if (!user.isActive) {
    throw new ApiError(403, 'This account has been deactivated');
  }
  user.lastLoginAt = new Date();
  await user.save();
  return { user: user.toPublic(), token: signToken(toAuthUser(user)) };
}

export async function getUserById(id: string): Promise<Record<string, unknown> | null> {
  const user = await User.findById(id);
  if (!user || !user.isActive) return null;
  return user.toPublic();
}

export function toAuthUser(user: UserDoc): AuthUser {
  return {
    id: user._id.toString(),
    role: user.role,
    email: user.email,
    name: user.name,
  };
}
