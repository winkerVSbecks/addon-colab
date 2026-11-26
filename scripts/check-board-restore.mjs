// A story whose file is deleted and restored while its canvas is open comes back on the board by
// itself, every time, without a page reload. Runs $CYCLES (default 30) delete/restore cycles of
// scripts/fixtures/RestoreProbe.stories.tsx (a copy of the example Button stories that only the
// check Storybook loads) with gaps from 0.2 s to 5 s. The file is put back on exit, error or
// interrupt (guardFile), and the runner also restores scripts/fixtures from git.
//
// It also counts the cycles in which a load hit a stale map of story files ("importers[path] is not
// a function"), so the output shows that case happened. Usually Storybook's next update fixes the
// map on its own; in about one cycle in ten none follows, and before the board reloaded the map
// itself (stories-module.ts) the story stayed on that error until the page was reloaded.
// Writes $CANVAS_DIR/restore.json. Run with `pnpm check:browser restore`.
import { writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { SB, check, done, guardFile, launch, previewFrame, setView, waitForBoard } from './board-lib.mjs';

const CANVAS_DIR = process.env.CANVAS_DIR;
if (!CANVAS_DIR) throw new Error('CANVAS_DIR is not set; run with `pnpm check:browser restore`');
const PROBE = fileURLToPath(new URL('./fixtures/RestoreProbe.stories.tsx', import.meta.url));
const { source, restore } = guardFile(PROBE);
const CYCLES = Number(process.env.CYCLES ?? 30);
/** Gaps between delete and restore (ms), repeated as needed; most are over 1.5 s, where it used to stick. */
const GAPS = [200, 1500, 2000, 5000, 1800, 500, 2500, 3000, 1600, 4000, 2000, 1000, 2200, 3500, 1700];
/** How long a restored story may take to come back. The board's own timed retries alone take 23 s. */
const RECOVER_WITHIN = 15_000;

writeFileSync(
  resolve(CANVAS_DIR, 'restore.json'),
  JSON.stringify(
    {
      schemaVersion: 1,
      id: 'restore',
      name: 'Restore',
      createdAt: '2026-11-25T00:00:00.000Z',
      updatedAt: '2026-11-25T00:00:00.000Z',
      frames: [
        { id: 'frame_probe', storyId: 'checks-restore-probe--primary', x: 0, y: 0, width: 360 },
        { id: 'frame_other', storyId: 'example-button--secondary', x: 0, y: 200, width: 360 },
      ],
      comments: [],
      strokes: [],
    },
    null,
    2,
  ) + '\n',
);
await new Promise((r) => setTimeout(r, 800));

/**
 * In the preview iframe, before any of its scripts: records page loads and story loads that failed
 * because the map of story files was stale, in sessionStorage so they survive the reloads Vite does.
 * Loads of the story id in `restore-check:fail` fail (to show the error card's Retry).
 */
function instrument() {
  if (!location.pathname.endsWith('/iframe.html')) return;
  const bump = (key) => sessionStorage.setItem(key, String(Number(sessionStorage.getItem(key) ?? 0) + 1));
  bump('restore-check:loads');
  window.__restoreCheckWrap = (value) => {
    if (value.__restoreCheckWrapped) return;
    value.__restoreCheckWrapped = true;
    const loadStory = value.loadStory.bind(value);
    value.loadStory = async (...args) => {
      if (sessionStorage.getItem('restore-check:fail') === args[0]?.storyId) throw new Error('Simulated load failure');
      try {
        return await loadStory(...args);
      } catch (error) {
        if (/importers\[[^\]]*\] is not a function/.test(String(error?.message))) bump('restore-check:stale');
        throw error;
      }
    };
  };
  let preview;
  Object.defineProperty(window, '__STORYBOOK_PREVIEW__', {
    configurable: true,
    get: () => preview,
    set(value) {
      preview = value;
      window.__restoreCheckWrap(value);
    },
  });
}

const { browser, context, page, errors } = await launch({ dpr: 1 });
await context.addInitScript(instrument);
/** Reads and clears the counters. */
const counters = () =>
  previewFrame(page).evaluate(() => {
    const read = (key) => Number(sessionStorage.getItem(key) ?? 0);
    const result = { loads: read('restore-check:loads'), stale: read('restore-check:stale') };
    sessionStorage.removeItem('restore-check:loads');
    sessionStorage.removeItem('restore-check:stale');
    return result;
  });
