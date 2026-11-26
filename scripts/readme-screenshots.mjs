// Regenerates the README screenshots in assets/screenshots/ from the real addon in a real Storybook.
//
//   pnpm screenshots                    # starts its own Storybook, writes assets/screenshots/*.png
//   SB=http://127.0.0.1:6247 CANVAS_DIR=<its canvas dir> node scripts/readme-screenshots.mjs
//
// Without $SB it starts `storybook dev` with scripts/screenshot-storybook (the addon loaded from
// src/, only the example stories) on $PORT (default 6197), with canvases in .sb-screenshots/canvases,
// a git-ignored folder it empties before and deletes after the run. It never reads or writes
// .storybook/canvases. Needs the installed Google Chrome 157+ ($CHROME to override its path).
//
// The scene is built the way a person and an agent would build it: the canvas is created from the
// Canvases menu, the stories are placed through the addon's store channel, the user's comment is
// pinned and the annotation drawn with the mouse, and the agent's reply arrives over MCP
// (/colab/mcp). Screenshots are taken at 1440×900, device scale factor 2, then scaled to 1600 px
// wide. Optimise them afterwards, for example with `npx -y pngquant-bin` and `npx -y oxipng`
// (see the README's Development section).
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium } from 'playwright-core';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CHROME = process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const OUT = process.env.OUT ?? join(ROOT, 'assets/screenshots');
const ONLY = process.env.ONLY?.split(',');
const VIEWPORT = { width: 1440, height: 900 };
const CANVAS_NAME = 'Design review';
const CANVAS_ID = 'design-review';
const VIEW = { x: 40, y: 100, zoom: 0.8 };
/** Detail shots show this part of the window (CSS pixels); every image is scaled to 1600×1000. */
const DETAIL = { x: 300, y: 40, width: 1120, height: 700 };
const OUTPUT_WIDTH = 1600;

// ---------------------------------------------------------------------------------------------
// Storybook

