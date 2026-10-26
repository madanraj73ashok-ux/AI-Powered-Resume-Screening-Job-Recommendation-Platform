import net from 'net';
import path from 'path';
import { MongoMemoryServer } from 'mongodb-memory-server';

let mongod: MongoMemoryServer | null = null;

function canConnect(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port });
    const finish = (ok: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
    socket.once('timeout', () => finish(false));
  });
}

/**
 * Test database resolution:
 *  1. If a real MongoDB is already running (local dev machine, CI service),
 *     use it with the dedicated `verihire_test` database.
 *  2. Otherwise start an in-memory MongoDB (downloaded once, cached in
 *     backend/.cache/mongodb-binaries).
 * The resolved URI is handed to every worker via process.env.
 */
export async function setup(): Promise<void> {
  const host = '127.0.0.1';
  const port = 27017;
  const reachable = await canConnect(host, port, 1500);

  if (reachable) {
    process.env.MONGODB_URI = `mongodb://${host}:${port}/verihire_test`;
  } else {
    process.env.MONGOMS_DOWNLOAD_DIR = path.resolve(
      __dirname,
      '../../.cache/mongodb-binaries'
    );
    mongod = await MongoMemoryServer.create({
      instance: { launchTimeout: 120000 },
    });
    process.env.MONGODB_URI = mongod.getUri('verihire_test');
  }

  process.env.MONGODB_MEMORY_FALLBACK = 'false';
  process.env.NODE_ENV = 'test';
}

export async function teardown(): Promise<void> {
  if (mongod) {
    await mongod.stop();
    mongod = null;
  }
}
