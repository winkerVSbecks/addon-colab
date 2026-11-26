import { mkdtemp, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type ElementAnchor, parseCanvasFile, serializeCanvasFile } from '../canvas-file';
import type { CanvasChangeEvent } from '../channel';
import { type CanvasStore, createCanvasStore, getCanvasStore, CanvasStoreError } from './canvas-store';

const T0 = new Date('2026-11-25T10:00:00.000Z');

let dir: string;
let clock: Date;
let store: CanvasStore;

const now = () => clock;
const tick = () => (clock = new Date(clock.getTime() + 1000));
const fileOf = (id: string) => join(dir, `${id}.json`);
const readCanvasText = (id: string) => readFile(fileOf(id), 'utf8');

const elementAnchor: ElementAnchor = {
  type: 'element',
  frameId: 'frame-1',
  target: {
    storyId: 'example-header--logged-out',
    title: 'Example/Header',
    importPath: './src/stories/Header.stories.ts',
    selector: 'button:nth-of-type(1)',
    html: '<button>Log in</button>',
    text: 'Log in',
  },
};

async function expectStoreError(promise: Promise<unknown>, code: string) {
  const error = await promise.then(
    () => undefined,
    (e: unknown) => e,
  );
  expect(error).toBeInstanceOf(CanvasStoreError);
  expect((error as CanvasStoreError).code).toBe(code);
  return error as CanvasStoreError;
}

/** Collects change events; `next()` waits for the next one matching `filter`. */
function recorder(target: CanvasStore) {
  const events: CanvasChangeEvent[] = [];
  const waiters: { filter: (e: CanvasChangeEvent) => boolean; resolve: (e: CanvasChangeEvent) => void }[] = [];
  const unsubscribe = target.subscribe((event) => {
    events.push(event);
    for (const waiter of [...waiters]) {
      if (waiter.filter(event)) {
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(event);
      }
    }
  });
  return {
    events,
    unsubscribe,
    next(filter: (e: CanvasChangeEvent) => boolean = () => true, timeout = 2000) {
      return new Promise<CanvasChangeEvent>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('timed out waiting for a change event')), timeout);
        waiters.push({
          filter,
          resolve: (e) => {
            clearTimeout(timer);
            resolve(e);
          },
        });
      });
    },
  };
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'colab-store-'));
  clock = T0;
  store = createCanvasStore({ dir, now });
});

afterEach(async () => {
  await store.close();
  await rm(dir, { recursive: true, force: true });
});

