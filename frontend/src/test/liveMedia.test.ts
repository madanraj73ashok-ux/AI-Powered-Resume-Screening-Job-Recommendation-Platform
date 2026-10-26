import { afterEach, expect, it, vi } from 'vitest';
import { InterviewMedia } from '../live/media';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('times out unanswered microphone prompts and stops a late stream', async () => {
  vi.useFakeTimers();
  const stop = vi.fn();
  let grant: (stream: MediaStream) => void = () => undefined;
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
    getUserMedia: vi.fn(() => new Promise<MediaStream>(resolve => { grant = resolve; })),
  } });
  vi.stubGlobal('AudioContext', class { resume = vi.fn(async () => undefined); close = vi.fn(async () => undefined); });
  const media = new InterviewMedia(vi.fn(), vi.fn());
  const opening = media.open();
  const rejected = expect(opening).rejects.toThrow('Microphone permission timed out');
  await vi.advanceTimersByTimeAsync(15000); await rejected;
  grant({ getTracks: () => [{ stop }] } as unknown as MediaStream);
  await Promise.resolve();
  expect(stop).toHaveBeenCalled(); media.dispose();
});
