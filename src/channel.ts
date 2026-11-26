/**
 * The canvas channel: event names and payload types shared by the storage server (preset),
 * the manager and the preview. Safe to import anywhere: no Node APIs and no runtime
 * dependencies beyond `./constants`.
 *
 * It follows the request/response pattern Storybook's own server channel features use
 * (`SAVE_STORY_REQUEST`/`SAVE_STORY_RESPONSE`, `experimental_requestResponse`): the browser emits
 * `CANVAS_REQUEST` with `{ id, payload }`, the server answers on `CANVAS_RESPONSE` with
 * `{ id, payload }`, and every client filters responses by `id`. The server also broadcasts
 * `CANVAS_CHANGED` whenever a canvas changes, whoever changed it. Payloads are JSON strings so the
 * transport cannot change them; use `requestCanvas` and `onCanvasChanged` rather than raw events.
 */
import type { Channel } from 'storybook/internal/channels';

import type { CanvasFile, Comment, Frame, Reply, Stroke } from './canvas-file';
import { ADDON_ID } from './constants';

/** Browser → server. Payload: `CanvasRequest`. Send with `requestCanvas`. */
export const CANVAS_REQUEST = `${ADDON_ID}/canvas-request`;
/** Server → browser. Payload: `CanvasResponse`. */
export const CANVAS_RESPONSE = `${ADDON_ID}/canvas-response`;
/** Server → browser, broadcast on every change. Payload: an encoded `CanvasChangeEvent`; subscribe with `onCanvasChanged`. */
export const CANVAS_CHANGED = `${ADDON_ID}/canvas-changed`;

/** One row of the canvas list. */
export interface CanvasSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  frameCount: number;
  commentCount: number;
  openCommentCount: number;
}

/** A file in the canvas directory that could not be read as a canvas. It is never overwritten. */
export interface InvalidCanvas {
  /** The file name without `.json`. Not necessarily a valid canvas id. */
  id: string;
  /** File name inside the canvas directory, e.g. `broken.json`. */
  file: string;
  errors: string[];
}

export interface CanvasListing {
  /** Sorted by name, then id. */
  canvases: CanvasSummary[];
  invalid: InvalidCanvas[];
}

/** Who caused a change: this store (browser, MCP agent) or something else writing the file (a person, git). */
export type CanvasChangeSource = 'store' | 'external';

export type CanvasChangeEvent =
  /** Created or updated. */
  | { type: 'changed'; id: string; canvas: CanvasFile; source: CanvasChangeSource }
  | { type: 'deleted'; id: string; source: CanvasChangeSource }
  /** The file was edited on disk and no longer validates. Only external edits can cause this. */
  | { type: 'invalid'; id: string; errors: string[]; source: 'external' };

export type FrameInput = Omit<Frame, 'id'>;
/** `height: null` removes the height so the frame sizes to its content. */
export type FrameChanges = Partial<Pick<Frame, 'x' | 'y' | 'width'>> & { height?: number | null };
export type CommentInput = Pick<Comment, 'author' | 'body' | 'anchor'>;
export type ReplyInput = Pick<Reply, 'author' | 'body'>;
export type StrokeInput = Omit<Stroke, 'id'>;

/**
 * Every store operation: its arguments and its result. The store (`src/server/canvas-store.ts`)
 * implements one method per key with exactly this signature, and the channel forwards requests
 * to it unchanged, so the browser and in-process callers (MCP tools) share one API.
 */
