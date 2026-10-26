import express, { Express } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { env } from './config/env';
import { errorHandler, notFoundHandler } from './middleware/error';
import { authLimiter, apiLimiter } from './middleware/rateLimit';
import authRoutes from './routes/auth.routes';
import healthRoutes from './routes/health.routes';
import adminRoutes from './routes/admin.routes';
import resumeRoutes from './routes/resume.routes';
import interviewRoutes from './routes/interview.routes';
import { assessmentRoutes } from './routes/assessment.routes';

export function createApp(): Express {
  const app = express();

  app.use(helmet());
  app.use(
    cors({
      origin: env.frontendOrigin,
      credentials: true,
    })
  );
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.use('/api', healthRoutes);
  app.use('/api/auth', authLimiter, authRoutes);
  app.use('/api/admin', apiLimiter, adminRoutes);
  app.use('/api/resumes', apiLimiter, resumeRoutes);
  app.use('/api/assessments', apiLimiter, assessmentRoutes);
  app.use('/api/interviews', apiLimiter, interviewRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
