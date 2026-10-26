import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';
import { User } from '../models/User';

const app = createApp();

const uniqueEmail = (prefix: string) => `${prefix}-${Date.now()}@test.local`;

describe('POST /api/auth/register', () => {
  it('creates a candidate and returns a session cookie', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'Test Candidate',
      email: uniqueEmail('cand'),
      password: 'Passw0rd!x',
      role: 'candidate',
    });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('candidate');
    expect(res.body.user.email).toBeDefined();
    expect(res.body.user.passwordHash).toBeUndefined();
    const cookie = ((res.headers['set-cookie'] as unknown as string[]) ?? []).join(';');
    expect(cookie).toContain('vh_token');
    expect(cookie).toContain('HttpOnly');
  });

  it('hashes the password (never stores plaintext)', async () => {
    const email = uniqueEmail('hash');
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Hash Check', email, password: 'Sup3rSecret!', role: 'candidate' });
    expect(res.status).toBe(201);
    const user = await User.findOne({ email }).select('+passwordHash');
    expect(user).not.toBeNull();
    expect(user!.passwordHash).not.toBe('Sup3rSecret!');
    expect(user!.passwordHash.startsWith('$2')).toBe(true);
  });

  it('rejects duplicate email with 409', async () => {
    const email = uniqueEmail('dup');
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'First User', email, password: 'Passw0rd!x' });
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Second User', email, password: 'Passw0rd!x' });
    expect(res.status).toBe(409);
  });

  it('rejects weak password and invalid email with 400', async () => {
    const weak = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Weak', email: uniqueEmail('weak'), password: 'short' });
    expect(weak.status).toBe(400);

    const badEmail = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Bad Email', email: 'not-an-email', password: 'Passw0rd!x' });
    expect(badEmail.status).toBe(400);
  });

  it('cannot self-register as admin', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'Sneaky Admin',
      email: uniqueEmail('sneaky'),
      password: 'Passw0rd!x',
      role: 'admin',
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /api/auth/login', () => {
  it('logs in with correct credentials', async () => {
    const email = uniqueEmail('login');
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Login User', email, password: 'Passw0rd!x' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'Passw0rd!x' });
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email.toLowerCase());
    expect(((res.headers['set-cookie'] as unknown as string[]) ?? []).join(';')).toContain(
      'vh_token'
    );
  });

  it('rejects wrong password with 401 and a generic message', async () => {
    const email = uniqueEmail('wrongpw');
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Wrong PW', email, password: 'Passw0rd!x' });

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'WrongPass1!' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });

  it('rejects unknown email with 401', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: uniqueEmail('ghost'), password: 'Whatever1!' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('Invalid email or password');
  });
});

describe('GET /api/auth/me and logout', () => {
  it('returns the current user with a valid session', async () => {
    const agent = request.agent(app);
    const email = uniqueEmail('me');
    await agent
      .post('/api/auth/register')
      .send({ name: 'Me User', email, password: 'Passw0rd!x' });

    const res = await agent.get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email.toLowerCase());
  });

  it('rejects requests without a session (401)', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('rejects tampered tokens (401)', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer not.a.real.token');
    expect(res.status).toBe(401);
  });

  it('logout clears the session', async () => {
    const agent = request.agent(app);
    const email = uniqueEmail('out');
    await agent
      .post('/api/auth/register')
      .send({ name: 'Out User', email, password: 'Passw0rd!x' });

    await agent.post('/api/auth/logout');
    const res = await agent.get('/api/auth/me');
    expect(res.status).toBe(401);
  });
});