describe('canvases', () => {
  it('lists nothing when the directory does not exist yet', async () => {
    const missing = createCanvasStore({ dir: join(dir, 'nope') });
    expect(await missing.list()).toEqual({ canvases: [], invalid: [] });
  });

  it('creates a canvas file named after a slug of the name, formatted by serializeCanvasFile', async () => {
    const canvas = await store.create({ name: 'Sprint 12 review!' });
    expect(canvas).toMatchObject({ id: 'sprint-12-review', name: 'Sprint 12 review!', createdAt: T0.toISOString() });
    const text = await readCanvasText('sprint-12-review');
    expect(text).toBe(serializeCanvasFile(canvas));
    expect(text).toContain('\n  "schemaVersion": 1,\n');
  });

  it('creates the canvas directory on demand', async () => {
    const nested = createCanvasStore({ dir: join(dir, 'a', 'b'), now });
    await nested.create({ name: 'Deep' });
    expect(await readdir(join(dir, 'a', 'b'))).toEqual(['deep.json']);
  });

  it('appends a number when the slug is taken, and rejects a taken explicit id', async () => {
    await store.create({ name: 'Review' });
    expect((await store.create({ name: 'Review' })).id).toBe('review-2');
    expect((await store.create({ name: 'review' })).id).toBe('review-3');
    await expectStoreError(store.create({ name: 'Other', id: 'review' }), 'ALREADY_EXISTS');
    expect((await store.create({ name: 'Other', id: 'other-id' })).id).toBe('other-id');
  });

  it('gives concurrent creates of the same name distinct ids', async () => {
    const created = await Promise.all(Array.from({ length: 5 }, () => store.create({ name: 'Same' })));
    expect(new Set(created.map((c) => c.id)).size).toBe(5);
    expect((await store.list()).canvases).toHaveLength(5);
  });

  it('falls back to "canvas" when the name has no usable characters', async () => {
    expect((await store.create({ name: '!!!' })).id).toBe('canvas');
  });

  it('rejects an empty name and a malformed id', async () => {
    await expectStoreError(store.create({ name: '   ' }), 'INVALID_INPUT');
    await expectStoreError(store.create({ name: 'Ok', id: '../escape' }), 'INVALID_INPUT');
  });

  it('lists canvases sorted by name with counts', async () => {
    await store.create({ name: 'Zeta' });
    const alpha = await store.create({ name: 'Alpha' });
    await store.addFrame({ canvasId: alpha.id, frame: { storyId: 'a--b', x: 0, y: 0, width: 100 } });
    const { comment } = await store.addComment({
      canvasId: alpha.id,
      comment: { author: 'user', body: 'one', anchor: { type: 'position', x: 0, y: 0 } },
    });
    await store.addComment({ canvasId: alpha.id, comment: { author: 'user', body: 'two', anchor: elementAnchor } });
    await store.resolveComment({ canvasId: alpha.id, commentId: comment.id });

    const { canvases, invalid } = await store.list();
    expect(invalid).toEqual([]);
    expect(canvases.map((c) => c.name)).toEqual(['Alpha', 'Zeta']);
    expect(canvases[0]).toMatchObject({ id: 'alpha', frameCount: 1, commentCount: 2, openCommentCount: 1 });
  });

  it('gets a canvas, or NOT_FOUND', async () => {
    const created = await store.create({ name: 'Board' });
    expect(await store.get({ id: 'board' })).toEqual(created);
    await expectStoreError(store.get({ id: 'missing' }), 'NOT_FOUND');
    await expectStoreError(store.get({ id: '../etc/passwd' }), 'NOT_FOUND');
  });

  it('renames without changing the id and bumps updatedAt', async () => {
    await store.create({ name: 'Old' });
    tick();
    const renamed = await store.rename({ id: 'old', name: 'New name' });
    expect(renamed).toMatchObject({
      id: 'old',
      name: 'New name',
      createdAt: T0.toISOString(),
      updatedAt: clock.toISOString(),
    });
    expect(parseCanvasFile(await readCanvasText('old'))).toEqual({ ok: true, canvas: renamed });
    await expectStoreError(store.rename({ id: 'old', name: '' }), 'INVALID_INPUT');
  });

  it('deletes a canvas file', async () => {
    await store.create({ name: 'Gone' });
    expect(await store.delete({ id: 'gone' })).toEqual({ id: 'gone' });
    expect(await readdir(dir)).toEqual([]);
    await expectStoreError(store.delete({ id: 'gone' }), 'NOT_FOUND');
  });

  it('leaves no temp files behind', async () => {
    await store.create({ name: 'Clean' });
    await store.rename({ id: 'clean', name: 'Still clean' });
    expect(await readdir(dir)).toEqual(['clean.json']);
  });
});

