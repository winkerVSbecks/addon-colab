// Opening a canvas and leaving it alone does not change its file. Copies the committed example
// canvases (.storybook/canvases/*.json as committed in git HEAD, never the working copies) into
// $CANVAS_DIR, opens each one, waits for its stories to render and settle, closes it, and compares.
// Run with `pnpm check:browser examples`.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SB, check, done, launch, setView, waitForBoard } from './board-lib.mjs';

const CANVAS_DIR = process.env.CANVAS_DIR;
if (!CANVAS_DIR) throw new Error('CANVAS_DIR is not set; run with `pnpm check:browser examples`');
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' });

const examples = git('ls-tree', '--name-only', 'HEAD', '.storybook/canvases/')
  .split('\n')
  .filter((path) => path.endsWith('.json'));
check('there are committed example canvases', examples.length > 0, examples);

const copies = examples.map((path) => {
  const text = git('show', `HEAD:${path}`);
  const canvas = JSON.parse(text);
  const file = resolve(CANVAS_DIR, `${canvas.id}.json`);
  writeFileSync(file, text);
  return { id: canvas.id, file, text, frames: canvas.frames.length };
});
await new Promise((r) => setTimeout(r, 1000));

const { browser, page, errors } = await launch({ dpr: 2 });
try {
  for (const { id, file, text, frames } of copies) {
    await page.goto(`${SB}/`);
    await setView(page, id, { x: 60, y: 60, zoom: 0.5 });
    await page.goto(`${SB}/?path=/story/colab-canvas-${id}--canvas`);
    await waitForBoard(page, frames);
    await page.waitForTimeout(3000);
    check(`${id}: open for 3 s, the file is unchanged`, readFileSync(file, 'utf8') === text);
    await page.goto(`${SB}/?path=/story/example-button--primary`);
    await page.waitForTimeout(1000);
    check(`${id}: after closing it, the file is unchanged`, readFileSync(file, 'utf8') === text);
  }
  check('no page errors', errors.length === 0, errors);
} finally {
  await browser.close();
}
done();
