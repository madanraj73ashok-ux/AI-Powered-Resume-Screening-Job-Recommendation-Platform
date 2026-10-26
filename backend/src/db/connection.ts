import mongoose from 'mongoose';
import { env } from '../config/env';

let memoryServer: { stop: () => Promise<boolean> } | null = null;
let usingMemory = false;

export interface DbStatus {
  connected: boolean;
  usingMemory: boolean;
}

const status: DbStatus = { connected: false, usingMemory: false };

/**
 * Connect to MongoDB. If the configured server is unreachable and
 * MONGODB_MEMORY_FALLBACK is enabled (default in development), start a local
 * in-memory MongoDB instead so the app remains runnable without Docker or a
 * system-wide MongoDB install.
 */
export async function connectDB(): Promise<DbStatus> {
  if (status.connected) return status;
  try {
    await mongoose.connect(env.mongodbUri, { serverSelectionTimeoutMS: 4000 });
    status.connected = true;
    status.usingMemory = false;
    return status;
  } catch (err) {
    if (!env.memoryFallback || env.isTest) throw err;
    console.warn(
      `[db] MongoDB not reachable at ${env.mongodbUri}; starting in-memory fallback DB. ` +
        'Data will NOT persist after restart. Set MONGODB_URI to a real MongoDB for persistence.'
    );
    const { MongoMemoryServer } = await import('mongodb-memory-server');
    const server = await MongoMemoryServer.create();
    memoryServer = server;
    await mongoose.connect(server.getUri('verihire'));
    status.connected = true;
    status.usingMemory = true;
    return status;
  }
}

export async function disconnectDB(): Promise<void> {
  await mongoose.disconnect();
  if (memoryServer) {
    await memoryServer.stop();
    memoryServer = null;
  }
  status.connected = false;
  status.usingMemory = false;
}

export function getDbStatus(): DbStatus {
  return { ...status, connected: mongoose.connection.readyState === 1 };
}
