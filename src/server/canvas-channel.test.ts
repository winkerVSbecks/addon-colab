import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Channel } from 'storybook/internal/channels';
import type { Options } from 'storybook/internal/types';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { serializeCanvasFile } from '../canvas-file';
import {
  CANVAS_REQUEST,
  CANVAS_RESPONSE,
  type CanvasChangeEvent,
  CanvasRequestError,
  type CanvasResponse,
  type CanvasResponseBody,
  decodeCanvasMessage,
  encodeCanvasMessage,
  onCanvasChanged,
  requestCanvas,
} from '../channel';
import { canvasDirFor, experimental_serverChannel } from '../preset';
import { registerCanvasChannel } from './canvas-channel';
import { type CanvasStore, createCanvasStore, getCanvasStore } from './canvas-store';

let dir: string;
let store: CanvasStore;
let channel: Channel;
let unregister: () => void;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'colab-channel-'));
  store = createCanvasStore({ dir });
  // A Storybook channel without a transport delivers emits to its own listeners, so the
  // server handler and the browser-side helper can talk through one instance.
  channel = new Channel({});
  unregister = registerCanvasChannel(channel, store);
});

afterEach(async () => {
  unregister();
  await store.close();
  await rm(dir, { recursive: true, force: true });
});

function changes() {
  const events: CanvasChangeEvent[] = [];
  onCanvasChanged(channel, (event) => events.push(event));
  return events;
}

describe('requestCanvas over the channel', () => {
  it('runs store operations and returns their results', async () => {
    const created = await requestCanvas(channel, 'create', { name: 'Board' });
    expect(created).toMatchObject({ id: 'board', name: 'Board' });
    const { frame } = await requestCanvas(channel, 'addFrame', {
      canvasId: 'board',
      frame: { storyId: 'example-button--primary', x: 1, y: 2, width: 3 },
    });
    expect(await requestCanvas(channel, 'get', { id: 'board' })).toMatchObject({ frames: [frame] });
    expect((await requestCanvas(channel, 'list')).canvases.map((c) => c.id)).toEqual(['board']);
  });

  it('rejects with the store error code and details', async () => {
    const notFound = await requestCanvas(channel, 'get', { id: 'missing' }).catch((e: unknown) => e);
    expect(notFound).toBeInstanceOf(CanvasRequestError);
    expect(notFound).toMatchObject({ code: 'NOT_FOUND', message: 'No canvas "missing"' });

    await writeFile(join(dir, 'broken.json'), '{');
    const invalid = await requestCanvas(channel, 'rename', { id: 'broken', name: 'x' }).catch((e: unknown) => e);
    expect(invalid).toMatchObject({ code: 'INVALID_FILE' });
    expect((invalid as CanvasRequestError).errors[0]).toMatch(/^invalid JSON/);
  });

  it('answers unknown operations with UNKNOWN_OPERATION', async () => {
    const responses: [string, CanvasResponseBody][] = [];
    channel.on(CANVAS_RESPONSE, (response: CanvasResponse) =>
      responses.push([response.id, decodeCanvasMessage<CanvasResponseBody>(response.payload)!]),
    );
    channel.emit(CANVAS_REQUEST, { id: 'r1', payload: encodeCanvasMessage({ op: 'dropTables', args: {} }) });
    channel.emit(CANVAS_REQUEST, { id: 'r2', payload: encodeCanvasMessage({ op: 'subscribe', args: {} }) });
    channel.emit(CANVAS_REQUEST, { nonsense: true });
    await new Promise((r) => setTimeout(r, 10));
    expect(responses.map(([id, r]) => [id, r.success, !r.success && r.code])).toEqual([
      ['r1', false, 'UNKNOWN_OPERATION'],
      ['r2', false, 'UNKNOWN_OPERATION'],
    ]);
  });

  it('only resolves with the response to its own request', async () => {
    await requestCanvas(channel, 'create', { name: 'One' });
    const [a, b] = await Promise.all([requestCanvas(channel, 'get', { id: 'one' }), requestCanvas(channel, 'list')]);
    expect(a.id).toBe('one');
    expect(b.canvases).toHaveLength(1);
  });

  it('times out when nobody answers', async () => {
    const silent = new Channel({});
    const error = await requestCanvas(silent, 'list', undefined, { timeout: 20 }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'TIMEOUT' });
  });
});

describe('change broadcasts', () => {
  it('broadcasts the store’s own changes, whoever made them', async () => {
    const events = changes();
    await requestCanvas(channel, 'create', { name: 'Board' }); // the browser
    await store.addComment({
      canvasId: 'board',
      comment: { author: 'agent', body: 'From MCP', anchor: { type: 'position', x: 0, y: 0 } },
    }); // the agent, in process
    expect(events.map((e) => [e.type, e.source])).toEqual([
      ['changed', 'store'],
      ['changed', 'store'],
    ]);
    expect(events[1]).toMatchObject({ canvas: { comments: [{ body: 'From MCP' }] } });
  });

  it('broadcasts external file edits while the store watches', async () => {
    await store.watch();
    const canvas = await store.create({ name: 'Board' });
    const events = changes();
    const received = new Promise<void>((resolve) => onCanvasChanged(channel, () => resolve()));
    await writeFile(join(dir, 'board.json'), serializeCanvasFile({ ...canvas, name: 'By hand' }));
    await received;
    expect(events).toEqual([
      { type: 'changed', id: 'board', canvas: { ...canvas, name: 'By hand' }, source: 'external' },
    ]);
  });

  it('stops after unregistering', async () => {
    const events = changes();
    unregister();
    await store.create({ name: 'Quiet' });
    expect(events).toEqual([]);
    const error = await requestCanvas(channel, 'list', undefined, { timeout: 20 }).catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'TIMEOUT' });
  });
});

describe('preset', () => {
  const presetOptions = (extra: Record<string, unknown> = {}) =>
    ({ configDir: join(dir, '.storybook'), ...extra }) as unknown as Options;

  it('defaults the canvas directory to <configDir>/canvases and accepts canvasDir', () => {
    expect(canvasDirFor(presetOptions())).toBe(join(dir, '.storybook', 'canvases'));
    expect(canvasDirFor(presetOptions({ canvasDir: join(dir, 'custom') }))).toBe(join(dir, 'custom'));
    expect(canvasDirFor(presetOptions({ canvasDir: 'rel/canvases' }))).toBe(join(process.cwd(), 'rel/canvases'));
  });

  it('wires the shared store to the server channel and returns the channel', async () => {
    const serverChannel = new Channel({});
    const returned = await experimental_serverChannel(serverChannel, presetOptions());
    expect(returned).toBe(serverChannel);
    const shared = getCanvasStore({ dir: join(dir, '.storybook', 'canvases') });
    try {
      await shared.create({ name: 'Via MCP' });
      expect((await requestCanvas(serverChannel, 'list')).canvases.map((c) => c.id)).toEqual(['via-mcp']);
    } finally {
      await shared.close();
    }
  });
});
