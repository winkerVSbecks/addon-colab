/**
 * Serves the canvas MCP server over streamable HTTP on the Storybook dev server, at
 * `COLAB_MCP_ENDPOINT`. It follows the pattern of Storybook's own MCP addon (`@storybook/addon-mcp`,
 * which serves `/mcp`): routes added in the `experimental_devServer` preset hook, so it listens
 * wherever the dev server listens and sits behind Storybook's Host-header check; an Origin check
 * against the same host rules; JSON bodies only. It is stateless: each POST gets a fresh server and
 * transport, and GET (the optional server-to-client stream) is answered with 405 as the MCP spec allows.
 *
 * The endpoint has no authentication, like the rest of the dev server. The Origin and Content-Type
 * checks stop web pages on other origins from calling it through the user's browser.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';

import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import type { CanvasStore } from '../canvas-store';
import { createColabMcpServer, type StoryLookupSource } from './tools';

/** Distinct from `@storybook/addon-mcp`'s `/mcp`, so both addons can be installed together. */
export const COLAB_MCP_ENDPOINT = '/colab/mcp';

/** Requests carry small JSON-RPC messages; anything larger is refused. */
export const MAX_BODY_BYTES = 1024 * 1024;

export interface McpHandlerOptions {
  store: CanvasStore;
  stories?: StoryLookupSource;
  version?: string;
  /**
   * Whether a browser Origin (its `host[:port]`) may call the endpoint. Storybook's `isValidHost`
   * with the dev server's host options in production; requests without an Origin header (CLI agents)
   * are always allowed.
   */
  isAllowedOriginHost: (host: string) => boolean;
}

type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

/** Handles every method on the endpoint path. */
export function createMcpRequestHandler(options: McpHandlerOptions): Handler {
  return async (req, res) => {
    if (!originAllowed(req.headers.origin, options.isAllowedOriginHost)) {
      return sendText(res, 403, 'Invalid origin');
    }
    if (req.method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendText(res, 405, 'Method not allowed: this MCP endpoint is stateless and only accepts POST');
    }
    const contentType = req.headers['content-type']?.split(';')[0]?.trim().toLowerCase();
    if (contentType !== 'application/json') {
      return sendText(res, 415, 'Unsupported Media Type: Content-Type must be application/json');
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(await readBody(req, MAX_BODY_BYTES));
    } catch (error) {
      if (error instanceof BodyTooLargeError) {
        return sendJsonRpcError(res, 413, -32600, `Request body larger than ${MAX_BODY_BYTES} bytes`);
      }
      return sendJsonRpcError(res, 400, -32700, 'Parse error: body is not valid JSON');
    }

    const server = createColabMcpServer(options);
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => {
      void transport.close();
      void server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, parsed);
    } catch (error) {
      console.error('[addon-colab] MCP request failed', error);
      if (!res.headersSent) {
        sendJsonRpcError(res, 500, -32603, 'Internal error');
      }
    }
  };
}

/** No Origin (a non-browser client) or an Origin whose host passes the dev server's host rules. */
export function originAllowed(origin: string | undefined, isAllowedHost: (host: string) => boolean): boolean {
  if (origin === undefined) return true;
  try {
    const url = new URL(origin);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return isAllowedHost(url.host);
  } catch {
    // Includes `Origin: null` (sandboxed frames, file: pages).
    return false;
  }
}

class BodyTooLargeError extends Error {}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(new BodyTooLargeError());
        req.removeAllListeners('data');
        req.resume();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendText(res: ServerResponse, status: number, text: string): void {
  res.writeHead(status, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end(text);
}

function sendJsonRpcError(res: ServerResponse, status: number, code: number, message: string): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }));
}