describe('frames', () => {
  beforeEach(async () => {
    await store.create({ name: 'Board' });
  });

  it('adds, moves, resizes and removes frames', async () => {
    const { frame } = await store.addFrame({
      canvasId: 'board',
      frame: { storyId: 'example-button--primary', x: 10, y: 20, width: 300 },
    });
    expect(frame).toMatchObject({ storyId: 'example-button--primary', x: 10, y: 20, width: 300 });
    expect(frame.id).toMatch(/^frame-/);

    const moved = await store.updateFrame({
      canvasId: 'board',
      frameId: frame.id,
      changes: { x: -5, y: 7, height: 120 },
    });
    expect(moved.frame).toEqual({ ...frame, x: -5, y: 7, height: 120 });

    const auto = await store.updateFrame({ canvasId: 'board', frameId: frame.id, changes: { height: null } });
    expect(auto.frame).not.toHaveProperty('height');
    expect((await store.get({ id: 'board' })).frames).toEqual([auto.frame]);

    const removed = await store.removeFrame({ canvasId: 'board', frameId: frame.id });
    expect(removed.canvas.frames).toEqual([]);
  });

  it('keeps comments anchored to a removed frame', async () => {
    const { frame } = await store.addFrame({ canvasId: 'board', frame: { storyId: 's--a', x: 0, y: 0, width: 10 } });
    await store.addComment({
      canvasId: 'board',
      comment: { author: 'user', body: 'hi', anchor: { type: 'frame', frameId: frame.id, storyId: 's--a' } },
    });
    const { canvas } = await store.removeFrame({ canvasId: 'board', frameId: frame.id });
    expect(canvas.comments).toHaveLength(1);
  });

  it('restores a removed frame with the same id, position, size and place in the order', async () => {
    const add = (storyId: string, x: number) =>
      store.addFrame({ canvasId: 'board', frame: { storyId, x, y: 5, width: 100, height: 50 } });
    const a = (await add('s--a', 0)).frame;
    const b = (await add('s--b', 200)).frame;
    const c = (await add('s--c', 400)).frame;
    await store.removeFrame({ canvasId: 'board', frameId: b.id });

    const restored = await store.restoreFrame({ canvasId: 'board', frame: b, index: 1 });
    expect(restored.frame).toEqual(b);
    expect(restored.canvas.frames).toEqual([a, b, c]);
    expect((await store.get({ id: 'board' })).frames).toEqual([a, b, c]);

    // Without an index (or with one past the end) the frame goes on top.
    await store.removeFrame({ canvasId: 'board', frameId: a.id });
    expect((await store.restoreFrame({ canvasId: 'board', frame: a })).canvas.frames).toEqual([b, c, a]);
    await store.removeFrame({ canvasId: 'board', frameId: b.id });
    expect((await store.restoreFrame({ canvasId: 'board', frame: b, index: 99 })).canvas.frames).toEqual([c, a, b]);
  });

  it('does not restore a frame that is on the canvas, or an invalid one', async () => {
    const { frame } = await store.addFrame({ canvasId: 'board', frame: { storyId: 's--a', x: 0, y: 0, width: 10 } });
    await expectStoreError(store.restoreFrame({ canvasId: 'board', frame }), 'ALREADY_EXISTS');
    await expectStoreError(
      store.restoreFrame({ canvasId: 'board', frame: { ...frame, id: 'frame-new', width: 0 } }),
      'INVALID_INPUT',
    );
    await expectStoreError(
      store.restoreFrame({ canvasId: 'board', frame: { ...frame, id: 'frame-new' }, index: -1 }),
      'INVALID_INPUT',
    );
    expect((await store.get({ id: 'board' })).frames).toEqual([frame]);
  });

  it('raises a frame to the end of the stacking order, and writes nothing when it is already there', async () => {
    const add = (storyId: string) => store.addFrame({ canvasId: 'board', frame: { storyId, x: 0, y: 0, width: 100 } });
    const a = (await add('s--a')).frame;
    const b = (await add('s--b')).frame;
    const c = (await add('s--c')).frame;

    const raised = await store.raiseFrame({ canvasId: 'board', frameId: a.id });
    expect(raised.frame).toEqual(a);
    expect(raised.canvas.frames).toEqual([b, c, a]);

    tick();
    const before = await readCanvasText('board');
    const again = await store.raiseFrame({ canvasId: 'board', frameId: a.id });
    expect(again.canvas.updatedAt).toBe(raised.canvas.updatedAt);
    expect(again.canvas.frames).toEqual([b, c, a]);
    expect(await readCanvasText('board')).toBe(before);

    await expectStoreError(store.raiseFrame({ canvasId: 'board', frameId: 'frame-x' }), 'NOT_FOUND');
    await expectStoreError(
      store.raiseFrame({ canvasId: 'board', frameId: undefined as unknown as string }),
      'INVALID_INPUT',
    );
    await expectStoreError(store.raiseFrame({ canvasId: 'board', frameId: '' }), 'INVALID_INPUT');
  });

  it('raises once when the same frame is raised many times at once (rapid clicks)', async () => {
    const add = (storyId: string) => store.addFrame({ canvasId: 'board', frame: { storyId, x: 0, y: 0, width: 100 } });
    const a = (await add('s--a')).frame;
    const b = (await add('s--b')).frame;
    const writes: CanvasChangeEvent[] = [];
    const unsubscribe = store.subscribe((event) => writes.push(event));
    tick();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => store.raiseFrame({ canvasId: 'board', frameId: a.id })),
    );
    unsubscribe();
    expect(writes).toHaveLength(1);
    expect(results.every((result) => result.canvas.frames.map((f) => f.id).join() === [b.id, a.id].join())).toBe(true);
  });

  it('rejects invalid frames and unknown ids', async () => {
    await expectStoreError(
      store.addFrame({ canvasId: 'board', frame: { storyId: 's', x: 0, y: 0, width: -1 } }),
      'INVALID_INPUT',
    );
    await expectStoreError(
      store.updateFrame({ canvasId: 'board', frameId: 'frame-x', changes: { x: 1 } }),
      'NOT_FOUND',
    );
    await expectStoreError(store.removeFrame({ canvasId: 'board', frameId: 'frame-x' }), 'NOT_FOUND');
    await expectStoreError(
      store.addFrame({ canvasId: 'nope', frame: { storyId: 's', x: 0, y: 0, width: 1 } }),
      'NOT_FOUND',
    );
  });
});

