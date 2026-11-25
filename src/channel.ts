/**
 * The canvas channel: event names and payload types shared by the storage server (preset),
 * the manager and the preview. Safe to import anywhere: no Node APIs and no runtime
 * dependencies beyond `./constants`.
 *
 * It follows the request/response pattern Storybook's own server channel features use
 * (`SAVE_STORY_REQUEST`/`SAVE_STORY_RESPONSE`, `experimental_requestResponse`): the browser emits
 * `CANVAS_REQUEST` with `{ id, payload }`, the server answers on `CANVAS_RESPONSE` with
 * `{ id, success, error, payload }`, and every client filters responses by `id`. The server also
 * broadcasts `CANVAS_CHANGED` whenever a canvas changes, whoever changed it.
 */
import type { CanvasFile, Comment, Frame, Reply, Stroke } from './canvas-file';
import { ADDON_ID } from './constants';

/** Browser → server. Payload: `CanvasRequest`. */
export const CANVAS_REQUEST = `${ADDON_ID}/canvas-request`;
/** Server → browser. Payload: `CanvasResponse`. */
export const CANVAS_RESPONSE = `${ADDON_ID}/canvas-response`;
/** Server → browser, broadcast on every change. Payload: `CanvasChangeEvent`. */
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
  addComment: { args: { canvasId: string; comment: CommentInput }; result: { canvas: CanvasFile; comment: Comment } };
  addReply: {
    args: { canvasId: string; commentId: string; reply: ReplyInput };
    result: { canvas: CanvasFile; comment: Comment; reply: Reply };
  };
  resolveComment: { args: { canvasId: string; commentId: string }; result: { canvas: CanvasFile; comment: Comment } };
  reopenComment: { args: { canvasId: string; commentId: string }; result: { canvas: CanvasFile; comment: Comment } };
  deleteComment: { args: { canvasId: string; commentId: string }; result: { canvas: CanvasFile } };
  addStroke: { args: { canvasId: string; stroke: StrokeInput }; result: { canvas: CanvasFile; stroke: Stroke } };
  removeStroke: { args: { canvasId: string; strokeId: string }; result: { canvas: CanvasFile } };
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
  'addComment',
  'addReply',
  'resolveComment',
  'reopenComment',
  'deleteComment',
  'addStroke',
  'removeStroke',
] as const satisfies readonly CanvasOperation[];

/**
 * Why an operation failed.
 * - `NOT_FOUND`: no such canvas, frame, comment or stroke.
 * - `ALREADY_EXISTS`: `create` with an explicit id that is taken.
 * - `INVALID_INPUT`: the arguments would produce an invalid canvas; `errors` says why.
 * - `INVALID_FILE`: the canvas file on disk does not validate; it is left untouched.
 * - `CONFLICT`: the file kept changing under the store; nothing was written.
 * - `UNKNOWN_OPERATION`, `INTERNAL`: anything else.
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

/** Same shape as Storybook's `RequestData` (`storybook/internal/core-events`). */
export interface CanvasRequest<Op extends CanvasOperation = CanvasOperation> {
  id: string;
  payload: { op: Op; args: CanvasOperationArgs<Op> };
}

/** Same shape as Storybook's `ResponseData` (`storybook/internal/core-events`). */
export type CanvasResponse<Op extends CanvasOperation = CanvasOperation> =
  | { id: string; success: true; error: null; payload: CanvasOperationResult<Op> }
  | { id: string; success: false; error: string; payload: CanvasErrorPayload };

/** The part of a Storybook channel this module needs; manager, preview and server channels all fit. */
export interface ChannelLike {
  emit(event: string, ...args: unknown[]): void;
  on(event: string, listener: (...args: never[]) => void): void;
  off(event: string, listener: (...args: never[]) => void): void;
}

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
  const request: CanvasRequest<Op> = {
    id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`,
    payload: { op, args: args as CanvasOperationArgs<Op> },
  };
  return new Promise((resolve, reject) => {
    const onResponse = (response: CanvasResponse<Op>) => {
      if (response?.id !== request.id) return;
      clearTimeout(timer);
      channel.off(CANVAS_RESPONSE, onResponse);
      if (response.success) {
        resolve(response.payload);
      } else {
        reject(new CanvasRequestError(response.error, response.payload.code, response.payload.errors));
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
