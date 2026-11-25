/**
 * The MCP server a coding agent talks to: tools to read canvases and their comments, add comments,
 * reply, resolve and reopen. Every tool goes through the shared canvas store, so writes take the
 * store's per-canvas locks and reach the open canvas through its change events. Comments the agent
 * writes are always authored `agent`.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import {
  type Anchor,
  CANVAS_ID_PATTERN,
  type CanvasFile,
  commentStatusSchema,
  authorSchema,
  elementTargetSchema,
  positionAnchorSchema,
} from '../../canvas-file';
import { CanvasStoreError, type CanvasStore } from '../canvas-store';
import { type StoryLookup, summarizeCanvas, summarizeComment } from './format';

export const MCP_SERVER_NAME = 'storybook-addon-colab';

/** Returns a story lookup for the current story index. Called once per tool call. */
export type StoryLookupSource = () => Promise<StoryLookup>;

export interface ColabMcpServerOptions {
  store: CanvasStore;
  /** Adds title and story file to frames and frame comments. Without it those fields are omitted. */
  stories?: StoryLookupSource;
  version?: string;
}

const INSTRUCTIONS = `This server reads and writes the comment canvases of a running Storybook (storybook-addon-colab).
A canvas is a board of live story renders ("frames") where people pin comments to DOM elements, whole stories or free positions, and draw freehand strokes.
Typical flow: list_canvases → list_canvas_comments (status "open") → find the code from each comment's location (storyFile, storyId, selector, html, text, role/name, context) → fix it → reply_to_canvas_comment to say what changed → resolve_canvas_comment when done.
Coordinates are board pixels at zoom 1. Comments you add are marked as written by the agent and appear on the open canvas immediately.`;

const canvasId = z
  .string()
  .regex(CANVAS_ID_PATTERN, 'must be a canvas id (lowercase slug) as returned by list_canvases')
  .describe('Canvas id from list_canvases, e.g. "design-review".');
const itemId = z.string().min(1).max(100);
const body = z.string().trim().min(1).max(10_000);

const elementAnchorInput = z
  .object({
    type: z.literal('element'),
    frameId: itemId.describe('A frame on this canvas that renders target.storyId.'),
    target: elementTargetSchema.describe(
      "The element, usually copied from an existing comment's location (storyId, title, importPath = storyFile, selector, html, text, role, name).",
    ),
  })
  .describe('Pin to one DOM element inside a story frame.');
const frameAnchorInput = z
  .object({
    type: z.literal('frame'),
    frameId: itemId.describe('A frame on this canvas (see get_canvas frames).'),
    x: z.number().nonnegative().optional().describe("Offset from the frame's left edge; give with y."),
    y: z.number().nonnegative().optional().describe("Offset from the frame's top edge; give with x."),
  })
  .describe('Pin to a whole story frame (a remark about the story, not one element).');
const positionAnchorInput = positionAnchorSchema.describe('Pin to a free point on the board.');
const sameAsAnchorInput = z
  .object({
    type: z.literal('sameAs'),
    commentId: itemId.describe('An existing comment on this canvas.'),
  })
  .describe('Pin to the same place as an existing comment (same element, frame or position).');

const anchorInput = z.discriminatedUnion('type', [
  elementAnchorInput,
  frameAnchorInput,
  positionAnchorInput,
  sameAsAnchorInput,
]);
type AnchorInput = z.infer<typeof anchorInput>;

class ToolInputError extends Error {}

