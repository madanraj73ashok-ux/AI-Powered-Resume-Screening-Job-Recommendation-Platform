import { createApp } from './app';
import { env, assertEnv } from './config/env';
import { connectDB, disconnectDB } from './db/connection';

async function main(): Promise<void> {
  assertEnv();
  const db = await connectDB();
  console.log(
    `[db] connected (${db.usingMemory ? 'in-memory fallback' : 'mongodb://…/verihire'})`
  );

  const app = createApp();
  const server = app.listen(env.port, () => {
    console.log(`[verihire] API listening on http://localhost:${env.port}/api/health`);
    console.log(`[verihire] CORS origin: ${env.frontendOrigin}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`\n${signal} received, shutting down...`);
    server.close(async () => {
      await disconnectDB();
      process.exit(0);
    });
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('[verihire] fatal startup error:', err);
  process.exit(1);
});