describe('comments', () => {
  beforeEach(async () => {
    await store.create({ name: 'Board' });
  });

  it('adds a comment, replies, resolves, reopens and deletes', async () => {
    tick();
    const { comment } = await store.addComment({
      canvasId: 'board',
      comment: { author: 'user', body: '  Make this bigger  ', anchor: elementAnchor },
    });
    expect(comment).toMatchObject({
      author: 'user',
      body: 'Make this bigger',
      status: 'open',
      anchor: elementAnchor,
      createdAt: clock.toISOString(),
      replies: [],
    });

    tick();
    const replied = await store.addReply({
      canvasId: 'board',
      commentId: comment.id,
      reply: { author: 'agent', body: 'Done' },
    });
    expect(replied.reply).toMatchObject({ author: 'agent', body: 'Done', createdAt: clock.toISOString() });
    expect(replied.comment.replies).toEqual([replied.reply]);

    tick();
    const resolved = await store.resolveComment({ canvasId: 'board', commentId: comment.id });
    expect(resolved.comment).toMatchObject({ status: 'resolved', resolvedAt: clock.toISOString() });
    const resolvedAgain = await store.resolveComment({ canvasId: 'board', commentId: comment.id });
    expect(resolvedAgain.comment.resolvedAt).toBe(resolved.comment.resolvedAt);

    const reopened = await store.reopenComment({ canvasId: 'board', commentId: comment.id });
    expect(reopened.comment.status).toBe('open');
    expect(reopened.comment).not.toHaveProperty('resolvedAt');

    const deleted = await store.deleteComment({ canvasId: 'board', commentId: comment.id });
    expect(deleted.canvas.comments).toEqual([]);
  });

  it('rejects bad comment input and unknown comments', async () => {
    await expectStoreError(
      store.addComment({ canvasId: 'board', comment: { author: 'user', body: ' ', anchor: elementAnchor } }),
      'INVALID_INPUT',
    );
    await expectStoreError(
      store.addComment({
        canvasId: 'board',
        // @ts-expect-error: invalid author on purpose
        comment: { author: 'robot', body: 'x', anchor: elementAnchor },
      }),
      'INVALID_INPUT',
    );
    await expectStoreError(
      store.addReply({ canvasId: 'board', commentId: 'comment-x', reply: { author: 'agent', body: 'x' } }),
      'NOT_FOUND',
    );
    await expectStoreError(store.resolveComment({ canvasId: 'board', commentId: 'comment-x' }), 'NOT_FOUND');
    await expectStoreError(store.reopenComment({ canvasId: 'board', commentId: 'comment-x' }), 'NOT_FOUND');
    await expectStoreError(store.deleteComment({ canvasId: 'board', commentId: 'comment-x' }), 'NOT_FOUND');
  });

  it('restores a deleted comment with its id, replies, status and place (undo of delete)', async () => {
    await store.create({ name: 'Board' });
    const first = (
      await store.addComment({ canvasId: 'board', comment: { author: 'user', body: 'a', anchor: elementAnchor } })
    ).comment;
    const second = (
      await store.addComment({ canvasId: 'board', comment: { author: 'agent', body: 'b', anchor: elementAnchor } })
    ).comment;
    await store.addReply({ canvasId: 'board', commentId: first.id, reply: { author: 'agent', body: 'r' } });
    const full = (await store.resolveComment({ canvasId: 'board', commentId: first.id })).comment;
    await store.deleteComment({ canvasId: 'board', commentId: first.id });

    const restored = await store.restoreComment({ canvasId: 'board', comment: full, index: 0 });
    expect(restored.comment).toEqual(full);
    expect(restored.canvas.comments).toEqual([full, second]);
    await expectStoreError(store.restoreComment({ canvasId: 'board', comment: full }), 'ALREADY_EXISTS');
    await expectStoreError(
      store.restoreComment({ canvasId: 'board', comment: { ...full, id: 'comment-new', body: '' } }),
      'INVALID_INPUT',
    );
    await expectStoreError(store.restoreComment({ canvasId: 'board', comment: full, index: -1 }), 'INVALID_INPUT');
    await store.deleteComment({ canvasId: 'board', commentId: full.id });
    expect((await store.restoreComment({ canvasId: 'board', comment: full, index: 99 })).canvas.comments).toEqual([
      second,
      full,
    ]);
  });
});