/** Creates an MCP server with every canvas tool registered. One server per HTTP request (stateless). */
export function createColabMcpServer({ store, stories, version = '0.0.0' }: ColabMcpServerOptions): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version }, { instructions: INSTRUCTIONS });
  const lookup = async (): Promise<StoryLookup> => {
    if (!stories) return () => undefined;
    try {
      return await stories();
    } catch {
      return () => undefined;
    }
  };

  server.registerTool(
    'list_canvases',
    {
      title: 'List canvases',
      description:
        'Lists every canvas in this Storybook with its id, name, frame count and open/total comment counts. Files in the canvas directory that are not valid canvases are listed under "invalid" with the reasons.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    () =>
      run(async () => {
        const listing = await store.list();
        return {
          canvases: listing.canvases.map(({ id, ...rest }) => ({ canvasId: id, ...rest })),
          ...(listing.invalid.length ? { invalid: listing.invalid } : {}),
        };
      }),
  );

  server.registerTool(
    'get_canvas',
    {
      title: 'Get a canvas',
      description:
        'Returns one canvas: its story frames (story id, story file, position, size), every comment with its location and replies, and its freehand strokes summarised by bounds and by which story frames each one is within, crosses, surrounds or is near. Raw stroke points are left out unless includeStrokePoints is true.',
      inputSchema: {
        canvasId,
        includeStrokePoints: z
          .boolean()
          .optional()
          .describe("Include each stroke's [x, y] points. Default false; they are long."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ canvasId: id, includeStrokePoints }) =>
      run(async () => summarizeCanvas(await store.get({ id }), await lookup(), { includeStrokePoints })),
  );

  server.registerTool(
    'list_canvas_comments',
    {
      title: 'List comments',
      description:
        'Lists comments, oldest first, on one canvas or on all canvases. Each comment includes its location: for an element, the story id, story file (importPath), CSS selector relative to the story root, HTML snippet, text, role/name and, for an element in a repeated row or list, context (the text of its row, which tells it apart from the same button in other rows), which is enough to find the code; for a frame, the story id and story file; for a position, the frames it lies in. Replies are included.',
      inputSchema: {
        canvasId: canvasId.optional().describe('Only this canvas. Omit for all canvases.'),
        status: commentStatusSchema.optional().describe('"open" or "resolved". Omit for both.'),
        author: authorSchema.optional().describe('"user" (a person) or "agent". Omit for both.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    ({ canvasId: id, status, author }) =>
      run(async () => {
        const ids = id ? [id] : (await store.list()).canvases.map((canvas) => canvas.id);
        const stories = await lookup();
        const comments = [];
        for (const canvasIdToRead of ids) {
          let canvas: CanvasFile;
          try {
            canvas = await store.get({ id: canvasIdToRead });
          } catch (error) {
            // A canvas deleted between list and get is skipped when listing all canvases.
            if (!id && error instanceof CanvasStoreError && error.code === 'NOT_FOUND') continue;
            throw error;
          }
          for (const comment of canvas.comments) {
            if (status && comment.status !== status) continue;
            if (author && comment.author !== author) continue;
            comments.push(summarizeComment(comment, canvas, stories));
          }
        }
        comments.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
        return { count: comments.length, comments };
      }),
  );

  server.registerTool(
    'add_canvas_comment',
    {
      title: 'Add a comment',
      description:
        'Adds an open comment, written by the agent, to a canvas; it appears on the open canvas immediately. Anchor it to an element (frameId + target, usually copied from another comment\'s location), a whole story frame (frameId, optional x/y offset), a board position (x, y), or the same place as an existing comment ({ type: "sameAs", commentId }). Returns the new comment.',
      inputSchema: {
        canvasId,
        body: body.describe('The comment text.'),
        anchor: anchorInput,
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ canvasId: id, body: text, anchor }) =>
      run(async () => {
        const canvas = await store.get({ id });
        const { comment, canvas: updated } = await store.addComment({
          canvasId: id,
          comment: { author: 'agent', body: text, anchor: resolveAnchor(anchor, canvas) },
        });
        return summarizeComment(comment, updated, await lookup());
      }),
  );

  server.registerTool(
    'reply_to_canvas_comment',
    {
      title: 'Reply to a comment',
      description:
        'Adds a reply, written by the agent, to a comment (for example to say what was changed). Does not change its status; use resolve_canvas_comment for that. Returns the comment with all replies.',
      inputSchema: {
        canvasId,
        commentId: itemId.describe('Comment id from list_canvas_comments or get_canvas.'),
        body: body.describe('The reply text.'),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    ({ canvasId: id, commentId, body: text }) =>
      run(async () => {
        const { comment, canvas } = await store.addReply({
          canvasId: id,
          commentId,
          reply: { author: 'agent', body: text },
        });
        return summarizeComment(comment, canvas, await lookup());
      }),
  );

  server.registerTool(
    'resolve_canvas_comment',
    {
      title: 'Resolve a comment',
      description:
        'Marks a comment resolved (for example after fixing what it asked for). Resolving an already resolved comment updates its resolvedAt time. Returns the comment.',
      inputSchema: { canvasId, commentId: itemId.describe('Comment id from list_canvas_comments or get_canvas.') },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ canvasId: id, commentId }) =>
      run(async () => {
        const { comment, canvas } = await store.resolveComment({ canvasId: id, commentId });
        return summarizeComment(comment, canvas, await lookup());
      }),
  );

  server.registerTool(
    'reopen_canvas_comment',
    {
      title: 'Reopen a comment',
      description: 'Marks a resolved comment open again. Returns the comment.',
      inputSchema: { canvasId, commentId: itemId.describe('Comment id from list_canvas_comments or get_canvas.') },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    ({ canvasId: id, commentId }) =>
      run(async () => {
        const { comment, canvas } = await store.reopenComment({ canvasId: id, commentId });
        return summarizeComment(comment, canvas, await lookup());
      }),
  );

  // Nothing here changes the tool list at runtime, and the HTTP endpoint answers GET with 405, so
  // tell clients not to wait for list-changed notifications.
  server.server.registerCapabilities({ tools: { listChanged: false } });

  return server;
}

/** Turns the agent's anchor input into a stored anchor, checking it against the canvas. */
function resolveAnchor(input: AnchorInput, canvas: CanvasFile): Anchor {
  switch (input.type) {
    case 'element': {
      const frame = findFrame(canvas, input.frameId);
      if (frame.storyId !== input.target.storyId) {
        throw new ToolInputError(
          `anchor.target.storyId "${input.target.storyId}" does not match frame "${frame.id}", which renders "${frame.storyId}"`,
        );
      }
      return { type: 'element', frameId: input.frameId, target: input.target };
    }
    case 'frame': {
      const frame = findFrame(canvas, input.frameId);
      if ((input.x === undefined) !== (input.y === undefined)) {
        throw new ToolInputError('anchor.x and anchor.y must be given together');
      }
      return {
        type: 'frame',
        frameId: frame.id,
        storyId: frame.storyId,
        ...(input.x !== undefined && input.y !== undefined ? { x: input.x, y: input.y } : {}),
      };
    }
    case 'position':
      return { type: 'position', x: input.x, y: input.y };
    case 'sameAs': {
      const existing = canvas.comments.find((comment) => comment.id === input.commentId);
      if (!existing) {
        throw new ToolInputError(`no comment "${input.commentId}" on canvas "${canvas.id}"`);
      }
      return existing.anchor;
    }
  }
}

function findFrame(canvas: CanvasFile, frameId: string) {
  const frame = canvas.frames.find((candidate) => candidate.id === frameId);
  if (!frame) {
    const known = canvas.frames.map((f) => `${f.id} (${f.storyId})`).join(', ') || 'none';
    throw new ToolInputError(`no frame "${frameId}" on canvas "${canvas.id}"; frames: ${known}`);
  }
  return frame;
}

/** Runs a tool body; returns its value as compact JSON, or a readable error the agent can act on. */
async function run(body: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    const value = await body();
    return { content: [{ type: 'text', text: JSON.stringify(value) }] };
  } catch (error) {
    let text: string;
    if (error instanceof CanvasStoreError) {
      text = `${error.code}: ${error.message}`;
    } else if (error instanceof ToolInputError) {
      text = `INVALID_INPUT: ${error.message}`;
    } else {
      text = `INTERNAL: ${error instanceof Error ? error.message : String(error)}`;
    }
    return { isError: true, content: [{ type: 'text', text }] };
  }
}