export interface CanvasOperations {
  list: { args: void; result: CanvasListing };
  get: { args: { id: string }; result: CanvasFile };
  /** `id` defaults to a slug of `name`, with `-2`, `-3`… appended if taken. An explicit `id` that is taken fails. */
  create: { args: { name: string; id?: string }; result: CanvasFile };
  /** Changes the display name only; the id and file name stay the same. */
  rename: { args: { id: string; name: string }; result: CanvasFile };
  delete: { args: { id: string }; result: { id: string } };
  addFrame: { args: { canvasId: string; frame: FrameInput }; result: { canvas: CanvasFile; frame: Frame } };
  updateFrame: {
    args: { canvasId: string; frameId: string; changes: FrameChanges };
    result: { canvas: CanvasFile; frame: Frame };
  };
  /** Comments anchored to the frame are kept; their anchors still name the story. */
  removeFrame: { args: { canvasId: string; frameId: string }; result: { canvas: CanvasFile } };
  /**
   * Puts a removed frame back with the same id (undo of `removeFrame`), at `index` in the stacking
   * order (clamped; the top when absent). Fails with `ALREADY_EXISTS` when the id is on the canvas.
   */
  restoreFrame: {
    args: { canvasId: string; frame: Frame; index?: number };
    result: { canvas: CanvasFile; frame: Frame };
  };
  /**
   * Brings a frame to the front: moves it to the end of `frames`, whose order is the stacking order
   * (last = on top). Writes nothing when it is already there.
   */
  raiseFrame: { args: { canvasId: string; frameId: string }; result: { canvas: CanvasFile; frame: Frame } };
  addComment: { args: { canvasId: string; comment: CommentInput }; result: { canvas: CanvasFile; comment: Comment } };
  addReply: {
    args: { canvasId: string; commentId: string; reply: ReplyInput };
    result: { canvas: CanvasFile; comment: Comment; reply: Reply };
  };
  resolveComment: { args: { canvasId: string; commentId: string }; result: { canvas: CanvasFile; comment: Comment } };
  reopenComment: { args: { canvasId: string; commentId: string }; result: { canvas: CanvasFile; comment: Comment } };
  deleteComment: { args: { canvasId: string; commentId: string }; result: { canvas: CanvasFile } };
  /**
   * Puts a deleted comment back with the same id, replies, status and timestamps (undo of
   * `deleteComment`), at `index` in `comments` (clamped; the end when absent). Fails with
   * `ALREADY_EXISTS` when the id is on the canvas.
   */
  restoreComment: {
    args: { canvasId: string; comment: Comment; index?: number };
    result: { canvas: CanvasFile; comment: Comment };
  };
  addStroke: { args: { canvasId: string; stroke: StrokeInput }; result: { canvas: CanvasFile; stroke: Stroke } };
  removeStroke: { args: { canvasId: string; strokeId: string }; result: { canvas: CanvasFile } };
  /**
   * Removes several strokes in one write (an eraser swipe). Ids not on the canvas are skipped;
   * `strokes` in the result are the removed ones, in drawing order. No write when none are present.
   */
  removeStrokes: { args: { canvasId: string; strokeIds: string[] }; result: { canvas: CanvasFile; strokes: Stroke[] } };
  /**
   * Puts removed strokes back with their ids (undo of `removeStroke` / `clearStrokes`, redo of
   * `addStroke`), inserted together at `index` in the drawing order (clamped; the end when absent).
   * Strokes whose id is already on the canvas are skipped, so a repeated undo is harmless;
   * `strokes` in the result are the ones actually put back.
   */
  restoreStrokes: {
    args: { canvasId: string; strokes: Stroke[]; index?: number };
    result: { canvas: CanvasFile; strokes: Stroke[] };
  };
  /** Removes every stroke. `strokes` in the result are the removed ones (for undo). */
  clearStrokes: { args: { canvasId: string }; result: { canvas: CanvasFile; strokes: Stroke[] } };
  /**
   * The board says how tall it draws each story frame (CSS pixels), so the agent's view uses real
   * sizes. Kept in the dev server's memory only: never written to the canvas file and no change
   * event. `null` forgets a frame's height (its story is missing or failed to render). Heights for
   * frames not in `heights` are kept, unless `replace` is true (a board's first report after it
   * mounts), which forgets every height reported before.
   */
  reportRenderedHeights: {
    args: { canvasId: string; heights: Record<string, number | null>; replace?: boolean };
    result: { canvasId: string };
  };
}

export type CanvasOperation = keyof CanvasOperations;
export type CanvasOperationArgs<Op extends CanvasOperation> = CanvasOperations[Op]['args'];
export type CanvasOperationResult<Op extends CanvasOperation> = CanvasOperations[Op]['result'];

export const CANVAS_OPERATIONS = [
  'list',
  'get',
  'create',
  'rename',
  'delete',
  'addFrame',
  'updateFrame',
  'removeFrame',
  'restoreFrame',
  'raiseFrame',
  'addComment',
  'addReply',
  'resolveComment',
  'reopenComment',
  'deleteComment',
  'restoreComment',
  'addStroke',
  'removeStroke',
  'removeStrokes',
  'restoreStrokes',
  'clearStrokes',
  'reportRenderedHeights',
] as const satisfies readonly CanvasOperation[];

/**
 * Why an operation failed.
 * - `NOT_FOUND`: no such canvas, frame, comment or stroke.
 * - `ALREADY_EXISTS`: `create` with an explicit id that is taken.
 * - `INVALID_INPUT`: the arguments are malformed or would produce an invalid canvas; `errors` says why.
 * - `INVALID_FILE`: the canvas file on disk does not validate; it is left untouched.
 * - `CONFLICT`: the file kept changing under the store; nothing was written.
 * - `UNKNOWN_OPERATION`: the channel received an operation name that is not in `CANVAS_OPERATIONS`.
 * - `INTERNAL`: an unexpected server error, or a response the helper could not decode.
 */
export type CanvasErrorCode =
  | 'NOT_FOUND'
  | 'ALREADY_EXISTS'
  | 'INVALID_INPUT'
  | 'INVALID_FILE'
  | 'CONFLICT'
  | 'UNKNOWN_OPERATION'
  | 'INTERNAL';

export interface CanvasErrorPayload {
  code: CanvasErrorCode;
  errors?: string[];
}

