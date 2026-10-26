import { Request, Response, NextFunction } from 'express';
import { ApiError } from './errors';

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Route not found' });
}

// Central error handler. Never leaks stack traces or secrets to clients.
export function errorHandler(
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction
): void {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  const e = err as { name?: string; code?: number; message?: string };
  if (e?.name === 'ZodError') {
    res.status(400).json({ error: 'Validation failed', details: err });
    return;
  }
  if (e?.name === 'ValidationError') {
    res.status(400).json({ error: 'Validation failed', details: e.message });
    return;
  }
  if (e?.code === 11000) {
    res.status(409).json({ error: 'Duplicate value' });
    return;
  }
  if (e?.name === 'CastError') {
    res.status(404).json({ error: 'Not found' });
    return;
  }
  if (e?.name === 'MulterError') {
    res.status(400).json({ error: `Upload error: ${e.message}` });
    return;
  }
  console.error('[error]', err);
  res.status(500).json({ error: 'Internal server error' });
}
