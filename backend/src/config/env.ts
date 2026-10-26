import dotenv from 'dotenv';
import path from 'path';

// Load .env from the backend folder, then fall back to the repo root .env.
dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), '../.env') });

const nodeEnv = process.env.NODE_ENV ?? 'development';

// Some hosts export a generic PORT variable (often 0); ignore invalid values.
function readPort(): number {
  const parsed = Number(process.env.PORT);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : 4000;
}

export const env = {
  nodeEnv,
  isTest: nodeEnv === 'test',
  port: readPort(),
  jwtSecret:
    process.env.JWT_SECRET ?? (nodeEnv === 'production' ? '' : 'dev-only-secret-change-me'),
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '24h',
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173',
  cookieSecure: (process.env.COOKIE_SECURE ?? 'false') === 'true',
  mongodbUri: process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/verihire_ai',
  memoryFallback: (process.env.MONGODB_MEMORY_FALLBACK ?? 'true') !== 'false',
  aiEngineUrl: process.env.AI_ENGINE_URL ?? 'http://127.0.0.1:8000',
  uploadDir: process.env.UPLOAD_DIR ?? 'uploads',
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB ?? 5),
  localEmbeddingsEnabled: (process.env.LOCAL_EMBEDDINGS_ENABLED ?? 'false') === 'true',
};

export function assertEnv(): void {
  if (nodeEnv === 'production' && !process.env.JWT_SECRET) {
    throw new Error('JWT_SECRET must be set when NODE_ENV=production');
  }
}

export default env;
