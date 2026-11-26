/**
 * Round trips through Storybook's real WebSocket transport serialisation. Two `WebsocketTransport`s
 * (browser and server) are linked by an in-memory socket, so every message is stringified and
 * parsed exactly as on the wire, including telejson's ISO-timestamp-to-Date revival.
 */
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sockets = vi.hoisted(() => {
  class LinkedSocket {
    static all: LinkedSocket[] = [];
    peer?: LinkedSocket;
    frames: string[] = [];
    onopen?: () => void;
    onmessage?: (event: { data: string }) => void;
    onclose?: (event: { reason: string; code: number }) => void;
    onerror?: (event: unknown) => void;
    constructor(public url: string) {
      LinkedSocket.all.push(this);
    }
    send(data: string) {
      this.frames.push(data);
      setTimeout(() => this.peer?.onmessage?.({ data }), 0);
    }
    close(code = 1000, reason = '') {
      this.onclose?.({ code, reason });
    }
  }
  (globalThis as { WebSocket?: unknown }).WebSocket = LinkedSocket;
  return LinkedSocket;
});

import { Channel, WebsocketTransport } from 'storybook/internal/channels';

import { validateCanvasFile } from '../canvas-file';
import {
  CANVAS_REQUEST,
  CANVAS_RESPONSE,
  type CanvasChangeEvent,
  type CanvasResponse,
  type CanvasResponseBody,
  decodeCanvasMessage,
  encodeCanvasMessage,
  onCanvasChanged,
  requestCanvas,
} from '../channel';
import { registerCanvasChannel } from './canvas-channel';
import { type CanvasStore, createCanvasStore } from './canvas-store';

const ISO = '2026-11-25T15:52:21.624Z';

let dir: string;
let store: CanvasStore;
let browser: Channel;
let server: Channel;
let browserSocket: InstanceType<typeof sockets>;
let serverSocket: InstanceType<typeof sockets>;
let unregister: () => void;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'colab-transport-'));
  store = createCanvasStore({ dir });
  sockets.all = [];
  browser = new Channel({ transport: new WebsocketTransport({ url: 'ws://browser', onError: () => {} }) });
  server = new Channel({ transport: new WebsocketTransport({ url: 'ws://server', onError: () => {} }) });
  [browserSocket, serverSocket] = sockets.all as [InstanceType<typeof sockets>, InstanceType<typeof sockets>];
  browserSocket.peer = serverSocket;
  serverSocket.peer = browserSocket;
  browserSocket.onopen?.();
  serverSocket.onopen?.();
  unregister = registerCanvasChannel(server, store);
});

afterEach(async () => {
  unregister();
  browserSocket.close();
  serverSocket.close();
  await store.close();
  await rm(dir, { recursive: true, force: true });
});

