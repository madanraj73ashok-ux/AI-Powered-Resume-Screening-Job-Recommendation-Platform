import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createApp } from '../app';

const app = createApp();

describe('GET /api/health', () => {
  it('reports service and database status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('verihire-backend');
    expect(res.body.db.connected).toBe(true);
    expect(typeof res.body.uptimeSeconds).toBe('number');
  });
});