describe('strokes', () => {
  it('adds and removes strokes, keeping points on one line in the file', async () => {
    await store.create({ name: 'Board' });
    const { stroke } = await store.addStroke({
      canvasId: 'board',
      stroke: {
        color: '#f00',
        width: 2,
        points: [
          [0, 0],
          [10, 5],
        ],
      },
    });
    expect(stroke.id).toMatch(/^stroke-/);
    expect(await readCanvasText('board')).toContain('"points": [[0,0],[10,5]]');
    await expectStoreError(
      store.addStroke({ canvasId: 'board', stroke: { color: '#f00', width: 2, points: [] } }),
      'INVALID_INPUT',
    );
    const { canvas } = await store.removeStroke({ canvasId: 'board', strokeId: stroke.id });
    expect(canvas.strokes).toEqual([]);
    await expectStoreError(store.removeStroke({ canvasId: 'board', strokeId: stroke.id }), 'NOT_FOUND');
  });

  it('restores strokes with their ids at an index, skipping ones already there', async () => {
    await store.create({ name: 'Board' });
    const add = async (x: number) =>
      (await store.addStroke({ canvasId: 'board', stroke: { color: '#f00', width: 2, points: [[x, 0]] } })).stroke;
    const a = await add(1);
    const b = await add(2);
    const c = await add(3);
    await store.removeStroke({ canvasId: 'board', strokeId: b.id });

    const restored = await store.restoreStrokes({ canvasId: 'board', strokes: [b], index: 1 });
    expect(restored.strokes).toEqual([b]);
    expect(restored.canvas.strokes).toEqual([a, b, c]);
    expect((await store.get({ id: 'board' })).strokes).toEqual([a, b, c]);

    // Already there: nothing is written.
    const again = await store.restoreStrokes({ canvasId: 'board', strokes: [b, b] });
    expect(again.strokes).toEqual([]);
    expect(again.canvas.updatedAt).toBe(restored.canvas.updatedAt);

    // Without an index (or past the end) they go last; duplicates in the input count once.
    await store.removeStroke({ canvasId: 'board', strokeId: a.id });
    const last = await store.restoreStrokes({ canvasId: 'board', strokes: [a, a, c], index: 99 });
    expect(last.strokes).toEqual([a]);
    expect(last.canvas.strokes).toEqual([b, c, a]);

    await expectStoreError(
      store.restoreStrokes({ canvasId: 'board', strokes: [{ ...a, id: 'stroke-new', points: [] }] }),
      'INVALID_INPUT',
    );
    await expectStoreError(store.restoreStrokes({ canvasId: 'board', strokes: [a], index: -1 }), 'INVALID_INPUT');
    await expectStoreError(store.restoreStrokes({ canvasId: 'nope', strokes: [a] }), 'NOT_FOUND');
  });

  it('clears all strokes and returns them, so a clear can be undone', async () => {
    await store.create({ name: 'Board' });
    const a = (await store.addStroke({ canvasId: 'board', stroke: { color: '#f00', width: 2, points: [[0, 0]] } }))
      .stroke;
    const b = (await store.addStroke({ canvasId: 'board', stroke: { color: '#00f', width: 4, points: [[1, 1]] } }))
      .stroke;
    const cleared = await store.clearStrokes({ canvasId: 'board' });
    expect(cleared.strokes).toEqual([a, b]);
    expect(cleared.canvas.strokes).toEqual([]);

    const empty = await store.clearStrokes({ canvasId: 'board' });
    expect(empty.strokes).toEqual([]);
    expect(empty.canvas.updatedAt).toBe(cleared.canvas.updatedAt);

    const back = await store.restoreStrokes({ canvasId: 'board', strokes: cleared.strokes, index: 0 });
    expect(back.canvas.strokes).toEqual([a, b]);
  });

  it('removes several strokes in one write and returns the removed ones', async () => {
    await store.create({ name: 'Board' });
    const add = async (x: number) =>
      (await store.addStroke({ canvasId: 'board', stroke: { color: '#f00', width: 2, points: [[x, x]] } })).stroke;
    const [a, b, c] = [await add(0), await add(1), await add(2)];
    const writes: string[] = [];
    const unsubscribe = store.subscribe((event) => writes.push(event.type));
    const removed = await store.removeStrokes({ canvasId: 'board', strokeIds: [c.id, a.id, 'stroke-gone', a.id] });
    unsubscribe();
    expect(writes).toEqual(['changed']);
    expect(removed.strokes).toEqual([a, c]);
    expect(removed.canvas.strokes).toEqual([b]);

    const none = await store.removeStrokes({ canvasId: 'board', strokeIds: [a.id] });
    expect(none.strokes).toEqual([]);
    expect(none.canvas.updatedAt).toBe(removed.canvas.updatedAt);

    await expectStoreError(store.removeStrokes({ canvasId: 'board', strokeIds: [1] as never }), 'INVALID_INPUT');
    await expectStoreError(store.removeStrokes({ canvasId: 'nope', strokeIds: [a.id] }), 'NOT_FOUND');
  });
});

