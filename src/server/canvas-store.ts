/**
 * Canvas storage: one JSON file per canvas in a directory (default `.storybook/canvases/`).
 * Node only; independent of Storybook, so the preset's server channel and the MCP tools share it.
 *
 * Concurrency model. Writers are the browser (through the server channel), the MCP agent (in
 * process) and anyone editing the files directly (a person, git).
 * - Every change is an operation applied to the file's current contents, never a whole-canvas
 *   replace, so concurrent writers merge instead of overwriting each other.
 * - Operations on one canvas run one at a time inside this store. Each re-reads the file, applies
 *   the change, and before replacing the file checks that it still holds what was read; if someone
 *   else changed it in between, the operation re-runs on the new contents.
 * - Files are replaced atomically (write a temp file, then rename), so readers never see half a file.
 * - A file that does not validate is reported and never overwritten.
 * Use `getCanvasStore` so every caller in the process shares one instance (and one lock per canvas).
 */
import { type FSWatcher, watch as watchDirectory } from 'node:fs';
import { link, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { z } from 'zod';

import {
  anchorSchema,
  authorSchema,
  type CanvasFile,
  canvasIdFromName,
  commentSchema,
  createCanvasFile,
  createId,
  frameSchema,
  strokeSchema,
  isCanvasId,
  parseCanvasFile,
  pointSchema,
  reopenComment,
  resolveComment,
  serializeCanvasFile,
  validateCanvasFile,
} from '../canvas-file';
import type {
  CanvasChangeEvent,
  CanvasErrorCode,
  CanvasListing,
  CanvasOperation,
  CanvasOperationArgs,
  CanvasOperationResult,
  CanvasSummary,
  InvalidCanvas,
} from '../channel';

/** One method per `CanvasOperations` entry, plus change subscription and the file watcher. */
export type CanvasStoreOperations = {
  [Op in CanvasOperation]: CanvasOperationArgs<Op> extends void
    ? () => Promise<CanvasOperationResult<Op>>
    : (args: CanvasOperationArgs<Op>) => Promise<CanvasOperationResult<Op>>;
};

export interface CanvasStore extends CanvasStoreOperations {
  /** Absolute path of the canvas directory. */
  readonly dir: string;
  /**
   * Calls `listener` after every change: the store's own writes (`source: 'store'`) and, while
   * watching, edits made to the files by anything else (`source: 'external'`). Returns an unsubscribe function.
   */
  subscribe(listener: (event: CanvasChangeEvent) => void): () => void;
  /** Creates the directory if needed and starts watching it for external edits. Idempotent. */
  watch(): Promise<void>;
  /** Stops watching. Operations keep working. */
  close(): Promise<void>;
  /**
   * The heights the board last reported drawing this canvas's frames at (`reportRenderedHeights`),
   * by frame id. In memory only: empty until a browser has had the canvas open since the server started.
   */
  renderedHeights(canvasId: string): ReadonlyMap<string, number>;
}

export interface CanvasStoreOptions {
  /** Canvas directory; resolved against the current working directory. */
  dir: string;
  /** Clock for timestamps (tests). */
  now?: () => Date;
  /** How long to wait for a burst of file events to settle before reading the file. Default 30 ms. */
  watchDebounceMs?: number;
  /** @internal Test hook, called after an operation computed its result and before it checks the file and writes. */
  beforeCommit?: (canvasId: string) => Promise<void> | void;
}

/** Thrown by store operations; `code` is what the channel sends to the browser. */
export class CanvasStoreError extends Error {
  readonly code: CanvasErrorCode;
  readonly errors: string[];

  constructor(code: CanvasErrorCode, message: string, errors: string[] = []) {
    super(errors.length ? `${message}\n${errors.join('\n')}` : message);
    this.name = 'CanvasStoreError';
    this.code = code;
    this.errors = errors;
  }
}

const FILE_SUFFIX = '.json';
const MAX_COMMIT_ATTEMPTS = 5;

const stores = new Map<string, CanvasStore>();

/** The shared store for a directory, created on first use. The preset and the MCP tools both use this. */
export function getCanvasStore(options: CanvasStoreOptions): CanvasStore {
  const dir = resolve(options.dir);
  let store = stores.get(dir);
  if (!store) {
    store = createCanvasStore({ ...options, dir });
    stores.set(dir, store);
  }
  return store;
}

const frameInputSchema = frameSchema.omit({ id: true });
const frameChangesSchema = z
  .object({
    x: frameSchema.shape.x,
    y: frameSchema.shape.y,
    width: frameSchema.shape.width,
    height: frameSchema.shape.width.nullable(),
  })
  .partial();
/** Frames per report; a canvas with more frames than this is not realistic. */
const MAX_RENDERED_HEIGHTS = 1000;
const renderedHeightsSchema = z
  .record(z.string().min(1).max(200), z.number().positive().max(100_000).nullable())
  .refine((heights) => Object.keys(heights).length <= MAX_RENDERED_HEIGHTS, {
    message: `at most ${MAX_RENDERED_HEIGHTS} frames per report`,
  });
const bodySchema = z.string().trim().min(1);
const commentInputSchema = z.object({ author: authorSchema, body: bodySchema, anchor: anchorSchema });
const replyInputSchema = z.object({ author: authorSchema, body: bodySchema });
const strokeInputSchema = z.object({
  color: z.string().min(1),
  width: z.number().positive(),
  points: z.array(pointSchema).min(1),
});

/** Creates a store. Prefer `getCanvasStore`; two stores on one directory do not share locks. */
export function createCanvasStore(options: CanvasStoreOptions): CanvasStore {
  const dir = resolve(options.dir);
  const now = options.now ?? (() => new Date());
  const debounceMs = options.watchDebounceMs ?? 30;
  const listeners = new Set<(event: CanvasChangeEvent) => void>();
  const locks = new Map<string, Promise<unknown>>();
  /**
   * The last contents of each file that subscribers have been told about (`null`: deleted).
   * The watcher compares the file with this, so the store's own writes, and repeated events
   * for one edit, are not broadcast again.
   */
  const known = new Map<string, string | null>();
  /** Rendered frame heights by canvas id, then frame id (see `renderedHeights`). Never written to disk. */
  const rendered = new Map<string, Map<string, number>>();
  let watcher: FSWatcher | undefined;
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const pathOf = (id: string) => join(dir, `${id}${FILE_SUFFIX}`);

  function emit(event: CanvasChangeEvent) {
    pruneRendered(event);
    for (const listener of listeners) {
      try {
        listener(event);
      } catch (error) {
        console.error('[addon-colab] canvas change listener failed', error);
      }
    }
  }

  /**
   * Keeps rendered heights to frames that exist: a deleted or invalid canvas forgets all of them,
   * a changed one forgets frames it no longer has.
   */
  function pruneRendered(event: CanvasChangeEvent) {
    const heights = rendered.get(event.id);
    if (!heights) return;
    if (event.type !== 'changed') {
      rendered.delete(event.id);
      return;
    }
    const frameIds = new Set(event.canvas.frames.map((frame) => frame.id));
    for (const frameId of heights.keys()) if (!frameIds.has(frameId)) heights.delete(frameId);
    if (heights.size === 0) rendered.delete(event.id);
  }

  /** Runs `task` after every earlier task for the same canvas has finished. */
  function withLock<T>(id: string, task: () => Promise<T>): Promise<T> {
    const previous = locks.get(id) ?? Promise.resolve();
    const run = previous.then(task, task);
    const settled = run.then(
      () => undefined,
      () => undefined,
    );
    locks.set(id, settled);
    void settled.then(() => {
      if (locks.get(id) === settled) locks.delete(id);
    });
    return run;
  }

  function assertCanvasId(id: unknown): asserts id is string {
    if (typeof id !== 'string' || !isCanvasId(id)) {
      throw new CanvasStoreError('NOT_FOUND', `No canvas "${String(id)}": canvas ids are lowercase slugs`);
    }
  }

  /** A frame, comment or stroke id argument: missing or not a string is the caller's mistake. */
  function assertItemId(id: unknown, what: string): asserts id is string {
    if (typeof id !== 'string' || id.length === 0) {
      throw new CanvasStoreError('INVALID_INPUT', `${what} must be a non-empty string`);
    }
  }

  async function readText(id: string): Promise<string | null> {
    try {
      return await readFile(pathOf(id), 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  function parseFor(id: string, text: string): { ok: true; canvas: CanvasFile } | { ok: false; errors: string[] } {
    const result = parseCanvasFile(text);
    if (!result.ok) return result;
    if (result.canvas.id !== id) {
      return { ok: false, errors: [`id: "${result.canvas.id}" does not match the file name "${id}${FILE_SUFFIX}"`] };
    }
    return result;
  }

  async function load(id: string): Promise<{ text: string; canvas: CanvasFile }> {
    assertCanvasId(id);
    const text = await readText(id);
    if (text === null) throw new CanvasStoreError('NOT_FOUND', `No canvas "${id}"`);
    const result = parseFor(id, text);
    if (!result.ok) {
      throw new CanvasStoreError(
        'INVALID_FILE',
        `Canvas file ${id}${FILE_SUFFIX} is invalid and was not changed`,
        result.errors,
      );
    }
    return { text, canvas: result.canvas };
  }

  async function writeAtomic(id: string, text: string, { exclusive = false } = {}) {
    await mkdir(dir, { recursive: true });
    const tmp = join(dir, `.${id}${FILE_SUFFIX}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`);
    await writeFile(tmp, text, 'utf8');
    try {
      if (exclusive) {
        // link() fails if the target exists, so a concurrent create is never overwritten.
        await link(tmp, pathOf(id));
        // Then give the file its own inode: on macOS, fs.watch (here and in Storybook's index
        // watcher) never reports deleting a file that was created as a hard link.
        await writeAtomic(id, text);
      } else {
        await rename(tmp, pathOf(id));
      }
    } finally {
      await rm(tmp, { force: true });
    }
  }

  /**
   * Applies `change` to the current file and writes the result, re-running it if the file changed
   * while it was being computed.
   */
  function mutate<R>(
    canvasId: string,
    change: (canvas: CanvasFile) => { canvas: CanvasFile; result: R; unchanged?: boolean },
  ): Promise<{ canvas: CanvasFile; result: R }> {
    assertCanvasId(canvasId);
    return withLock(canvasId, async () => {
      for (let attempt = 0; attempt < MAX_COMMIT_ATTEMPTS; attempt++) {
        const { text, canvas } = await load(canvasId);
        const changed = change(structuredClone(canvas));
        // Nothing to change: no write, no event, `updatedAt` stays.
        if (changed.unchanged) return { canvas, result: changed.result };
        const next = finalize({ ...changed.canvas, updatedAt: now().toISOString() });
        const nextText = serializeCanvasFile(next);
        await options.beforeCommit?.(canvasId);
        if ((await readText(canvasId)) !== text) continue; // someone else wrote; redo on their version
        await writeAtomic(canvasId, nextText);
        known.set(canvasId, nextText);
        emit({ type: 'changed', id: canvasId, canvas: next, source: 'store' });
        return { canvas: next, result: changed.result };
      }
      throw new CanvasStoreError('CONFLICT', `Canvas "${canvasId}" kept changing on disk; nothing was written`);
    });
  }

  /** Validates a changed canvas; failures are the caller's fault, so they are `INVALID_INPUT`. */
  function finalize(canvas: CanvasFile): CanvasFile {
    const result = validateCanvasFile(canvas);
    if (!result.ok)
      throw new CanvasStoreError('INVALID_INPUT', 'The change would make the canvas invalid', result.errors);
    return result.canvas;
  }

  function parseInput<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
    const result = schema.safeParse(value);
    if (result.success) return result.data;
    throw new CanvasStoreError(
      'INVALID_INPUT',
      `Invalid ${what}`,
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }

  function findIndex<T extends { id: string }>(items: T[], id: string, what: string, canvasId: string): number {
    const index = items.findIndex((item) => item.id === id);
    if (index === -1) throw new CanvasStoreError('NOT_FOUND', `No ${what} "${id}" on canvas "${canvasId}"`);
    return index;
  }

  function summarize(canvas: CanvasFile): CanvasSummary {
    return {
      id: canvas.id,
      name: canvas.name,
      createdAt: canvas.createdAt,
      updatedAt: canvas.updatedAt,
      frameCount: canvas.frames.length,
      commentCount: canvas.comments.length,
      openCommentCount: canvas.comments.filter((comment) => comment.status === 'open').length,
    };
  }

  async function checkFile(id: string) {
    const text = await readText(id);
    if (text === known.get(id)) return;
    if (text === null) {
      known.set(id, null);
      emit({ type: 'deleted', id, source: 'external' });
      return;
    }
    known.set(id, text);
    const result = parseFor(id, text);
    emit(
      result.ok
        ? { type: 'changed', id, canvas: result.canvas, source: 'external' }
        : { type: 'invalid', id, errors: result.errors, source: 'external' },
    );
  }

  function scheduleCheck(id: string) {
    clearTimeout(timers.get(id));
    timers.set(
      id,
      setTimeout(() => {
        timers.delete(id);
        void withLock(id, () => checkFile(id)).catch((error) =>
          console.error(`[addon-colab] could not read canvas file ${id}${FILE_SUFFIX}`, error),
        );
      }, debounceMs),
    );
  }

  async function scheduleAll() {
    const names = new Set(known.keys());
    for (const file of await readdir(dir).catch(() => [] as string[])) {
      if (isCanvasFileName(file)) names.add(file.slice(0, -FILE_SUFFIX.length));
    }
    names.forEach(scheduleCheck);
  }

  const store: CanvasStore = {
    dir,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    async watch() {
      if (watcher) return;
      await mkdir(dir, { recursive: true });
      // Record what is on disk now so the first event for a file is compared with real contents.
      for (const file of await readdir(dir)) {
        if (!isCanvasFileName(file)) continue;
        const id = file.slice(0, -FILE_SUFFIX.length);
        if (!known.has(id)) known.set(id, await readText(id));
      }
      watcher = watchDirectory(dir, (_event, file) => {
        if (file == null) void scheduleAll();
        else if (isCanvasFileName(file.toString())) scheduleCheck(file.toString().slice(0, -FILE_SUFFIX.length));
      });
      watcher.on('error', (error) => console.error('[addon-colab] canvas directory watcher failed', error));
    },

    async close() {
      watcher?.close();
      watcher = undefined;
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    },

    async list() {
      let files: string[];
      try {
        files = await readdir(dir);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { canvases: [], invalid: [] };
        throw error;
      }
      const listing: CanvasListing = { canvases: [], invalid: [] };
      for (const file of files.filter((name) => name.endsWith(FILE_SUFFIX) && !name.startsWith('.')).sort()) {
        const id = file.slice(0, -FILE_SUFFIX.length);
        const invalid = (errors: string[]): InvalidCanvas => ({ id, file, errors });
        if (!isCanvasId(id)) {
          listing.invalid.push(
            invalid([`file name: "${id}" is not a canvas id (a lowercase slug such as "design-review")`]),
          );
          continue;
        }
        const text = await readText(id);
        if (text === null) continue; // deleted while listing
        const result = parseFor(id, text);
        if (result.ok) listing.canvases.push(summarize(result.canvas));
        else listing.invalid.push(invalid(result.errors));
      }
      listing.canvases.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
      return listing;
    },

    async get({ id }) {
      return (await load(id)).canvas;
    },

    async create({ name, id }) {
      const cleanName = parseInput(z.string().trim().min(1).max(200), name, 'canvas name');
      if (id !== undefined && (typeof id !== 'string' || !isCanvasId(id))) {
        throw new CanvasStoreError(
          'INVALID_INPUT',
          `Invalid canvas id ${JSON.stringify(id) ?? String(id)}: use a lowercase slug such as "design-review"`,
        );
      }
      const base = id ?? (canvasIdFromName(cleanName) || 'canvas');
      for (let n = 1; n < 1000; n++) {
        const candidate = n === 1 ? base : `${base}-${n}`;
        const canvas = createCanvasFile({ id: candidate, name: cleanName, now: now() });
        const text = serializeCanvasFile(canvas);
        const created = await withLock(candidate, async () => {
          try {
            await writeAtomic(candidate, text, { exclusive: true });
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
            throw error;
          }
          known.set(candidate, text);
          emit({ type: 'changed', id: candidate, canvas, source: 'store' });
          return true;
        });
        if (created) return canvas;
        if (id !== undefined) throw new CanvasStoreError('ALREADY_EXISTS', `A canvas with id "${id}" already exists`);
      }
      throw new CanvasStoreError('ALREADY_EXISTS', `Too many canvases named like "${base}"`);
    },

    async rename({ id, name }) {
      const cleanName = parseInput(z.string().trim().min(1).max(200), name, 'canvas name');
      return (await mutate(id, (canvas) => ({ canvas: { ...canvas, name: cleanName }, result: null }))).canvas;
    },

    async delete({ id }) {
      assertCanvasId(id);
      return withLock(id, async () => {
        try {
          await rm(pathOf(id));
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT')
            throw new CanvasStoreError('NOT_FOUND', `No canvas "${id}"`);
          throw error;
        }
        known.set(id, null);
        rendered.delete(id);
        emit({ type: 'deleted', id, source: 'store' });
        return { id };
      });
    },

    async addFrame({ canvasId, frame }) {
      const input = parseInput(frameInputSchema, frame, 'frame');
      const { canvas, result } = await mutate(canvasId, (current) => {
        const added = { id: createId('frame'), ...input };
        return { canvas: { ...current, frames: [...current.frames, added] }, result: added };
      });
      return { canvas, frame: result };
    },

    async updateFrame({ canvasId, frameId, changes }) {
      const input = parseInput(frameChangesSchema, changes, 'frame changes');
      const { canvas, result } = await mutate(canvasId, (current) => {
        const index = findIndex(current.frames, frameId, 'frame', canvasId);
        const { height, ...rest } = input;
        const updated = { ...current.frames[index]!, ...rest };
        if (height === null) delete updated.height;
        else if (height !== undefined) updated.height = height;
        const frames = current.frames.with(index, updated);
        return { canvas: { ...current, frames }, result: updated };
      });
      return { canvas, frame: result };
    },

    async removeFrame({ canvasId, frameId }) {
      const { canvas } = await mutate(canvasId, (current) => {
        findIndex(current.frames, frameId, 'frame', canvasId);
        return { canvas: { ...current, frames: current.frames.filter((f) => f.id !== frameId) }, result: null };
      });
      return { canvas };
    },

    async restoreFrame({ canvasId, frame, index }) {
      const input = parseInput(frameSchema, frame, 'frame');
      const at = index === undefined ? undefined : parseInput(z.number().int().min(0), index, 'index');
      const { canvas } = await mutate(canvasId, (current) => {
        if (current.frames.some((f) => f.id === input.id)) {
          throw new CanvasStoreError('ALREADY_EXISTS', `Frame "${input.id}" is already on canvas "${canvasId}"`);
        }
        const frames = current.frames.toSpliced(Math.min(at ?? current.frames.length, current.frames.length), 0, input);
        return { canvas: { ...current, frames }, result: null };
      });
      return { canvas, frame: input };
    },

    async raiseFrame({ canvasId, frameId }) {
      assertCanvasId(canvasId);
      assertItemId(frameId, 'frameId');
      // Already on top: answer without a write, so selecting the top frame never touches the file.
      // Decided under the canvas lock, so rapid clicks cannot write an unchanged order.
      const { canvas, result } = await mutate(canvasId, (current) => {
        const index = findIndex(current.frames, frameId, 'frame', canvasId);
        const raised = current.frames[index]!;
        if (index === current.frames.length - 1) return { canvas: current, result: raised, unchanged: true };
        return { canvas: { ...current, frames: [...current.frames.toSpliced(index, 1), raised] }, result: raised };
      });
      return { canvas, frame: result };
    },

    async addComment({ canvasId, comment }) {
      const input = parseInput(commentInputSchema, comment, 'comment');
      const { canvas, result } = await mutate(canvasId, (current) => {
        const added = {
          id: createId('comment'),
          author: input.author,
          body: input.body,
          status: 'open' as const,
          anchor: input.anchor,
          createdAt: now().toISOString(),
          replies: [],
        };
        return { canvas: { ...current, comments: [...current.comments, added] }, result: added };
      });
      return { canvas, comment: result };
    },

    async addReply({ canvasId, commentId, reply }) {
      const input = parseInput(replyInputSchema, reply, 'reply');
      const { canvas, result } = await mutate(canvasId, (current) => {
        const index = findIndex(current.comments, commentId, 'comment', canvasId);
        const added = { id: createId('reply'), ...input, createdAt: now().toISOString() };
        const target = current.comments[index]!;
        const updated = { ...target, replies: [...target.replies, added] };
        return {
          canvas: { ...current, comments: current.comments.with(index, updated) },
          result: { comment: updated, reply: added },
        };
      });
      return { canvas, ...result };
    },

    async resolveComment({ canvasId, commentId }) {
      const { canvas, result } = await mutate(canvasId, (current) => {
        const index = findIndex(current.comments, commentId, 'comment', canvasId);
        const target = current.comments[index]!;
        const updated = target.status === 'resolved' ? target : resolveComment(target, now());
        return { canvas: { ...current, comments: current.comments.with(index, updated) }, result: updated };
      });
      return { canvas, comment: result };
    },

    async reopenComment({ canvasId, commentId }) {
      const { canvas, result } = await mutate(canvasId, (current) => {
        const index = findIndex(current.comments, commentId, 'comment', canvasId);
        const updated = reopenComment(current.comments[index]!);
        return { canvas: { ...current, comments: current.comments.with(index, updated) }, result: updated };
      });
      return { canvas, comment: result };
    },

    async deleteComment({ canvasId, commentId }) {
      const { canvas } = await mutate(canvasId, (current) => {
        findIndex(current.comments, commentId, 'comment', canvasId);
        return { canvas: { ...current, comments: current.comments.filter((c) => c.id !== commentId) }, result: null };
      });
      return { canvas };
    },

    async restoreComment({ canvasId, comment, index }) {
      const input = parseInput(commentSchema, comment, 'comment');
      const at = index === undefined ? undefined : parseInput(z.number().int().min(0), index, 'index');
      const { canvas } = await mutate(canvasId, (current) => {
        if (current.comments.some((c) => c.id === input.id)) {
          throw new CanvasStoreError('ALREADY_EXISTS', `Comment "${input.id}" is already on canvas "${canvasId}"`);
        }
        const position = Math.min(at ?? current.comments.length, current.comments.length);
        return { canvas: { ...current, comments: current.comments.toSpliced(position, 0, input) }, result: null };
      });
      return { canvas, comment: input };
    },

    async addStroke({ canvasId, stroke }) {
      const input = parseInput(strokeInputSchema, stroke, 'stroke');
      const { canvas, result } = await mutate(canvasId, (current) => {
        const added = { id: createId('stroke'), ...input };
        return { canvas: { ...current, strokes: [...current.strokes, added] }, result: added };
      });
      return { canvas, stroke: result };
    },

    async removeStroke({ canvasId, strokeId }) {
      const { canvas } = await mutate(canvasId, (current) => {
        findIndex(current.strokes, strokeId, 'stroke', canvasId);
        return { canvas: { ...current, strokes: current.strokes.filter((s) => s.id !== strokeId) }, result: null };
      });
      return { canvas };
    },

    async removeStrokes({ canvasId, strokeIds }) {
      const ids = new Set(parseInput(z.array(z.string()), strokeIds, 'strokeIds'));
      assertCanvasId(canvasId);
      // None of them on the canvas (erased elsewhere): answer without a write.
      const existing = (await load(canvasId)).canvas;
      if (!existing.strokes.some((s) => ids.has(s.id))) return { canvas: existing, strokes: [] };
      const { canvas, result } = await mutate(canvasId, (current) => ({
        canvas: { ...current, strokes: current.strokes.filter((s) => !ids.has(s.id)) },
        result: current.strokes.filter((s) => ids.has(s.id)),
      }));
      return { canvas, strokes: result };
    },

    async restoreStrokes({ canvasId, strokes, index }) {
      const input = parseInput(z.array(strokeSchema), strokes, 'strokes');
      const at = index === undefined ? undefined : parseInput(z.number().int().min(0), index, 'index');
      assertCanvasId(canvasId);
      // Nothing to put back (a repeated undo): answer without a write.
      const existing = (await load(canvasId)).canvas;
      const missing = (canvas: CanvasFile) => {
        const present = new Set(canvas.strokes.map((s) => s.id));
        return input.filter((s) => {
          if (present.has(s.id)) return false;
          present.add(s.id);
          return true;
        });
      };
      if (missing(existing).length === 0) return { canvas: existing, strokes: [] };
      const { canvas, result } = await mutate(canvasId, (current) => {
        const restored = missing(current);
        const position = Math.min(at ?? current.strokes.length, current.strokes.length);
        return {
          canvas: { ...current, strokes: current.strokes.toSpliced(position, 0, ...restored) },
          result: restored,
        };
      });
      return { canvas, strokes: result };
    },

    async clearStrokes({ canvasId }) {
      assertCanvasId(canvasId);
      const existing = (await load(canvasId)).canvas;
      if (existing.strokes.length === 0) return { canvas: existing, strokes: [] };
      const { canvas, result } = await mutate(canvasId, (current) => ({
        canvas: { ...current, strokes: [] },
        result: current.strokes,
      }));
      return { canvas, strokes: result };
    },

    async reportRenderedHeights({ canvasId, heights, replace }) {
      assertCanvasId(canvasId);
      const input = parseInput(renderedHeightsSchema, heights, 'heights');
      // Under the canvas lock, so a delete or frame removal cannot slip in between the read and the update.
      return withLock(canvasId, async () => {
        // Only canvases that have a valid file, and only their frames: made-up ids store nothing.
        const { canvas } = await load(canvasId);
        const frameIds = new Set(canvas.frames.map((frame) => frame.id));
        const current = (replace === true ? undefined : rendered.get(canvasId)) ?? new Map<string, number>();
        for (const frameId of current.keys()) if (!frameIds.has(frameId)) current.delete(frameId);
        for (const [frameId, height] of Object.entries(input)) {
          if (height === null) current.delete(frameId);
          else if (frameIds.has(frameId)) current.set(frameId, Math.round(height));
        }
        if (current.size) rendered.set(canvasId, current);
        else rendered.delete(canvasId);
        return { canvasId };
      });
    },

    renderedHeights(canvasId) {
      return new Map(rendered.get(canvasId));
    },
  };

  return store;
}

/** `design-review.json`, not temp files (`.design-review.json.123.tmp`) or other files. */
function isCanvasFileName(file: string): boolean {
  return file.endsWith(FILE_SUFFIX) && !file.startsWith('.');
}
