/**
 * Canvases as sidebar entries (dev server only). Three pieces, wired up in `src/preset.ts`:
 *
 * 1. `canvasStoriesEntry`: adds `<canvasDir>/*.json` to the `stories` list, so Storybook indexes and
 *    watches the canvas files like story files.
 * 2. `createCanvasIndexer`: turns each canvas file into one story entry titled "Canvases". It never
 *    throws: a missing, malformed or invalid file becomes an entry marked invalid, because one error
 *    from an indexer makes `/index.json` fail and blanks the whole sidebar.
 * 3. `canvasVitePlugin`: serves each canvas file as an import-free CSF stub whose only story renders
 *    nothing. The canvas page itself is drawn by the addon's preview decorator
 *    (`src/canvas-page/decorator.ts`) when the story has the `colabCanvas` parameter. The stub never
 *    reads the file, so a broken file cannot break the preview, and store writes cause no reload.
 */
import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';

import type { Indexer, StoriesEntry, StoryIndexInput } from 'storybook/internal/types';
import type { Plugin } from 'vite';

import { parseCanvasFile } from '../canvas-file';
import {
  CANVAS_PARAMETER,
  CANVAS_TAG,
  CANVAS_TITLE,
  INVALID_CANVAS_TAG,
  canvasExportName,
  canvasMetaId,
} from '../canvas-entry';

