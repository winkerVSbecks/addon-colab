// A frame whose story no longer exists (task 6a): a short message with a Remove button and a
// readable title, not Storybook's HMR error text.
// Rewrites $CANVAS_DIR/board.json. Run: SB=http://127.0.0.1:6170 CANVAS_DIR=.sb-6a/canvases node scripts/check-board-missing.mjs [screenshot.png]
import { readFileSync, writeFileSync } from 'node:fs';

import { BASE_CANVAS, CANVAS_FILE, SB, check, done, launch, previewFrame, setView } from './board-lib.mjs';

const read = () => JSON.parse(readFileSync(CANVAS_FILE, 'utf8'));
writeFileSync(
  CANVAS_FILE,
  JSON.stringify(
    {
      ...BASE_CANVAS,
      frames: [
        BASE_CANVAS.frames[0],
        { id: 'frame_gone', storyId: 'example-gone--no-longer-here', x: 420, y: 0, width: 360 },
      ],
    },
    null,
    2,
  ) + '\n',
);
await new Promise((resolve) => setTimeout(resolve, 600));

const { browser, page, errors } = await launch({ dpr: 2 });
await page.goto(`${SB}/`);
await setView(page, 'board', { x: 60, y: 60, zoom: 1 });
await page.goto(`${SB}/?path=/story/colab-canvas-board--canvas`);
await page.waitForFunction(() => document.querySelector('#storybook-preview-iframe')?.contentDocument?.querySelector('[data-colab-frame-missing]'), null, { timeout: 20000 });
await page.waitForTimeout(500);
const preview = previewFrame(page);

const gone = preview.locator('[data-colab-frame="frame_gone"]');
const text = (await gone.textContent()) ?? '';
check('missing story shows the short message', text.includes('This story no longer exists'), text);
check('… with the story id, and none of the HMR error text', text.includes('example-gone--no-longer-here') && !/HMR|Couldn't find/i.test(text), text);
const title = await preview.locator('[data-colab-frame-title="frame_gone"]').textContent();
check('missing story has a readable title', title === 'Example Gone / No Longer Here', title);
check('other stories still render', (await preview.locator('[data-colab-frame="frame_btn"] button').count()) === 1);

if (process.argv[2]) await page.screenshot({ path: process.argv[2] });

await gone.locator('button', { hasText: 'Remove' }).click();
await page.waitForTimeout(800);
check('Remove takes the frame off the canvas file', !read().frames.some((f) => f.id === 'frame_gone'), read().frames.map((f) => f.id));
check('… and offers Undo', (await preview.locator('[data-colab-board-notice] button').textContent()) === 'Undo');

const serious = errors.filter((e) => !/example-gone/.test(e));
check('no unexpected page errors', serious.length === 0, serious);
await browser.close();
done();
