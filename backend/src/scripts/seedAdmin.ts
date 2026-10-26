/**
 * Seeds the administrator account.
 * Usage: npm --prefix backend run seed:admin
 * Credentials come from ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME (.env).
 */
import { connectDB, disconnectDB } from '../db/connection';
import { User, hashPassword } from '../models/User';
import { env } from '../config/env';

async function seedAdmin(): Promise<void> {
  await connectDB();
  const email = process.env.ADMIN_EMAIL ?? 'admin@verihire.local';
  const password = process.env.ADMIN_PASSWORD ?? 'Admin123!ChangeMe';
  const name = process.env.ADMIN_NAME ?? 'VeriHire Administrator';

  const existing = await User.findOne({ email: email.toLowerCase() });
  if (existing) {
    if (existing.role !== 'admin') {
      existing.role = 'admin';
      await existing.save();
      console.log(`[seed] existing user ${email} promoted to admin`);
    } else {
      console.log(`[seed] admin already exists: ${email}`);
    }
  } else {
    await User.create({
      name,
      email,
      passwordHash: await hashPassword(password),
      role: 'admin',
    });
    console.log(`[seed] created admin: ${email}`);
    if (password === 'Admin123!ChangeMe') {
      console.warn('[seed] WARNING: using the default admin password. Change ADMIN_PASSWORD.');
    }
  }
  if (env.nodeEnv === 'production' && password === 'Admin123!ChangeMe') {
    console.warn('[seed] WARNING: default admin password in production is unsafe.');
  }
  await disconnectDB();
}

seedAdmin().catch((err) => {
  console.error('[seed] failed:', err);
  process.exit(1);
});