describe('invalid files', () => {
  it('reports corrupt and mismatched files in the list and never overwrites them', async () => {
    await store.create({ name: 'Good' });
    await writeFile(fileOf('broken'), '{ "schemaVersion": 1, ');
    await writeFile(fileOf('other'), serializeCanvasFile({ ...(await store.get({ id: 'good' })), id: 'good' }));
    await writeFile(join(dir, 'Not A Slug.json'), '{}');
    await writeFile(join(dir, 'notes.txt'), 'ignored');

    const { canvases, invalid } = await store.list();
    expect(canvases.map((c) => c.id)).toEqual(['good']);
    expect(invalid.map((i) => i.file)).toEqual(['Not A Slug.json', 'broken.json', 'other.json']);
    expect(invalid[1]!.errors[0]).toMatch(/^invalid JSON/);
    expect(invalid[2]!.errors[0]).toMatch(/does not match the file name/);

    const error = await expectStoreError(store.get({ id: 'broken' }), 'INVALID_FILE');
    expect(error.errors[0]).toMatch(/^invalid JSON/);
    await expectStoreError(store.rename({ id: 'broken', name: 'Fixed' }), 'INVALID_FILE');
    await expectStoreError(
      store.addFrame({ canvasId: 'broken', frame: { storyId: 's', x: 0, y: 0, width: 1 } }),
      'INVALID_FILE',
    );
    expect(await readCanvasText('broken')).toBe('{ "schemaVersion": 1, ');
  });

  it('reports a file with another schemaVersion', async () => {
    const canvas = await store.create({ name: 'Old' });
    await writeFile(fileOf('old'), JSON.stringify({ ...canvas, schemaVersion: 2 }));
    const error = await expectStoreError(store.get({ id: 'old' }), 'INVALID_FILE');
    expect(error.errors[0]).toMatch(/unsupported version 2/);
  });
});