/**
 * What travels on the channel. Everything except the request `id` is a JSON string (see
 * `encodeCanvasMessage`), so the transport's serialiser cannot alter it: Storybook's WebSocket
 * transport (telejson) turns any string that looks like an ISO timestamp into a `Date`, in both
 * directions, and limits nesting depth. A JSON string is opaque to it.
 *
 * Browser → server on `CANVAS_REQUEST`. `payload` encodes `CanvasRequestBody`.
 */
export interface CanvasRequest {
  id: string;
  payload: string;
}

export interface CanvasRequestBody<Op extends CanvasOperation = CanvasOperation> {
  op: Op;
  args: CanvasOperationArgs<Op>;
}

/** Server → browser on `CANVAS_RESPONSE`. `payload` encodes `CanvasResponseBody`. */
export interface CanvasResponse {
  id: string;
  payload: string;
}

export type CanvasResponseBody<Op extends CanvasOperation = CanvasOperation> =
  | { success: true; result: CanvasOperationResult<Op> }
  | { success: false; error: string; code: CanvasErrorCode; errors?: string[] };

/** Server → browser on `CANVAS_CHANGED`: an encoded `CanvasChangeEvent`. Decode with `onCanvasChanged`. */
export type CanvasChangedMessage = string;

/** Encodes a channel payload. JSON keeps strings as strings and has no depth limit. */
export function encodeCanvasMessage(value: unknown): string {
  return JSON.stringify(value === undefined ? null : value);
}

/** Decodes a channel payload; `undefined` if it is not an encoded payload. */
export function decodeCanvasMessage<T>(data: unknown): T | undefined {
  if (typeof data !== 'string') return undefined;
  try {
    return JSON.parse(data) as T;
  } catch {
    return undefined;
  }
}

/** The part of a Storybook channel this module needs; manager, preview and server channels all fit. */
export type ChannelLike = Pick<Channel, 'emit' | 'on' | 'off'>;

/** Rejection from `requestCanvas`: the server's message plus a `code` to branch on. */
export class CanvasRequestError extends Error {
  readonly code: CanvasErrorCode | 'TIMEOUT';
  readonly errors: string[];

  constructor(message: string, code: CanvasErrorCode | 'TIMEOUT', errors: string[] = []) {
    super(message);
    this.name = 'CanvasRequestError';
    this.code = code;
    this.errors = errors;
  }
}

/**
 * Runs a store operation on the server and resolves with its result. Works with the manager channel
 * (`addons.getChannel()` from `storybook/manager-api`) and the preview channel (`addons.getChannel()`
 * from `storybook/preview-api`); mirrors `experimental_requestResponse`, which only exists in the manager.
 */
export function requestCanvas<Op extends CanvasOperation>(
  channel: ChannelLike,
  op: Op,
  ...[args, options]: CanvasOperationArgs<Op> extends void
    ? [args?: undefined, options?: { timeout?: number }]
    : [args: CanvasOperationArgs<Op>, options?: { timeout?: number }]
): Promise<CanvasOperationResult<Op>> {
  const timeout = options?.timeout ?? 5000;
  const body: CanvasRequestBody<Op> = { op, args: args as CanvasOperationArgs<Op> };
  const request: CanvasRequest = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    payload: encodeCanvasMessage(body),
  };
  return new Promise((resolve, reject) => {
    const onResponse = (response: CanvasResponse) => {
      if (response?.id !== request.id) return;
      clearTimeout(timer);
      channel.off(CANVAS_RESPONSE, onResponse);
      const decoded = decodeCanvasMessage<CanvasResponseBody<Op>>(response.payload);
      if (!decoded || typeof decoded !== 'object') {
        reject(new CanvasRequestError(`Unreadable response from the canvas server (${op})`, 'INTERNAL'));
      } else if (decoded.success) {
        resolve(decoded.result);
      } else {
        reject(new CanvasRequestError(decoded.error, decoded.code, decoded.errors));
      }
    };
    const timer = setTimeout(() => {
      channel.off(CANVAS_RESPONSE, onResponse);
      reject(new CanvasRequestError(`Timed out waiting for the canvas server (${op})`, 'TIMEOUT'));
    }, timeout);
    channel.on(CANVAS_RESPONSE, onResponse);
    channel.emit(CANVAS_REQUEST, request);
  });
}

/**
 * Calls `listener` with every `CanvasChangeEvent` the server broadcasts, decoded. Returns a function
 * that unsubscribes. Use this instead of listening to `CANVAS_CHANGED` directly.
 */
export function onCanvasChanged(channel: ChannelLike, listener: (event: CanvasChangeEvent) => void): () => void {
  const handler = (message: CanvasChangedMessage) => {
    const event = decodeCanvasMessage<CanvasChangeEvent>(message);
    if (event && typeof event === 'object') listener(event);
  };
  channel.on(CANVAS_CHANGED, handler);
  return () => channel.off(CANVAS_CHANGED, handler);
}
