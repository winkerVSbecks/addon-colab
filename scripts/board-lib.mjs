// Shared helpers for the board browser checks. They drive the installed Chrome through
// playwright-core (a dev dependency): Playwright's bundled Chromium has no HTML-in-Canvas.
// Run them all with `pnpm check:browser` (scripts/run-browser-checks.mjs), which starts a throwaway
// Storybook with its own config and canvas folder and sets $SB and $CANVAS_DIR for each check.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { chromium } from 'playwright-core';

export { chromium };

export const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
export const SB = process.env.SB ?? 'http://127.0.0.1:6160';

let failures = 0;
export function check(name, ok, detail) {
  if (ok) console.log(`  ok   ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name}${detail === undefined ? '' : `: ${JSON.stringify(detail)}`}`);
  }
}
export function done() {
  console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
  process.exitCode = failures ? 1 : 0;
}

export async function launch({ headless = true, dpr = 2, colorScheme = 'light', width = 1400, height = 900 } = {}) {
  const browser = await chromium.launch({ executablePath: CHROME, headless });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: dpr, colorScheme });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));
  return { browser, context, page, errors };
}

export function previewFrame(page) {
  return page.frames().find((frame) => frame.url().includes('/iframe.html'));
}

/** Waits for the board and every frame's story to have rendered. */
export async function waitForBoard(page, frameCount) {
  await page.waitForFunction(
    (count) => {
      const doc = document.querySelector('#storybook-preview-iframe')?.contentDocument;
      const board = doc?.querySelector('[data-colab-board]');
      if (!board || board.style.visibility === 'hidden') return false;
      const frames = [...doc.querySelectorAll('[data-colab-frame]')];
      return frames.length === count && frames.every((frame) => frame.textContent.trim().length > 0);
    },
    frameCount,
    { timeout: 20000 },
  );
  await page.waitForTimeout(300);
}

/** Board state from the preview: viewport, frames as drawn, and the iframe's offset in the page. */
export async function boardState(page) {
  const iframe = await page.$('#storybook-preview-iframe');
  const box = await iframe.boundingBox();
  const state = await previewFrame(page).evaluate(() => {
    const board = document.querySelector('[data-colab-board]');
    return JSON.parse(board.dataset.colabBoardState ?? 'null');
  });
  return { ...state, iframe: box };
}

/**
 * The page point of the centre of `selector` inside a frame, computed from the board model only
 * (frame position, viewport and the element's layout offsets), not from the drawn geometry under test.
 */
export async function modelPoint(page, frameId, selector) {
  const { iframe } = await boardState(page);
  const local = await previewFrame(page).evaluate(
    ({ frameId, selector }) => {
      const board = document.querySelector('[data-colab-board]');
      const state = JSON.parse(board.dataset.colabBoardState);
      const frame = state.frames.find((f) => f.id === frameId);
      const body = document.querySelector(`[data-colab-frame="${frameId}"]`);
      const target = body.querySelector(selector);
      let x = 0;
      let y = 0;
      for (let node = target; node && node !== body; node = node.offsetParent) {
        x += node.offsetLeft;
        y += node.offsetTop;
        if (node.offsetParent && !body.contains(node.offsetParent)) break;
      }
      const boardRect = board.getBoundingClientRect();
      const wx = frame.x + x + target.offsetWidth / 2;
      const wy = frame.y + y + target.offsetHeight / 2;
      return {
        x: boardRect.left + state.view.x + wx * state.view.zoom,
        y: boardRect.top + state.view.y + wy * state.view.zoom,
      };
    },
    { frameId, selector },
  );
  return { x: iframe.x + local.x, y: iframe.y + local.y };
}

/**
 * For checks that delete a fixture file: remembers its contents and writes them back when the check
 * ends, throws, or is interrupted (SIGINT, SIGTERM, SIGHUP). A SIGKILL cannot be caught, so
 * scripts/run-browser-checks.mjs also restores scripts/fixtures from git before and after a run.
 * Returns `restore()`, which writes the file back if it is missing or changed.
 */
const ROOT = fileURLToPath(new URL('..', import.meta.url));

export function guardFile(path) {
  let source;
  try {
    source = readFileSync(path, 'utf8');
  } catch {
    // An earlier run was killed while the file was deleted: take it from git.
    source = execFileSync('git', ['show', `HEAD:./${relative(ROOT, path)}`], { cwd: ROOT, encoding: 'utf8' });
    writeFileSync(path, source);
  }
  const restore = () => {
    let current;
    try {
      current = readFileSync(path, 'utf8');
    } catch {
      // deleted
    }
    if (current !== source) writeFileSync(path, source);
  };
  process.on('exit', restore);
  for (const [signal, number] of [
    ['SIGINT', 2],
    ['SIGTERM', 15],
    ['SIGHUP', 1],
  ]) {
    process.on(signal, () => {
      restore();
      process.exit(128 + number);
    });
  }
  return { source, restore };
}

export async function setView(page, canvasId, view) {
  await page.evaluate(
    ({ canvasId, view }) => localStorage.setItem(`addon-colab:board-view:${canvasId}`, JSON.stringify(view)),
    { canvasId, view },
  );
}

/**
 * The test canvas the checks use: `board.json` in `$CANVAS_DIR`, the canvas folder of the Storybook
 * on `$SB`. Refuses the project's own `.storybook/canvases`, which holds the user's canvases.
 */
const CANVAS_DIR = process.env.CANVAS_DIR;
if (!CANVAS_DIR) throw new Error('Set CANVAS_DIR, or run the checks with `pnpm check:browser`');
if (resolve(CANVAS_DIR) === fileURLToPath(new URL('../.storybook/canvases', import.meta.url))) {
  throw new Error('The browser checks rewrite board.json; never point CANVAS_DIR at .storybook/canvases');
}
export const CANVAS_FILE = pathToFileURL(resolve(CANVAS_DIR, 'board.json'));
export const BASE_CANVAS = {
  schemaVersion: 1,
  id: 'board',
  name: 'Board',
  createdAt: '2026-11-25T17:00:00.000Z',
  updatedAt: '2026-11-25T17:00:00.000Z',
  frames: [
    { id: 'frame_btn', storyId: 'example-button--primary', x: 0, y: 0, width: 360 },
    { id: 'frame_hdr', storyId: 'example-header--logged-out', x: 420, y: 0, width: 960 },
    { id: 'frame_page', storyId: 'example-page--logged-out', x: 0, y: 200, width: 960 },
  ],
  comments: [],
  strokes: [],
};

/** Writes the three-story test canvas and waits for the store's watcher to pick it up. */
export async function resetCanvas() {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  mkdirSync(new URL('.', CANVAS_FILE), { recursive: true });
  writeFileSync(CANVAS_FILE, JSON.stringify(BASE_CANVAS, null, 2) + '\n');
  await new Promise((resolve) => setTimeout(resolve, 600));
}
