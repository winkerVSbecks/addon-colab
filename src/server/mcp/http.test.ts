import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type CanvasStore, createCanvasStore } from '../canvas-store';
import { COLAB_MCP_ENDPOINT, createMcpRequestHandler, MAX_BODY_BYTES, originAllowed } from './http';

const FIXTURE = join(__dirname, '../../__fixtures__/example-canvas.json');
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

let dir: string;
let store: CanvasStore;
let server: Server;
let url: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'colab-mcp-http-'));
  await copyFile(FIXTURE, join(dir, 'design-review.json'));
  store = createCanvasStore({ dir });
  const handler = createMcpRequestHandler({ store, isAllowedOriginHost: (host) => LOOPBACK.test(host) });
  server = createServer((req, res) => {
    if (new URL(req.url ?? '/', 'http://x').pathname === COLAB_MCP_ENDPOINT) {
      void handler(req, res);
    } else {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${(server.address() as AddressInfo).port}${COLAB_MCP_ENDPOINT}`;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await store.close();
  await rm(dir, { recursive: true, force: true });
});

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'curl', version: '0' } },
};

function post(body: string, headers: Record<string, string> = {}) {
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...headers },
    body,
  });
}

describe('MCP over HTTP', () => {
  it('serves every tool to an SDK client and writes through the store', async () => {
    const client = new Client({ name: 'http-test', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(7);

    const listed = await client.callTool({ name: 'list_canvases', arguments: {} });
    expect((listed.content as { text: string }[])[0]!.text).toContain('"canvasId":"design-review"');

    const added = await client.callTool({
      name: 'add_canvas_comment',
      arguments: { canvasId: 'design-review', body: 'Over HTTP', anchor: { type: 'position', x: 5, y: 5 } },
    });
    expect(added.isError).toBeFalsy();
    const canvas = await store.get({ id: 'design-review' });
    expect(canvas.comments.at(-1)).toMatchObject({ author: 'agent', body: 'Over HTTP' });
    await client.close();
  });

  it('answers a plain JSON POST with JSON (no session id)', async () => {
    const response = await post(JSON.stringify(initialize));
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('mcp-session-id')).toBeNull();
    const body = await response.json();
    expect(body.result.serverInfo.name).toBe('storybook-addon-colab');
  });

  it('accepts requests from the same loopback origin', async () => {
    const response = await post(JSON.stringify(initialize), { Origin: 'http://localhost:6006' });
    expect(response.status).toBe(200);
  });

  it('rejects requests from other origins', async () => {
    for (const origin of ['https://evil.example', 'null', 'http://localhost.evil.example:6006']) {
      const response = await post(JSON.stringify(initialize), { Origin: origin });
      expect(response.status, origin).toBe(403);
    }
  });

  it('rejects non-JSON content types, which browsers can send cross-origin without a preflight', async () => {
    const response = await post(JSON.stringify(initialize), { 'Content-Type': 'text/plain' });
    expect(response.status).toBe(415);
  });

  it('answers GET and DELETE with 405', async () => {
    expect((await fetch(url, { headers: { Accept: 'text/event-stream' } })).status).toBe(405);
    expect((await fetch(url, { method: 'DELETE' })).status).toBe(405);
  });

  it('rejects malformed and oversized bodies', async () => {
    const bad = await post('{ nope');
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.code).toBe(-32700);
    const big = await post(JSON.stringify({ ...initialize, padding: 'x'.repeat(MAX_BODY_BYTES) }));
    expect(big.status).toBe(413);
  });
});

describe('originAllowed', () => {
  const allow = (host: string) => host === 'localhost:6006';
  it('allows requests without an Origin (CLI agents)', () => {
    expect(originAllowed(undefined, allow)).toBe(true);
  });
  it('checks the host of http(s) origins only', () => {
    expect(originAllowed('http://localhost:6006', allow)).toBe(true);
    expect(originAllowed('http://localhost:6007', allow)).toBe(false);
    expect(originAllowed('null', allow)).toBe(false);
    expect(originAllowed('chrome-extension://abc', () => true)).toBe(false);
  });
});
