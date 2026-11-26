import { describe, expect, it, vi } from 'vitest';

import type { ChannelLike } from './channel';
import { ENTRY_READY_REQUEST, ENTRY_READY_RESPONSE, waitForEntryReady } from './entry-ready';

type Listener = (...args: unknown[]) => void;

function fakeChannel() {
  const listeners = new Map<string, Set<Listener>>();
  const emitted: { event: string; args: unknown[] }[] = [];
  const channel = {
    on: (event: string, listener: Listener) =>
      void (listeners.get(event) ?? listeners.set(event, new Set()).get(event)!).add(listener),
    off: (event: string, listener: Listener) => void listeners.get(event)?.delete(listener),
    emit: (event: string, ...args: unknown[]) => {
      emitted.push({ event, args });
      for (const listener of [...(listeners.get(event) ?? [])]) listener(...args);
    },
  };
  return {
    channel: channel as unknown as ChannelLike,
    emitted,
    count: (event: string) => listeners.get(event)?.size ?? 0,
  };
}

describe('waitForEntryReady', () => {
  it('sends the story id and resolves with the answer to its own request only', async () => {
    const { channel, emitted, count } = fakeChannel();
    const answer = waitForEntryReady(channel, 'colab-canvas-a--canvas');
    const request = emitted.find((e) => e.event === ENTRY_READY_REQUEST)!.args[0] as { id: string; storyId: string };
    expect(request.storyId).toBe('colab-canvas-a--canvas');
    channel.emit(ENTRY_READY_RESPONSE, { id: 'someone-else', ready: false });
    channel.emit(ENTRY_READY_RESPONSE, { id: request.id, ready: true });
    await expect(answer).resolves.toBe(true);
    expect(count(ENTRY_READY_RESPONSE)).toBe(0);
  });

  it('resolves false when the preview gave up', async () => {
    const { channel, emitted } = fakeChannel();
    const answer = waitForEntryReady(channel, 'colab-canvas-a--canvas');
    const { id } = emitted[0]!.args[0] as { id: string };
    channel.emit(ENTRY_READY_RESPONSE, { id, ready: false });
    await expect(answer).resolves.toBe(false);
  });

  it('resolves undefined without an answer, and stops listening', async () => {
    vi.useFakeTimers();
    try {
      const { channel, count } = fakeChannel();
      const answer = waitForEntryReady(channel, 'colab-canvas-a--canvas', { timeoutMs: 1000 });
      vi.advanceTimersByTime(1000);
      await expect(answer).resolves.toBeUndefined();
      expect(count(ENTRY_READY_RESPONSE)).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resolves undefined when the request cannot be sent', async () => {
    const { channel } = fakeChannel();
    const broken = {
      ...channel,
      emit: () => {
        throw new Error('no transport');
      },
    } as unknown as ChannelLike;
    await expect(waitForEntryReady(broken, 'colab-canvas-a--canvas')).resolves.toBeUndefined();
  });
});
