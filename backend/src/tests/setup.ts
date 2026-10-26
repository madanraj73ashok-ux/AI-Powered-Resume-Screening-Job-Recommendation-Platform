import { beforeAll, afterAll, afterEach } from 'vitest';
import mongoose from 'mongoose';
import { User } from '../models/User';

beforeAll(async () => {
  const uri = process.env.MONGODB_URI;
  if (!uri) throw new Error('MONGODB_URI missing - globalSetup did not run');
  // Safety guard: tests may only ever touch a database whose name contains "test".
  if (!uri.includes('test')) {
    throw new Error(`Refusing to run tests against non-test database: ${uri}`);
  }
  if (mongoose.connection.readyState !== 1) {
    await mongoose.connect(uri);
    // Start each test file from a clean slate.
    await mongoose.connection.dropDatabase();
  }
});

afterAll(async () => {
  if (mongoose.connection.readyState === 1) {
    await mongoose.disconnect();
  }
});

// Each test file starts with a clean users collection.
afterEach(async () => {
  await User.deleteMany({});
});