describe('concurrent writers', () => {
  it('keeps every change when many operations run at once', async () => {
    await store.create({ name: 'Board' });
    await Promise.all([
      ...Array.from({ length: 10 }, (_, i) =>
        store.addComment({
          canvasId: 'board',
          comment: { author: i % 2 ? 'agent' : 'user', body: `c${i}`, anchor: elementAnchor },
        }),
      ),
      ...Array.from({ length: 10 }, (_, i) =>
        store.addFrame({ canvasId: 'board', frame: { storyId: `s--${i}`, x: i, y: i, width: 10 } }),
      ),
      store.rename({ id: 'board', name: 'Renamed' }),
    ]);
    const canvas = await store.get({ id: 'board' });
    expect(canvas.name).toBe('Renamed');
    expect(canvas.comments.map((c) => c.body).sort()).toEqual(Array.from({ length: 10 }, (_, i) => `c${i}`).sort());
    expect(canvas.frames).toHaveLength(10);
  });

  it('shares one store per directory through getCanvasStore', () => {
    expect(getCanvasStore({ dir })).toBe(getCanvasStore({ dir: `${dir}/.` }));
  });

  it('re-applies its change when the file is edited by hand mid-operation', async () => {
    let edited = false;
    const racing = createCanvasStore({
      dir,
      now,
      beforeCommit: async (id) => {
        if (edited) return;
        edited = true;
        // A person renames the canvas in their editor while the store is adding a frame.
        const canvas = parseCanvasFile(await readCanvasText(id));
        if (!canvas.ok) throw new Error('fixture');
        await writeFile(fileOf(id), serializeCanvasFile({ ...canvas.canvas, name: 'Hand edit' }));
      },
    });
    await racing.create({ name: 'Board' });
    const { canvas } = await racing.addFrame({ canvasId: 'board', frame: { storyId: 's--a', x: 0, y: 0, width: 10 } });
    expect(canvas.name).toBe('Hand edit');
    expect(canvas.frames).toHaveLength(1);
    expect(await racing.get({ id: 'board' })).toEqual(canvas);
  });

  it('gives up with CONFLICT, writing nothing, if the file never stops changing', async () => {
    let n = 0;
    const racing = createCanvasStore({
      dir,
      now,
      beforeCommit: async (id) => {
        const canvas = parseCanvasFile(await readCanvasText(id));
        if (!canvas.ok) throw new Error('fixture');
        await writeFile(fileOf(id), serializeCanvasFile({ ...canvas.canvas, name: `Edit ${++n}` }));
      },
    });
    await racing.create({ name: 'Board' });
    await expectStoreError(racing.rename({ id: 'board', name: 'Mine' }), 'CONFLICT');
    expect((await racing.get({ id: 'board' })).name).toBe(`Edit ${n}`);
  });
});

describe('change events', () => {
  it('notifies subscribers of the store’s own writes', async () => {
    const rec = recorder(store);
    const canvas = await store.create({ name: 'Board' });
    const { canvas: renamed } = { canvas: await store.rename({ id: 'board', name: 'B' }) };
    await store.delete({ id: 'board' });
    expect(rec.events).toEqual([
      { type: 'changed', id: 'board', canvas, source: 'store' },
      { type: 'changed', id: 'board', canvas: renamed, source: 'store' },
      { type: 'deleted', id: 'board', source: 'store' },
    ]);
    rec.unsubscribe();
    await store.create({ name: 'Quiet' });
    expect(rec.events).toHaveLength(3);
  });

  describe('while watching', () => {
    beforeEach(async () => {
      await store.watch();
    });

    it('broadcasts an external edit once', async () => {
      const canvas = await store.create({ name: 'Board' });
      const rec = recorder(store);
      const edited = { ...canvas, name: 'Edited by hand' };
      await writeFile(fileOf('board'), serializeCanvasFile(edited));
      expect(await rec.next()).toEqual({ type: 'changed', id: 'board', canvas: edited, source: 'external' });
      await delay(150);
      expect(rec.events).toHaveLength(1);
    });

    it('broadcasts a canvas file added by hand', async () => {
      const rec = recorder(store);
      const other = createCanvasStore({ dir, now }); // e.g. another process
      const canvas = await other.create({ name: 'From elsewhere' });
      expect(await rec.next()).toEqual({ type: 'changed', id: canvas.id, canvas, source: 'external' });
    });

    it('does not re-broadcast its own writes as external edits', async () => {
      const rec = recorder(store);
      await store.create({ name: 'Board' });
      for (let i = 0; i < 5; i++) {
        await store.addFrame({ canvasId: 'board', frame: { storyId: `s--${i}`, x: 0, y: 0, width: 10 } });
      }
      await store.delete({ id: 'board' });
      await delay(200);
      expect(rec.events.map((e) => e.source)).toEqual(Array(7).fill('store'));
    });

    it('broadcasts an external delete', async () => {
      await store.create({ name: 'Board' });
      const rec = recorder(store);
      await unlink(fileOf('board'));
      expect(await rec.next()).toEqual({ type: 'deleted', id: 'board', source: 'external' });
    });

    it('broadcasts an external delete of a canvas created a while ago', async () => {
      // On macOS, fs.watch never reported deleting a file the store had created as a hard link;
      // the immediate delete above only passed because the create's own events were still arriving.
      await store.create({ name: 'Board' });
      await delay(300);
      const rec = recorder(store);
      await unlink(fileOf('board'));
      expect(await rec.next()).toEqual({ type: 'deleted', id: 'board', source: 'external' });
    });

    it('broadcasts a corrupt external edit as invalid, then the fix', async () => {
      const canvas = await store.create({ name: 'Board' });
      const rec = recorder(store);
      await writeFile(fileOf('board'), '{ oops');
      const invalid = await rec.next();
      expect(invalid).toMatchObject({ type: 'invalid', id: 'board', source: 'external' });
      expect((invalid as { errors: string[] }).errors[0]).toMatch(/^invalid JSON/);

      await writeFile(fileOf('board'), serializeCanvasFile(canvas));
      expect(await rec.next()).toEqual({ type: 'changed', id: 'board', canvas, source: 'external' });
    });

    it('ignores temp and non-canvas files', async () => {
      const rec = recorder(store);
      await writeFile(join(dir, '.board.json.1.abc.tmp'), 'x');
      await writeFile(join(dir, 'readme.txt'), 'x');
      await delay(200);
      expect(rec.events).toEqual([]);
    });

    it('stops watching after close', async () => {
      const canvas = await store.create({ name: 'Board' });
      await store.close();
      const rec = recorder(store);
      await writeFile(fileOf('board'), serializeCanvasFile({ ...canvas, name: 'Unseen' }));
      await delay(200);
      expect(rec.events).toEqual([]);
    });
  });
});

