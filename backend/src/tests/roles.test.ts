import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { User, hashPassword } from '../models/User';

const app = createApp();
const uniqueEmail = (prefix: string) => `${prefix}-${Date.now()}@test.local`;

let adminEmail = '';

beforeAll(async () => {
  adminEmail = uniqueEmail('admin');
  await User.create({
    name: 'Admin User',
    email: adminEmail,
    passwordHash: await hashPassword('AdminPass1!'),
    role: 'admin',
  });
});

async function registerAgent(prefix: string) {
  const agent = request.agent(app);
  const email = uniqueEmail(prefix);
  const res = await agent.post('/api/auth/register').send({
    name: `${prefix} user`,
    email,
    password: 'Passw0rd!x',
    role: prefix === 'rec' ? 'recruiter' : 'candidate',
  });
  expect(res.status).toBe(201);
  return agent;
}

describe('role-based authorization (GET /api/admin/users)', () => {
  it('allows admins', async () => {
    const agent = request.agent(app);
    const login = await agent
      .post('/api/auth/login')
      .send({ email: adminEmail, password: 'AdminPass1!' });
    expect(login.status).toBe(200);

    const res = await agent.get('/api/admin/users');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.users)).toBe(true);
    expect(res.body.users.length).toBeGreaterThan(0);
    // No password hashes ever leave the server.
    for (const u of res.body.users) {
      expect(u.passwordHash).toBeUndefined();
    }
  });

  it('forbids candidates', async () => {
    const agent = await registerAgent('cand');
    const res = await agent.get('/api/admin/users');
    expect(res.status).toBe(403);
  });

  it('forbids recruiters', async () => {
    const agent = await registerAgent('rec');
    const res = await agent.get('/api/admin/users');
    expect(res.status).toBe(403);
  });

  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(401);
  });
});
