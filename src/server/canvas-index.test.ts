import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { toId } from 'storybook/internal/csf';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createCanvasFile, serializeCanvasFile } from '../canvas-file';
import { CANVAS_TAG, INVALID_CANVAS_TAG, canvasMetaId, canvasStoryId } from '../canvas-entry';
import {
  canvasCsfStub,
  canvasEntryPresets,
  canvasFilePattern,
  canvasVitePlugin,
  createCanvasIndexer,
} from './canvas-index';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'colab-index-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function write(name: string, text: string) {
  const file = join(dir, name);
  await writeFile(file, text, 'utf8');
  return file;
}

async function index(file: string) {
  return createCanvasIndexer(dir).createIndex(file, { makeTitle: (title?: string) => title ?? '' });
}

/** The id Storybook gives an index input, computed the way StoryIndexGenerator does. */
function storybookId(input: { metaId?: string; title?: string; exportName: string }) {
  return toId(input.metaId ?? input.title ?? '', input.exportName);
}

describe('canvas indexer', () => {
  it('turns a valid canvas into one "Canvases" entry named after the canvas', async () => {
    const file = await write(
      'design-review.json',
      serializeCanvasFile(createCanvasFile({ id: 'design-review', name: 'Design / Review' })),
    );
    const entries = await index(file);
    expect(entries).toHaveLength(1);
    const [entry] = entries;
    expect(entry).toMatchObject({
      type: 'story',
      importPath: file,
      title: 'Canvases',
      name: 'Design / Review',
      exportName: 'Canvas',
      metaId: 'colab-canvas-design-review',
    });
    expect(entry!.tags).toEqual([CANVAS_TAG, '!autodocs', '!test']);
    expect(storybookId(entry!)).toBe('colab-canvas-design-review--canvas');
    expect(storybookId(entry!)).toBe(canvasStoryId('design-review'));
  });

  it.each([
    ['malformed JSON', 'broken.json', '{ "schemaVersion": 1, '],
    ['a file that does not validate', 'broken.json', JSON.stringify({ schemaVersion: 1, id: 'broken' })],
    ['an unknown schema version', 'broken.json', JSON.stringify({ schemaVersion: 99, id: 'broken', name: 'x' })],
    [
      'an id that does not match the file name',
      'broken.json',
      serializeCanvasFile(createCanvasFile({ id: 'other', name: 'Other' })),
    ],
    ['an empty file', 'broken.json', ''],
    ['a JSON array', 'broken.json', '[]'],
  ])('never throws, and marks %s as invalid', async (_label, name, text) => {
    const file = await write(name, text);
    const entries = await index(file);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ name: 'broken.json (invalid)', exportName: 'Canvas', title: 'Canvases' });
    expect(entries[0]!.tags).toContain(INVALID_CANVAS_TAG);
    // A broken file keeps the URL it will have once fixed.
    expect(storybookId(entries[0]!)).toBe(canvasStoryId('broken'));
  });

  it('gives files whose name is not a canvas id a distinct, sanitised id', async () => {
    const a = await write('My Board.json', '{}');
    const b = await write('my-board .json', '{}');
    const [ea] = await index(a);
    const [eb] = await index(b);
    expect(ea).toMatchObject({ exportName: 'Invalid', name: 'My Board.json (invalid)' });
    expect(storybookId(ea!)).toBe(canvasStoryId('My Board'));
    expect(storybookId(ea!)).toMatch(/^colab-canvas-my-board-[a-z0-9]+--invalid$/);
    expect(storybookId(ea!)).not.toBe(storybookId(eb!));
    expect(storybookId(ea!)).not.toBe(canvasStoryId('my-board'));
  });

  it('returns no entry for a file that is gone', async () => {
    expect(await index(join(dir, 'gone.json'))).toEqual([]);
  });

  it('matches only canvas files directly inside the directory', () => {
    const pattern = canvasFilePattern(dir);
    expect(pattern.test(join(dir, 'a.json'))).toBe(true);
    expect(pattern.test(join(dir, 'My Board.json'))).toBe(true);
    expect(pattern.test(join(dir, '.a.json.123.abc.tmp'))).toBe(false);
    expect(pattern.test(join(dir, '.a.json'))).toBe(false);
    expect(pattern.test(join(dir, 'nested', 'a.json'))).toBe(false);
    expect(pattern.test(join(dir, 'a.json5'))).toBe(false);
    expect(pattern.test(join(`${dir}-other`, 'a.json'))).toBe(false);
    expect(pattern.test(`${dir}/a.json`.replace(/\//g, '\\'))).toBe(true);
  });
});

describe('canvas CSF stub', () => {
  it('has no imports and ids that match the index entry', async () => {
    for (const fileId of ['design-review', 'My Board']) {
      const code = canvasCsfStub(fileId);
      expect(code).not.toMatch(/\bimport\b/);
      const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
      const mod = await import(/* @vite-ignore */ url);
      const [exportName] = Object.keys(mod).filter((key) => key !== 'default');
      expect(mod.default.id).toBe(canvasMetaId(fileId));
      expect(mod.default.parameters).toEqual({ layout: 'fullscreen', colabCanvas: fileId });
      expect(toId(mod.default.id, exportName!)).toBe(canvasStoryId(fileId));
      expect(mod[exportName!].render()).toBeNull();
    }
  });

  it('serves canvas files as stubs without reading them and skips their hot updates', () => {
    const plugin = canvasVitePlugin(dir);
    const load = plugin.load as { handler: (id: string) => string | null };
    const transform = plugin.transform as (code: string, id: string) => { code: string } | null;
    const hot = plugin.handleHotUpdate as (ctx: { file: string }) => unknown;
    const file = join(dir, 'design-review.json');
    expect(load.handler(file)).toBe('{}');
    expect(load.handler(`${file}?t=123`)).toBe('{}');
    expect(load.handler(join(dir, '..', 'package.json'))).toBeNull();
    expect(transform('export default {}', file)!.code).toBe(canvasCsfStub('design-review'));
    expect(transform('x', join(dir, '..', 'package.json'))).toBeNull();
    expect(hot({ file })).toEqual([]);
    expect(hot({ file: join(dir, '..', 'x.ts') })).toBeUndefined();
    expect(hot({ file: join(dir, 'gone.json') })).toEqual([]);
    const resolve = plugin.resolveId as { handler: (source: string) => string | null };
    expect(resolve.handler(join(dir, 'gone.json'))).toBe(join(dir, 'gone.json'));
    expect(resolve.handler('./gone.json')).toBeNull();
    expect(resolve.handler(join(dir, '..', 'x.json'))).toBeNull();
  });
});

describe('canvas entries in a static build', () => {
  const presets = () => canvasEntryPresets<{ configType?: 'DEVELOPMENT' | 'PRODUCTION' }>(() => dir);

  it('indexes canvas files on the dev server', async () => {
    const file = await write('board.json', serializeCanvasFile(createCanvasFile({ id: 'board', name: 'Board' })));
    const [indexer] = await presets().experimental_indexers([], { configType: 'DEVELOPMENT' });
    expect(await indexer!.createIndex(file, { makeTitle: (title?: string) => title ?? '' })).toHaveLength(1);
    expect(await presets().stories([], { configType: 'DEVELOPMENT' })).toHaveLength(1);
  });

  it('adds no stories entry and indexes nothing, even for files a project glob covers', async () => {
    const file = await write('board.json', serializeCanvasFile(createCanvasFile({ id: 'board', name: 'Board' })));
    const broken = await write('broken.json', '{');
    expect(await presets().stories([], { configType: 'PRODUCTION' })).toEqual([]);
    const [indexer] = await presets().experimental_indexers([], { configType: 'PRODUCTION' });
    // Still claims the files, so Storybook does not fail with "no matching indexer".
    expect(indexer!.test.test(file)).toBe(true);
    for (const fileName of [file, broken]) {
      expect(await indexer!.createIndex(fileName, { makeTitle: (title?: string) => title ?? '' })).toEqual([]);
    }
  });
});
