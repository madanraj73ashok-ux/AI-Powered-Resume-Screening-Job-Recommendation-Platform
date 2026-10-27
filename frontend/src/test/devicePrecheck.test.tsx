import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DevicePrecheck } from '../live/DevicePrecheck';
import { getQuestionSpeech } from '../api/liveInterviews';

const mocks = vi.hoisted(() => ({ prepare: vi.fn(), dispose: vi.fn(), play: vi.fn() }));
vi.mock('../live/media', () => ({ InterviewMedia: class {
  prepareAudio = mocks.prepare; dispose = mocks.dispose; play = mocks.play;
} }));
vi.mock('../api/liveInterviews', () => ({ getQuestionSpeech: vi.fn() }));

class TestSocket {
  static instances: TestSocket[] = [];
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;
  close = vi.fn();
  constructor() { TestSocket.instances.push(this); }
}

beforeEach(() => { vi.resetAllMocks(); TestSocket.instances = []; vi.stubGlobal('WebSocket', TestSocket); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

it('does not request speech after a pending speaker test is cancelled', async () => {
  let finish: () => void = () => undefined;
  mocks.prepare.mockImplementation(() => new Promise<void>(resolve => { finish = resolve; }));
  const view = render(<DevicePrecheck id="session" disabled={false} />);
  fireEvent.click(screen.getByRole('button', { name: 'Test interviewer audio' }));
  view.rerender(<DevicePrecheck id="session" disabled />);
  await act(async () => { finish(); });
  expect(getQuestionSpeech).not.toHaveBeenCalled();
  expect(mocks.dispose).toHaveBeenCalled();
});

it('closes an earlier connection check and clears it when joining', () => {
  vi.useFakeTimers();
  const view = render(<DevicePrecheck id="session" disabled={false} />);
  const button = screen.getByRole('button', { name: 'Check audio connection' });
  fireEvent.click(button); fireEvent.click(button);
  expect(TestSocket.instances[0].close).toHaveBeenCalled();
  view.rerender(<DevicePrecheck id="session" disabled />);
  expect(TestSocket.instances[1].close).toHaveBeenCalled();
  act(() => { vi.advanceTimersByTime(11000); });
  expect(screen.queryByText(/Connection timed out/)).not.toBeInTheDocument();
});
