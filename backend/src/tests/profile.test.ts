import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();
const uniqueEmail = (prefix: string) => `${prefix}-${Date.now()}@test.local`;

async function registerAgent() {
  const agent = request.agent(app);
  const email = uniqueEmail('prof');
  const res = await agent.post('/api/auth/register').send({
    name: 'Profile User',
    email,
    password: 'Passw0rd!x',
    role: 'candidate',
  });
  expect(res.status).toBe(201);
  return { agent, email };
}

describe('PUT /api/auth/profile', () => {
  it('updates the display name', async () => {
    const { agent } = await registerAgent();
    const res = await agent.put('/api/auth/profile').send({ name: 'Updated Name' });
    expect(res.status).toBe(200);
    expect(res.body.user.name).toBe('Updated Name');

    const me = await agent.get('/api/auth/me');
    expect(me.body.user.name).toBe('Updated Name');
  });

  it('rejects a too-short name', async () => {
    const { agent } = await registerAgent();
    const res = await agent.put('/api/auth/profile').send({ name: 'x' });
    expect(res.status).toBe(400);
  });

  it('requires authentication', async () => {
    const res = await request(app).put('/api/auth/profile').send({ name: 'Nope' });
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/change-password', () => {
  it('changes the password when the current one is correct', async () => {
    const { agent, email } = await registerAgent();
    const res = await agent
      .post('/api/auth/change-password')
      .send({ currentPassword: 'Passw0rd!x', newPassword: 'NewPassw0rd1!' });
    expect(res.status).toBe(200);

    // Old password no longer works; new one does.
    const old = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'Passw0rd!x' });
    expect(old.status).toBe(401);
    const fresh = request.agent(app);
    const ok = await fresh
      .post('/api/auth/login')
      .send({ email, password: 'NewPassw0rd1!' });
    expect(ok.status).toBe(200);
  });

  it('rejects an incorrect current password', async () => {
    const { agent } = await registerAgent();
    const res = await agent
      .post('/api/auth/change-password')
      .send({ currentPassword: 'WrongOld1!', newPassword: 'NewPassw0rd1!' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Current password is incorrect');
  });
});
