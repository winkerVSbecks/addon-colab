import { afterEach, describe, expect, it, vi } from 'vitest';

import { CURRENT_STORY_WAS_SET, STORY_MISSING, STORY_RENDERED } from 'storybook/internal/core-events';

import type { ChannelLike } from '../channel';
import { ENTRY_READY_REQUEST, ENTRY_READY_RESPONSE } from '../entry-ready';
import { type EntryPreview, answerEntryReady, prepareEntry, recoverCanvasEntries } from './entry-ready';

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

const STALE = new TypeError('importers[path] is not a function');
const CANVAS = 'colab-canvas-board--canvas';

/** A clock that only moves when `sleep` is called. */
function clock() {
  let time = 0;
  return { now: () => time, sleep: async (ms: number) => void (time += ms) };
}

/** A preview whose loads fail with the given errors in turn, then succeed. */
function preview(failures: unknown[]): EntryPreview & { loads: number } {
  const queue = [...failures];
  const value = {
    loads: 0,
    loadStory: async () => {
      value.loads += 1;
      if (queue.length) throw queue.shift();
      return {};
    },
  };
  return value;
}

afterEach(() => vi.useRealTimers());

describe('prepareEntry', () => {
  it('is ready at once when the entry loads', async () => {
    const target = preview([]);
    const reload = vi.fn(async () => true);
    await expect(prepareEntry(CANVAS, 5000, { getPreview: () => target, reload, ...clock() })).resolves.toBe(true);
    expect(target.loads).toBe(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it('refreshes a stale map of story files and loads again', async () => {
    const target = preview([STALE, STALE]);
    const reload = vi.fn(async () => true);
    await expect(prepareEntry(CANVAS, 5000, { getPreview: () => target, reload, ...clock() })).resolves.toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
    expect(target.loads).toBe(3);
  });

  it('retries other failures (index not updated yet) without refreshing the map', async () => {
    const target = preview([new Error("Couldn't find story matching id")]);
    const reload = vi.fn(async () => true);
    await expect(prepareEntry(CANVAS, 5000, { getPreview: () => target, reload, ...clock() })).resolves.toBe(true);
    expect(reload).not.toHaveBeenCalled();
  });

  it('gives up after its budget', async () => {
    const target = preview(Array.from({ length: 1000 }, () => STALE));
    const reload = vi.fn(async () => false);
    await expect(prepareEntry(CANVAS, 1000, { getPreview: () => target, reload, ...clock() })).resolves.toBe(false);
    expect(target.loads).toBeLessThan(20);
  });

  it('waits for the preview to exist, then gives up if it never does', async () => {
    await expect(prepareEntry(CANVAS, 600, { getPreview: () => undefined, ...clock() })).resolves.toBe(false);
  });
});

describe('answerEntryReady', () => {
  it('answers each request with its id', async () => {
    const { channel, emitted } = fakeChannel();
    const target = preview([STALE]);
    answerEntryReady(channel, { getPreview: () => target, reload: async () => true, ...clock() });
    channel.emit(ENTRY_READY_REQUEST, { id: 'r1', storyId: CANVAS });
    channel.emit(ENTRY_READY_REQUEST, { nonsense: true });
    await vi.waitFor(() => expect(emitted.filter((e) => e.event === ENTRY_READY_RESPONSE)).toHaveLength(1));
    expect(emitted.find((e) => e.event === ENTRY_READY_RESPONSE)!.args[0]).toEqual({ id: 'r1', ready: true });
  });

  it('stops answering when stopped', () => {
    const { channel, count } = fakeChannel();
    const stop = answerEntryReady(channel);
    stop();
    expect(count(ENTRY_READY_REQUEST)).toBe(0);
  });
});

describe('recoverCanvasEntries', () => {
  function setup(delays = [100, 200, 400]) {
    vi.useFakeTimers();
    const { channel, count } = fakeChannel();
    const reload = vi.fn(async () => true);
    const stop = recoverCanvasEntries(channel, { getPreview: () => preview([]), reload, delays });
    return { channel, count, reload, stop };
  }

  it('refreshes the map after a canvas entry is reported missing', () => {
    const { channel, reload } = setup();
    channel.emit(STORY_MISSING, CANVAS);
    vi.advanceTimersByTime(99);
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('ignores stories that are not canvases, and reports without an id', () => {
    const { channel, reload } = setup();
    channel.emit(STORY_MISSING, 'example-button--primary');
    channel.emit(STORY_MISSING);
    vi.advanceTimersByTime(10_000);
    expect(reload).not.toHaveBeenCalled();
  });

  it('tries a bounded number of times for an entry that stays missing', () => {
    const { channel, reload } = setup();
    for (let i = 0; i < 10; i++) {
      channel.emit(STORY_MISSING, CANVAS);
      vi.advanceTimersByTime(1000);
    }
    expect(reload).toHaveBeenCalledTimes(3);
  });

  it('does not stack attempts when Storybook reports the same entry twice', () => {
    const { channel, reload } = setup();
    channel.emit(STORY_MISSING, CANVAS);
    channel.emit(STORY_MISSING, CANVAS);
    vi.advanceTimersByTime(1000);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('stops once the entry renders or another entry is selected', () => {
    const { channel, reload } = setup();
    channel.emit(STORY_MISSING, CANVAS);
    channel.emit(STORY_RENDERED, CANVAS);
    vi.advanceTimersByTime(1000);
    channel.emit(STORY_MISSING, CANVAS);
    channel.emit(CURRENT_STORY_WAS_SET, { storyId: 'example-button--primary', viewMode: 'story' });
    vi.advanceTimersByTime(1000);
    expect(reload).not.toHaveBeenCalled();
  });

  it('removes its listeners and timer when stopped', () => {
    const { channel, count, reload, stop } = setup();
    channel.emit(STORY_MISSING, CANVAS);
    stop();
    vi.advanceTimersByTime(1000);
    expect(reload).not.toHaveBeenCalled();
    expect(count(STORY_MISSING) + count(STORY_RENDERED) + count(CURRENT_STORY_WAS_SET)).toBe(0);
  });
});