let SB = process.env.SB;
let stopServer = () => {};
if (!SB) {
  const PORT = Number(process.env.PORT ?? 6197);
  SB = `http://127.0.0.1:${PORT}`;
  const workDir = join(ROOT, '.sb-screenshots');
  const canvasDir = join(workDir, 'canvases');
  await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(new Error(`Port ${PORT} is in use; set PORT to a free one`)));
    probe.listen(PORT, '127.0.0.1', () => probe.close(resolve));
  });
  rmSync(workDir, { recursive: true, force: true });
  mkdirSync(canvasDir, { recursive: true });
  console.log(`Starting Storybook on ${SB} (canvases in .sb-screenshots/canvases)…`);
  const server = spawn(
    join(ROOT, 'node_modules/.bin/storybook'),
    ['dev', '-p', String(PORT), '--host', '127.0.0.1', '-c', 'scripts/screenshot-storybook', '--ci', '--quiet'],
    {
      cwd: ROOT,
      detached: true,
      env: { ...process.env, COLAB_CHECK_CANVAS_DIR: canvasDir },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let log = '';
  server.stdout.on('data', (chunk) => (log += chunk));
  server.stderr.on('data', (chunk) => (log += chunk));
  let stopped = false;
  stopServer = () => {
    if (stopped) return;
    stopped = true;
    try {
      process.kill(-server.pid, 'SIGTERM');
    } catch {
      // already gone
    }
    rmSync(workDir, { recursive: true, force: true });
  };
  process.on('exit', stopServer);
  for (const [signal, number] of [
    ['SIGINT', 2],
    ['SIGTERM', 15],
    ['SIGHUP', 1],
  ])
    process.on(signal, () => process.exit(128 + number));
  const deadline = Date.now() + 180_000;
  for (;;) {
    if (server.exitCode !== null) throw new Error(`Storybook exited early:\n${log}`);
    try {
      if ((await fetch(`${SB}/index.json`)).ok) break;
    } catch {
      // not listening yet
    }
    if (Date.now() > deadline) throw new Error(`Storybook did not start within 3 minutes:\n${log}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

// ---------------------------------------------------------------------------------------------
// Helpers

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function launch(colorScheme) {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: 2, colorScheme });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.warn('page error:', error.message));
  return { browser, page };
}

const preview = (page) => page.frames().find((frame) => frame.url().includes('/iframe.html'));

/** Runs a canvas store operation through the addon's channel, from the manager. */
async function storeOp(page, op, args) {
  const response = await page.evaluate(
    ({ op, args }) =>
      new Promise((resolve, reject) => {
        const channel = globalThis.__STORYBOOK_ADDONS_CHANNEL__;
        const id = `readme-${Math.random().toString(36).slice(2)}`;
        const timer = setTimeout(() => reject(new Error(`${op} timed out`)), 10_000);
        const listener = (message) => {
          if (message?.id !== id) return;
          clearTimeout(timer);
          channel.off('addon-colab/canvas-response', listener);
          resolve(JSON.parse(message.payload));
        };
        channel.on('addon-colab/canvas-response', listener);
        channel.emit('addon-colab/canvas-request', { id, payload: JSON.stringify({ op, args }) });
      }),
    { op, args },
  );
  if (!response.success) throw new Error(`${op} failed: ${response.error}`);
  return response.result;
}

/** Calls a tool on the addon's MCP endpoint, as a coding agent would. */
async function mcp(name, args) {
  const response = await fetch(`${SB}/colab/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await response.json();
  if (body.error || body.result?.isError) throw new Error(`${name}: ${JSON.stringify(body.error ?? body.result)}`);
  const text = body.result.content.map((part) => part.text ?? '').join('\n');
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Waits for the board and every frame's story to have rendered, then for fonts and paint. */
async function waitForBoard(page, frameCount) {
  await page.waitForFunction(
    (count) => {
      const doc = document.querySelector('#storybook-preview-iframe')?.contentDocument;
      const board = doc?.querySelector('[data-colab-board]');
      if (!board || board.style.visibility === 'hidden') return false;
      const frames = [...doc.querySelectorAll('[data-colab-frame]')];
      return frames.length === count && frames.every((frame) => frame.textContent.trim().length > 0);
    },
    frameCount,
    { timeout: 30_000 },
  );
  await preview(page).evaluate(() => document.fonts.ready);
  await wait(800);
}

async function setView(page, view) {
  await page.evaluate(({ key, view }) => localStorage.setItem(key, JSON.stringify(view)), {
    key: `addon-colab:board-view:${CANVAS_ID}`,
    view,
  });
}

/** Page coordinates of a world point on the board. */
async function worldToPage(page, x, y) {
  const iframe = await (await page.$('#storybook-preview-iframe')).boundingBox();
  const local = await preview(page).evaluate(
    ({ x, y }) => {
      const board = document.querySelector('[data-colab-board]');
      const { view } = JSON.parse(board.dataset.colabBoardState);
      const rect = board.getBoundingClientRect();
      return { x: rect.left + view.x + x * view.zoom, y: rect.top + view.y + y * view.zoom };
    },
    { x, y },
  );
  return { x: iframe.x + local.x, y: iframe.y + local.y };
}

/** Page rectangle of an element inside a frame's story, as drawn on the board. */
async function elementRect(page, frameId, selector) {
  const iframe = await (await page.$('#storybook-preview-iframe')).boundingBox();
  const rect = await preview(page).evaluate(
    ({ frameId, selector }) => {
      const el = document.querySelector(`[data-colab-frame="${frameId}"] ${selector}`);
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    },
    { frameId, selector },
  );
  return { ...rect, x: iframe.x + rect.x, y: iframe.y + rect.y };
}

/** Page rectangle of the text inside an element (not its block box), as drawn on the board. */
async function textRect(page, frameId, selector) {
  const iframe = await (await page.$('#storybook-preview-iframe')).boundingBox();
  const rect = await preview(page).evaluate(
    ({ frameId, selector }) => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector(`[data-colab-frame="${frameId}"] ${selector}`));
      const r = range.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    },
    { frameId, selector },
  );
  return { ...rect, x: iframe.x + rect.x, y: iframe.y + rect.y };
}

async function moveMouseAway(page) {
  await page.mouse.move(VIEWPORT.width - 4, VIEWPORT.height - 4);
}

/** Clicks an empty part of the board (deselects any story) and moves the pointer out of the way. */
async function clearSelection(page) {
  await page.mouse.click(VIEWPORT.width - 120, VIEWPORT.height - 160);
  await moveMouseAway(page);
}

/** Scales a screenshot to OUTPUT_WIDTH in the browser (high-quality resampling), returns PNG bytes. */
async function scale(page, png) {
  const data = await page.evaluate(
    async ({ base64, width }) => {
      const blob = await (await fetch(`data:image/png;base64,${base64}`)).blob();
      const source = await createImageBitmap(blob);
      const height = Math.round((source.height * width) / source.width);
      const bitmap = await createImageBitmap(source, {
        resizeWidth: width,
        resizeHeight: height,
        resizeQuality: 'high',
      });
      const canvas = new OffscreenCanvas(width, height);
      canvas.getContext('2d').drawImage(bitmap, 0, 0);
      const out = await canvas.convertToBlob({ type: 'image/png' });
      const bytes = new Uint8Array(await out.arrayBuffer());
      let binary = '';
      for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(binary);
    },
    { base64: png.toString('base64'), width: OUTPUT_WIDTH },
  );
  return Buffer.from(data, 'base64');
}

const shots = [];
async function shot(page, name, clip) {
  if (ONLY && !ONLY.includes(name)) return;
  await wait(400);
  const path = join(OUT, `${name}.png`);
  const png = await page.screenshot({ clip, animations: 'disabled', caret: 'hide' });
  writeFileSync(path, await scale(page, png));
  shots.push(path);
  console.log(`  ${name}.png`);
}

// ---------------------------------------------------------------------------------------------
// Scene

mkdirSync(OUT, { recursive: true });
const { browser, page } = await launch('light');
try {
  await page.goto(`${SB}/?path=/story/example-button--primary`);
  await preview(page)?.waitForSelector('#storybook-root *', { timeout: 30_000 });
  await page.waitForSelector('button[aria-label="Canvases"]');

  // 1. Create the canvas from the Canvases menu.
  const existing = await storeOp(page, 'list', {});
  if (existing.canvases?.some((canvas) => canvas.id === CANVAS_ID)) await storeOp(page, 'delete', { id: CANVAS_ID });
  await page.locator('button[aria-label="Canvases"]').click();
  await page.getByText('New canvas…', { exact: true }).click();
  await page.getByLabel('Canvas name').fill(CANVAS_NAME);
  await page.getByRole('button', { name: 'Create', exact: true }).click();
  await page.waitForFunction(() =>
    document.querySelector('#storybook-preview-iframe')?.contentDocument?.querySelector('[data-colab-board]'),
  );

  // 2. Place the stories.
  const placed = {};
  for (const [key, frame] of Object.entries({
    header: { storyId: 'example-header--logged-out', x: 0, y: 0, width: 960 },
    button: { storyId: 'example-button--primary', x: 1020, y: 0, width: 300 },
    page: { storyId: 'example-page--logged-in', x: 0, y: 170, width: 960 },
  }))
    placed[key] = (await storeOp(page, 'addFrame', { canvasId: CANVAS_ID, frame })).frame.id;
  await setView(page, VIEW);
  await page.reload();
  await waitForBoard(page, 3);
  const board = preview(page);

  // 3. Comment mode: hover the Header's "Sign up" button, then pin a comment to it.
  await board.locator('button[data-colab-mode="comment"]').click();
  const target = await elementRect(page, placed.header, 'button.storybook-button--primary');
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 8 });
  await board.locator('[data-colab-hover]').waitFor();
  await shot(page, 'comment-mode', DETAIL);
  await page.mouse.click(target.x + target.width / 2, target.y + target.height / 2);
  const draft = board.locator('[data-colab-draft] textarea');
  await draft.waitFor();
  await draft.pressSequentially('Sign up should use our brand purple, like the logo.', { delay: 5 });
  await board.locator('[data-colab-draft] [data-colab-submit]').click();
  await board.locator('[data-colab-draft]').waitFor({ state: 'detached' });

  // 4. The agent answers over MCP, and leaves a comment of its own on the Button story.
  const { comments } = await mcp('list_canvas_comments', { canvasId: CANVAS_ID, status: 'open' });
  const userComment = comments.find((comment) => comment.author === 'user');
  await mcp('reply_to_canvas_comment', {
    canvasId: CANVAS_ID,
    commentId: userComment.commentId,
    body: 'Header.tsx renders it as the primary Button, so its colour comes from .storybook-button--primary in button.css. Changing it there recolours every primary button. Shall I do that, or add a brand variant?',
  });
  await mcp('add_canvas_comment', {
    canvasId: CANVAS_ID,
    body: 'There is no disabled story for Button yet. Shall I add one?',
    anchor: { type: 'frame', frameId: placed.button, x: 180, y: 24 },
  });
  await board.locator('[data-colab-pin]').nth(1).waitFor();

  // 5. Draw mode: circle the page heading in red.
  await board.locator('button[data-colab-mode="draw"]').click();
  await board.locator('[data-colab-draw-options]').waitFor();
  await board.locator('[data-colab-draw-color]').nth(1).click();
  await board.locator('[data-colab-draw-width="4"]').click();
  // A rounded loop (superellipse) around the heading's words, clear of the paragraph below.
  const heading = await textRect(page, placed.page, 'h2');
  const cx = heading.x + heading.width / 2;
  const cy = heading.y + heading.height / 2 - 3;
  const rx = heading.width / 2 + 22;
  const ry = heading.height / 2 + 5;
  const steps = 90;
  const curve = (v) => Math.sign(v) * Math.abs(v) ** (2 / 3);
  const point = (i) => {
    const t = -Math.PI * 0.95 + (i / steps) * Math.PI * 2.06;
    return [cx + rx * curve(Math.cos(t)), cy + ry * curve(Math.sin(t))];
  };
  await page.mouse.move(...point(0));
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) await page.mouse.move(...point(i));
  await page.mouse.up();
  await wait(600);
  await moveMouseAway(page);
  await shot(page, 'draw-mode', DETAIL);

  // 6. Back to select mode: the hero shot, then the open thread.
  await page.keyboard.press('Escape');
  await board.locator('[data-colab-draw-options]').waitFor({ state: 'detached' });
  await clearSelection(page);
  await wait(3000); // let any "new comment" highlight settle
  await shot(page, 'hero');
  await board.locator(`[data-colab-pin="${userComment.commentId}"]`).click();
  await board.locator('[data-colab-thread]').waitFor();
  await moveMouseAway(page);
  await shot(page, 'comment-thread', DETAIL);
  await page.keyboard.press('Escape');

  // 7. The Canvases menu.
  await page.locator('button[aria-label="Canvases"]').click();
  await page.getByText('New canvas…', { exact: true }).waitFor();
  await shot(page, 'canvases-menu', { x: 0, y: 0, width: 800, height: 500 });
  await page.keyboard.press('Escape');
  await browser.close();

  // 8. The same board in the dark theme.
  const dark = await launch('dark');
  await dark.page.goto(`${SB}/`);
  await setView(dark.page, VIEW);
  await dark.page.goto(`${SB}/?path=/story/colab-canvas-${CANVAS_ID}--canvas`);
  await waitForBoard(dark.page, 3);
  await clearSelection(dark.page);
  await wait(1500);
  await shot(dark.page, 'hero-dark');
  await dark.browser.close();
} finally {
  await browser.close().catch(() => {});
  stopServer();
}
console.log(`Wrote ${shots.length} screenshot(s) to ${OUT}`);