describe('the canvas channel over Storybook’s WebSocket transport', () => {
  it('the transport turns plain ISO strings into Dates (why payloads are encoded)', async () => {
    const received = new Promise<{ at: unknown }>((resolve) => browser.on('probe', resolve));
    server.emit('probe', { at: ISO });
    expect((await received).at).toBeInstanceOf(Date);
  });

  it('returns canvases with string timestamps that validate', async () => {
    const created = await requestCanvas(browser, 'create', { name: 'Board' });
    expect(typeof created.createdAt).toBe('string');
    expect(validateCanvasFile(created)).toMatchObject({ ok: true });
    const fetched = await requestCanvas(browser, 'get', { id: 'board' });
    expect(fetched).toEqual(await store.get({ id: 'board' }));
    expect(validateCanvasFile(fetched)).toMatchObject({ ok: true });
    const listing = await requestCanvas(browser, 'list');
    expect(typeof listing.canvases[0]?.updatedAt).toBe('string');
  });

  it('keeps a comment body that is an ISO timestamp unchanged in both directions', async () => {
    await requestCanvas(browser, 'create', { name: 'Board' });
    const events: CanvasChangeEvent[] = [];
    const off = onCanvasChanged(browser, (event) => events.push(event));
    const { comment } = await requestCanvas(browser, 'addComment', {
      canvasId: 'board',
      comment: { author: 'user', body: ISO, anchor: { type: 'position', x: 0, y: 0 } },
    });
    const { reply } = await requestCanvas(browser, 'addReply', {
      canvasId: 'board',
      commentId: comment.id,
      reply: { author: 'agent', body: '_date_not-a-date' },
    });
    expect(comment.body).toBe(ISO);
    expect(reply.body).toBe('_date_not-a-date');
    const stored = await store.get({ id: 'board' });
    expect(stored.comments[0]?.body).toBe(ISO);
    expect(stored.comments[0]?.replies[0]?.body).toBe('_date_not-a-date');

    await vi.waitFor(() => expect(events).toHaveLength(2));
    off();
    const last = events[1];
    if (last?.type !== 'changed') throw new Error(`expected a changed event, got ${JSON.stringify(last)}`);
    expect(last.canvas).toEqual(stored);
    expect(validateCanvasFile(last.canvas)).toMatchObject({ ok: true });
  });

  it('is not limited by the transport’s nesting depth', async () => {
    await requestCanvas(browser, 'create', { name: 'Deep' });
    const target = {
      storyId: 's--a',
      title: 'S',
      importPath: './s.stories.tsx',
      selector: 'div',
      html: '<div></div>',
      text: '',
    };
    const { comment } = await requestCanvas(browser, 'addComment', {
      canvasId: 'deep',
      comment: { author: 'user', body: 'hi', anchor: { type: 'element', frameId: 'frame-x', target } },
    });
    expect(comment.anchor).toEqual({ type: 'element', frameId: 'frame-x', target });
  });

  it('rejects malformed top-level arguments with INVALID_INPUT', async () => {
    const send = (op: string, args: unknown) =>
      requestCanvas(browser, op as 'rename', args as never, { timeout: 1000 }).catch((e: unknown) => e);
    for (const [op, args] of [
      ['rename', undefined],
      ['addFrame', null],
      ['get', ['board']],
      ['delete', 'board'],
    ] as const) {
      expect(await send(op, args), `${op}(${String(args)})`).toMatchObject({ code: 'INVALID_INPUT' });
    }
    for (const id of [42, ['ok'], { slug: 'x' }]) {
      expect(await send('create', { name: 'Board', id }), JSON.stringify(id)).toMatchObject({
        code: 'INVALID_INPUT',
      });
    }
    expect(await requestCanvas(browser, 'list', undefined, { timeout: 1000 })).toEqual({ canvases: [], invalid: [] });
  });

  it('answers malformed requests and unknown operations without throwing', async () => {
    const responses: CanvasResponseBody[] = [];
    browser.on(CANVAS_RESPONSE, (response: CanvasResponse) => {
      responses.push(decodeCanvasMessage<CanvasResponseBody>(response.payload)!);
    });
    browser.emit(CANVAS_REQUEST, { id: 'a', payload: '{not json' });
    browser.emit(CANVAS_REQUEST, { id: 'b', payload: { op: 'list', args: {} } });
    browser.emit(CANVAS_REQUEST, { id: 'c', payload: encodeCanvasMessage({ op: 'dropTables', args: {} }) });
    await vi.waitFor(() => expect(responses).toHaveLength(3));
    expect(responses.map((r) => !r.success && r.code)).toEqual(['INVALID_INPUT', 'INVALID_INPUT', 'UNKNOWN_OPERATION']);
  });

  it('sends payloads as opaque strings on the wire', async () => {
    await requestCanvas(browser, 'create', { name: 'Board' });
    const frames = [...browserSocket.frames, ...serverSocket.frames].filter((f) => f.includes('addon-colab'));
    expect(frames.length).toBeGreaterThan(0);
    for (const frame of frames) expect(frame).not.toContain('_date_');
  });
});