const FILE_SUFFIX = '.json';

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Matches canvas files directly inside `dir` (absolute), on any path separator. Dotfiles (the
 * store's temp files are `.<id>.json.<pid>.<rand>.tmp`) and nested folders do not match.
 */
export function canvasFilePattern(dir: string): RegExp {
  const base = escapeRegExp(dir.replace(/[\\/]+$/, '')).replace(/\\\\|\//g, '[\\\\/]');
  return new RegExp(`^${base}[\\\\/][^\\\\/.][^\\\\/]*\\.json$`);
}

/** The canvas file id for a path: the file name without `.json`. */
export function canvasFileId(fileName: string): string {
  return basename(fileName.replace(/\\/g, '/'), FILE_SUFFIX);
}

/** The `stories` entry for the canvas directory. Creates the directory so the glob has something to watch. */
export function canvasStoriesEntry(dir: string): StoriesEntry {
  try {
    mkdirSync(dir, { recursive: true });
  } catch (error) {
    console.error(`[addon-colab] cannot create the canvas directory ${dir}`, error);
  }
  return { directory: dir, files: `*${FILE_SUFFIX}`, titlePrefix: '' };
}

/** What the indexer knows about one canvas file. Exported for tests. */
export type CanvasEntryInfo = { fileId: string; valid: true; name: string } | { fileId: string; valid: false };

/** Reads a canvas file for the sidebar. Never throws; `null` when the file is gone. */
export async function readCanvasEntryInfo(fileName: string): Promise<CanvasEntryInfo | null> {
  const fileId = canvasFileId(fileName);
  let text: string;
  try {
    text = await readFile(fileName, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    return { fileId, valid: false };
  }
  try {
    const result = parseCanvasFile(text);
    // Same rule as the store: the id inside the file must match its name.
    if (result.ok && result.canvas.id === fileId) return { fileId, valid: true, name: result.canvas.name };
  } catch {
    // parseCanvasFile reports problems as results; this is only a guard.
  }
  return { fileId, valid: false };
}

/** The index entry for a canvas file. Exported for tests. */
export function canvasIndexInput(fileName: string, info: CanvasEntryInfo): StoryIndexInput {
  return {
    type: 'story',
    importPath: fileName,
    exportName: canvasExportName(info.fileId),
    // Stable across renames: the id comes from the file name, the sidebar label from the canvas name.
    metaId: canvasMetaId(info.fileId),
    title: CANVAS_TITLE,
    name: info.valid ? info.name : `${info.fileId}${FILE_SUFFIX} (invalid)`,
    tags: [CANVAS_TAG, ...(info.valid ? [] : [INVALID_CANVAS_TAG]), '!autodocs', '!test'],
  };
}

/**
 * The indexer for canvas files in `dir`. With `published` (a `storybook build`) it claims canvas
 * files but indexes nothing: the project's own `stories` globs can still cover the canvas folder
 * (`./canvases/*.json`), and without an indexer for them Storybook would fail with "no matching
 * indexer". Canvases need the dev server, so a static build must not publish them as broken pages.
 */
export function createCanvasIndexer(dir: string, { published = false }: { published?: boolean } = {}): Indexer {
  return {
    test: canvasFilePattern(dir),
    createIndex: async (fileName) => {
      if (published) return [];
      try {
        const info = await readCanvasEntryInfo(fileName);
        return info ? [canvasIndexInput(fileName, info)] : [];
      } catch (error) {
        console.error(`[addon-colab] could not index ${fileName}`, error);
        return [];
      }
    },
  };
}

/** The CSF module served for a canvas file. Import-free: bare imports are not rewritten this late. */
export function canvasCsfStub(fileId: string): string {
  const meta = {
    id: canvasMetaId(fileId),
    title: CANVAS_TITLE,
    parameters: { layout: 'fullscreen', [CANVAS_PARAMETER]: fileId },
  };
  return [
    `export default ${JSON.stringify(meta)};`,
    `export const ${canvasExportName(fileId)} = { render: () => null };`,
  ].join('\n');
}

/** Vite plugin that serves canvas files in `dir` as CSF stubs. */
export function canvasVitePlugin(dir: string): Plugin {
  const pattern = canvasFilePattern(dir);
  const isCanvasFile = (id: string) => pattern.test(id.split('?')[0] ?? id);
  return {
    name: 'storybook-addon-colab:canvas-entries',
    enforce: 'post',
    // Resolve canvas files even once deleted: right after a delete, Storybook can regenerate its stories
    // module from an index that still lists the file, and an unresolvable import fails that module.
    resolveId: {
      order: 'pre',
      handler(source) {
        return isAbsolute(source) && isCanvasFile(source) ? source : null;
      },
    },
    // Load first with placeholder JSON so vite:json never parses the real (possibly broken) file.
    load: {
      order: 'pre',
      handler(id) {
        return isCanvasFile(id) ? '{}' : null;
      },
    },
    // After vite:json, swap the module for the CSF stub.
    transform(_code, id) {
      if (!isCanvasFile(id)) return null;
      return { code: canvasCsfStub(canvasFileId(id.split('?')[0] ?? id)), map: null };
    },
    // Store writes must not re-import the module (that would remount the board), and a deleted file
    // must not reload the preview. Storybook's own index watcher still updates the sidebar when a
    // canvas is added, renamed or removed.
    handleHotUpdate({ file }) {
      return isCanvasFile(file) ? [] : undefined;
    },
  };
}

/** Preset options these hooks read. */
type CanvasPresetOptions = { configType?: 'DEVELOPMENT' | 'PRODUCTION' };

/**
 * The preset hooks for canvas entries, given how the preset finds the canvas directory. Canvases
 * need the dev server (the store lives there), so `storybook build` gets no canvas entries at all
 * rather than pages that cannot load: the canvas folder is not added to `stories`, and the indexer
 * returns nothing even when the project's own globs cover the folder. The Vite plugin stays, so a
 * covered canvas file is still bundled as a harmless stub instead of being parsed as JSON.
 */
export function canvasEntryPresets<O extends CanvasPresetOptions>(dirFor: (options: O) => string) {
  return {
    stories: async (entries: StoriesEntry[] = [], options: O): Promise<StoriesEntry[]> =>
      options.configType === 'PRODUCTION' ? entries : [...entries, canvasStoriesEntry(dirFor(options))],
    experimental_indexers: async (existing: Indexer[] = [], options: O): Promise<Indexer[]> => [
      createCanvasIndexer(dirFor(options), { published: options.configType === 'PRODUCTION' }),
      ...existing,
    ],
    viteFinal: async <C extends { plugins?: unknown[] }>(config: C, options: O): Promise<C> => ({
      ...config,
      plugins: [...(config.plugins ?? []), canvasVitePlugin(dirFor(options))],
    }),
  };
}
