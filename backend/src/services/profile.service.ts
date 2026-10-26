import { z } from 'zod';
import { User } from '../models/User';
import { ApiError } from '../middleware/errors';
import { hashPassword } from '../models/User';

export const updateProfileSchema = z.object({
  name: z.string().trim().min(2, 'Name must be at least 2 characters').max(80),
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z
    .string()
    .min(8, 'New password must be at least 8 characters')
    .max(128),
});

export async function updateProfile(
  userId: string,
  input: { name: string }
): Promise<Record<string, unknown>> {
  const user = await User.findById(userId);
  if (!user) throw new ApiError(404, 'User not found');
  user.name = input.name;
  await user.save();
  return user.toPublic();
}

export async function changePassword(
  userId: string,
  input: { currentPassword: string; newPassword: string }
): Promise<void> {
  const user = await User.findById(userId).select('+passwordHash');
  if (!user) throw new ApiError(404, 'User not found');
  const ok = await user.verifyPassword(input.currentPassword);
  if (!ok) throw new ApiError(400, 'Current password is incorrect');
  user.passwordHash = await hashPassword(input.newPassword);
  await user.save();
}