const probeState = () =>
  page.evaluate(() => {
    const doc = document.querySelector('#storybook-preview-iframe')?.contentDocument;
    const frame = doc?.querySelector('[data-colab-frame="frame_probe"]');
    if (!frame) return 'no frame';
    if (frame.querySelector('[data-colab-frame-missing]')) return 'missing';
    const alert = frame.querySelector('[role=alert]');
    if (alert) return `error: ${alert.textContent}`;
    return frame.querySelector('button')?.textContent === 'Restore probe' ? 'ready' : 'loading';
  });

const results = [];
try {
  await page.goto(`${SB}/`);
  await setView(page, 'restore', { x: 60, y: 60, zoom: 1 });
  await page.goto(`${SB}/?path=/story/colab-canvas-restore--canvas`);
  await waitForBoard(page, 2);
  check('the probe story renders', (await probeState()) === 'ready', await probeState());
  await counters();

  for (let cycle = 0; cycle < CYCLES; cycle++) {
    const gap = GAPS[cycle % GAPS.length];
    rmSync(PROBE);
    await page.waitForTimeout(gap);
    writeFileSync(PROBE, source);
    const restoredAt = Date.now();
    let state = await probeState();
    while (state !== 'ready' && Date.now() - restoredAt < RECOVER_WITHIN) {
      await page.waitForTimeout(100);
      state = await probeState();
    }
    const ms = Date.now() - restoredAt;
    // Let Storybook settle, then read what happened in this cycle.
    await page.waitForTimeout(800);
    const { loads, stale } = await counters();
    results.push({ cycle: cycle + 1, gap, state, ms, pageLoads: loads, stale: stale > 0 });
    console.log(
      `  cycle ${cycle + 1} gap ${gap} ms: ${state} after ${ms} ms` +
        `${loads ? `, preview reloaded by Vite ×${loads}` : ''}${stale ? ', a load hit a stale map of story files' : ''}`,
    );
    if (state !== 'ready') break;
  }
  const recovered = results.filter((result) => result.state === 'ready').length;
  check(
    `every delete/restore cycle comes back without a reload by the user (${recovered} of ${CYCLES})`,
    recovered === CYCLES,
    results.find((result) => result.state !== 'ready'),
  );
  const staleCycles = results.filter((result) => result.stale).length;
  console.log(`  (the map of story files went stale in ${staleCycles} of ${results.length} cycles)`);
  // The error card's Retry: the probe's loads fail (until the check allows them again) when its
  // file comes back, so the frame shows the error card; Retry then renders it.
  await previewFrame(page).evaluate(() => {
    sessionStorage.setItem('restore-check:fail', 'checks-restore-probe--primary');
    window.__restoreCheckWrap?.(window.__STORYBOOK_PREVIEW__);
  });
  rmSync(PROBE);
  await page.waitForTimeout(2000);
  writeFileSync(PROBE, source);
  await page.waitForFunction(
    () =>
      !!document
        .querySelector('#storybook-preview-iframe')
        ?.contentDocument?.querySelector('[data-colab-frame="frame_probe"] [data-colab-frame-error] button'),
    null,
    { timeout: 30000 },
  );
  const card = await probeState();
  check('a story that fails to load shows an error card with Retry', /Simulated load failure.*Retry/.test(card), card);
  await previewFrame(page).evaluate(() => sessionStorage.removeItem('restore-check:fail'));
  await previewFrame(page).locator('[data-colab-frame="frame_probe"] [data-colab-frame-error] button').click();
  await page.waitForTimeout(1000);
  check('… and Retry renders it once it loads', (await probeState()) === 'ready', await probeState());

  check(
    'the other story on the board is unaffected',
    await previewFrame(page).evaluate(
      () => document.querySelector('[data-colab-frame="frame_other"] button')?.textContent === 'Button',
    ),
  );

  // Expected noise: the probe's own missing/failed loads, and Storybook's Vite hot-update handler
  // (vite-app.js) calling onStoriesChanged while Vite reloads the page, before the preview has
  // initialised (an unhandled rejection in Storybook's code, not the board's).
  const serious = errors.filter(
    (e) =>
      !/restore-probe|RestoreProbe|Simulated load failure|Couldn't find story|after HMR|importers\[path\]|Failed to fetch dynamically imported module|404|onStoriesChanged\(\)` before initialization/i.test(
        e,
      ),
  );
  check('no unexpected page errors', serious.length === 0, serious);
} finally {
  restore();
  await browser.close();
}
done();
