// Frame heights are never written by the board on its own: opening a canvas and leaving it alone
// does not change its file, a story that disappears and comes back returns to its own height, a
// stored height (the user's resize) still acts as a minimum, and the agent sees the heights the
// board draws (MCP get_canvas `renderedHeight`). Deletes and restores scripts/fixtures/HeightProbe.stories.tsx
// (put back on exit, error or interrupt by guardFile; the runner also restores it from git).
// Writes $CANVAS_DIR/heights.json. Run with `pnpm check:browser heights`.
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SB, check, done, guardFile, launch, previewFrame, setView, waitForBoard } from './board-lib.mjs';

const CANVAS_DIR = process.env.CANVAS_DIR;
if (!CANVAS_DIR) throw new Error('CANVAS_DIR is not set; run with `pnpm check:browser heights`');
const FILE = resolve(CANVAS_DIR, 'heights.json');
const PROBE = fileURLToPath(new URL('./fixtures/HeightProbe.stories.tsx', import.meta.url));
const { source: probeSource, restore: restoreProbe } = guardFile(PROBE);
const BELOW_Y = 90;

const canvas = {
  schemaVersion: 1,
  id: 'heights',
  name: 'Heights',
  createdAt: '2026-11-25T00:00:00.000Z',
  updatedAt: '2026-11-25T00:00:00.000Z',
  frames: [
    { id: 'frame_probe', storyId: 'checks-height-probe--default', x: 0, y: 0, width: 360 },
    { id: 'frame_below', storyId: 'example-button--primary', x: 0, y: BELOW_Y, width: 360 },
    // A file written before this fix, or a frame the user resized: the stored height is a minimum.
    { id: 'frame_legacy', storyId: 'example-button--secondary', x: 500, y: 0, width: 240, height: 150 },
  ],
  comments: [],
  strokes: [],
};
const text = JSON.stringify(canvas, null, 2) + '\n';
writeFileSync(FILE, text);
const unchanged = () => readFileSync(FILE, 'utf8') === text;

async function mcpCanvas() {
  const response = await fetch(`${SB}/colab/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/call',
      params: { name: 'get_canvas', arguments: { canvasId: 'heights' } },
    }),
  });
  const json = await response.json();
  if (json.error || json.result?.isError) throw new Error(JSON.stringify(json));
  return JSON.parse(json.result.content[0].text);
}
const mcpFrame = async (id) => (await mcpCanvas()).frames.find((frame) => frame.frameId === id);

await new Promise((r) => setTimeout(r, 800));
const { browser, page, errors } = await launch({ dpr: 2 });
try {
  await page.goto(`${SB}/`);
  await setView(page, 'heights', { x: 60, y: 60, zoom: 1 });
  await page.goto(`${SB}/?path=/story/colab-canvas-heights--canvas`);
  await waitForBoard(page, 3);
  const preview = previewFrame(page);
  const heightOf = (id) =>
    preview.evaluate((id) => document.querySelector(`[data-colab-frame="${id}"]`).offsetHeight, id);
  const missingShown = () =>
    preview.evaluate(() => !!document.querySelector('[data-colab-frame="frame_probe"] [data-colab-frame-missing]'));

  await page.waitForTimeout(2500);
  const original = await heightOf('frame_probe');
  check(
    'the probe frame is as tall as its content and clear of the frame below',
    original > 20 && original < BELOW_Y,
    original,
  );
  check(
    'a stored height still acts as a minimum',
    (await heightOf('frame_legacy')) >= 150,
    await heightOf('frame_legacy'),
  );
  check('opening the canvas and waiting does not change its file', unchanged());

  const before = await mcpCanvas();
  const probe = before.frames.find((frame) => frame.frameId === 'frame_probe');
  check('the agent sees the drawn height', probe?.renderedHeight === original && probe.height === undefined, probe);
  check('… and the stored minimum separately', (await mcpFrame('frame_legacy'))?.height === 150);
  check('… with no "assumed height" note once every frame is measured', before.note === undefined, before.note);

  rmSync(PROBE);
  await page.waitForFunction(
    () =>
      !!document
        .querySelector('#storybook-preview-iframe')
        ?.contentDocument?.querySelector('[data-colab-frame="frame_probe"] [data-colab-frame-missing]'),
    null,
    { timeout: 60000 },
  );
  await page.waitForTimeout(2500);
  const missingHeight = await heightOf('frame_probe');
  check(
    'the missing-story card shows (taller than the story)',
    (await missingShown()) && missingHeight > original,
    missingHeight,
  );
  check('… and its height is not written to the file', unchanged());
  const whileMissing = await mcpFrame('frame_probe');
  check(
    '… and the agent no longer gets a height for it',
    whileMissing && whileMissing.renderedHeight === undefined,
    whileMissing,
  );

  writeFileSync(PROBE, probeSource);
  await page.waitForFunction(
    () => {
      const doc = document.querySelector('#storybook-preview-iframe')?.contentDocument;
      const frame = doc?.querySelector('[data-colab-frame="frame_probe"]');
      return frame && !frame.querySelector('[data-colab-frame-missing]') && frame.textContent.includes('Height probe');
    },
    null,
    { timeout: 60000 },
  );
  await page.waitForTimeout(2500);
  const restored = await heightOf('frame_probe');
  check('after the story file comes back the frame returns to its own height', restored === original, {
    restored,
    original,
  });
  check('… clear of the frame below', restored < BELOW_Y, restored);
  check('… and the file is still unchanged', unchanged());
  check('the agent gets the height again', (await mcpFrame('frame_probe'))?.renderedHeight === original);

  const serious = errors.filter(
    (e) =>
      !/height-probe|HeightProbe|Couldn't find story|after HMR|Failed to fetch dynamically imported module|404/i.test(
        e,
      ),
  );
  check('no unexpected page errors', serious.length === 0, serious);
} finally {
  restoreProbe();
  await browser.close();
}
await new Promise((r) => setTimeout(r, 1000));
check('closing the canvas leaves its file unchanged', unchanged());
done();
