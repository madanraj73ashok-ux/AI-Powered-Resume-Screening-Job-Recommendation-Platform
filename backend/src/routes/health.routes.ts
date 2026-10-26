import { Router, Request, Response } from 'express';
import { getDbStatus } from '../db/connection';
import mongoose from 'mongoose';

const router = Router();

router.get('/health', (_req: Request, res: Response) => {
  const db = getDbStatus();
  res.json({
    status: 'ok',
    service: 'verihire-backend',
    db: {
      connected: db.connected,
      engine: db.usingMemory ? 'in-memory (dev fallback)' : 'mongodb',
      mongoState: mongoose.connection.readyState, // 0=disconnected 1=connected 2=connecting 3=disconnecting
    },
    uptimeSeconds: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
  });
});

export default router;