describe('rendered heights', () => {
  it('keeps reported heights in memory without touching the file or emitting a change', async () => {
    await store.create({ name: 'Board' });
    const { frame } = await store.addFrame({
      canvasId: 'board',
      frame: { storyId: 'example-button--primary', x: 0, y: 0, width: 240 },
    });
    const before = await readCanvasText('board');
    const rec = recorder(store);
    tick();
    expect(await store.reportRenderedHeights({ canvasId: 'board', heights: { [frame.id]: 67.6 } })).toEqual({
      canvasId: 'board',
    });
    expect(store.renderedHeights('board')).toEqual(new Map([[frame.id, 68]]));
    expect(await readCanvasText('board')).toBe(before);
    expect(rec.events).toEqual([]);
    rec.unsubscribe();
  });

  it('merges reports, forgets a frame on null and clears on delete', async () => {
    await store.create({ name: 'Board' });
    await store.reportRenderedHeights({ canvasId: 'board', heights: { a: 68, b: 63 } });
    await store.reportRenderedHeights({ canvasId: 'board', heights: { a: null, c: 400 } });
    expect(store.renderedHeights('board')).toEqual(
      new Map([
        ['b', 63],
        ['c', 400],
      ]),
    );
    await store.delete({ id: 'board' });
    expect(store.renderedHeights('board').size).toBe(0);
  });

  it('forgets earlier heights on a replacing report', async () => {
    await store.reportRenderedHeights({ canvasId: 'board', heights: { a: 68, b: 63 } });
    await store.reportRenderedHeights({ canvasId: 'board', heights: { c: 10 }, replace: true });
    expect(store.renderedHeights('board')).toEqual(new Map([['c', 10]]));
    await store.reportRenderedHeights({ canvasId: 'board', heights: {}, replace: true });
    expect(store.renderedHeights('board').size).toBe(0);
  });

  it('returns a copy, and an empty map for an unknown canvas', async () => {
    await store.reportRenderedHeights({ canvasId: 'board', heights: { a: 68 } });
    (store.renderedHeights('board') as Map<string, number>).set('a', 1);
    expect(store.renderedHeights('board').get('a')).toBe(68);
    expect(store.renderedHeights('other').size).toBe(0);
  });

  it('rejects malformed reports', async () => {
    await expectStoreError(store.reportRenderedHeights({ canvasId: 'board', heights: { a: -1 } }), 'INVALID_INPUT');
    await expectStoreError(
      store.reportRenderedHeights({ canvasId: 'board', heights: { a: Infinity } }),
      'INVALID_INPUT',
    );
    await expectStoreError(
      store.reportRenderedHeights({ canvasId: 'board', heights: 'tall' as unknown as Record<string, number> }),
      'INVALID_INPUT',
    );
    await expectStoreError(store.reportRenderedHeights({ canvasId: 'Not A Slug', heights: {} }), 'NOT_FOUND');
    expect(store.renderedHeights('board').size).toBe(0);
  });
});
