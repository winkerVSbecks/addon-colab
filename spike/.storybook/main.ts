import { readFile } from 'node:fs/promises';

import { defineMain } from '@storybook/react-vite/node';

// Spike-only Storybook: real example stories + the Board experiment. Run: pnpm storybook dev -c spike/.storybook -p 6116
//
// Sidebar-entry experiment (Storybook 11): every spike/canvases/*.json file becomes one sidebar entry.
// An indexer reads the file for the title; a Vite transform turns the JSON module into a tiny CSF
// module whose only story is a stub; a preview decorator renders the board for it. The real canvas files live in
// .storybook/canvases/ and have no special suffix, so the match is on the directory.
const CANVAS_FILE = /[\\/]canvases[\\/][^\\/]+\.json$/;

export default defineMain({
  stories: ['../../src/stories/*.stories.ts', '../stories/*.stories.tsx', '../canvases/*.json'],
  addons: [],
  framework: '@storybook/react-vite',
  experimental_indexers: async (existing) => [
    {
      test: CANVAS_FILE,
      createIndex: async (fileName) => {
        const canvas = JSON.parse(await readFile(fileName, 'utf8'));
        return [
          {
            type: 'story',
            importPath: fileName,
            exportName: 'Canvas',
            title: `Canvases/${canvas.name}`,
            // A stable id from the canvas id, so renaming a canvas keeps its URL. The CSF meta must
            // carry the same id.
            metaId: `canvas-${canvas.id}`,
            name: canvas.name,
            tags: ['canvas', '!autodocs', '!test'],
          },
        ];
      },
    },
    ...(existing ?? []),
  ],
  viteFinal: (config) => ({
    ...config,
    plugins: [
      ...(config.plugins ?? []),
      {
        // Runs after vite:json, so it replaces the JSON module with CSF. The module only depends on the
        // id and name, so the board can decide itself how to react to file changes.
        name: 'spike-canvas-csf',
        enforce: 'post',
        // Without this, every write to a canvas file (the store writes on each edit) re-imports the
        // module and remounts the board. Storybook's own index watcher still updates the sidebar.
        handleHotUpdate({ file }: { file: string }) {
          return CANVAS_FILE.test(file) ? [] : undefined;
        },
        async transform(_code: string, id: string) {
          const file = id.split('?')[0];
          if (!CANVAS_FILE.test(file)) return null;
          const canvas = JSON.parse(await readFile(file, 'utf8'));
          return {
            // No imports: after vite:json, bare specifiers are no longer rewritten. The board itself
            // comes from a preview decorator (spike/.storybook/preview.tsx; in the addon, its preview
            // entry) that renders it when parameters.colabCanvas is set.
            code: [
              `export default { id: ${JSON.stringify(`canvas-${canvas.id}`)}, title: ${JSON.stringify(`Canvases/${canvas.name}`)}, parameters: { layout: 'fullscreen', colabCanvas: ${JSON.stringify(canvas.id)} } };`,
              `export const Canvas = { name: ${JSON.stringify(canvas.name)}, render: () => null };`,
            ].join('\n'),
            map: null,
          };
        },
      },
    ],
  }),
});
