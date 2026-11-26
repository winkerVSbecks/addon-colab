// Screenshots of comments on the board, light and dark: pins (user, agent, stacked, detached), an
// open thread, the comment list, the hover highlight in comment mode, and the composer.
// Writes PNGs to $OUT (default: ./comment-screenshots). Run:
//   SB=http://127.0.0.1:6171 CANVAS_DIR=<its canvas dir> node scripts/comments-screenshots.mjs
import { mkdirSync, writeFileSync } from 'node:fs';

import { BASE_CANVAS, CANVAS_FILE, SB, launch, modelPoint, previewFrame, setView, waitForBoard } from './board-lib.mjs';

const OUT = process.env.OUT ?? 'comment-screenshots';
mkdirSync(OUT, { recursive: true });

const logIn = {
  storyId: 'example-header--logged-out',
  title: 'Example/Header',
  importPath: './src/stories/Header.stories.ts',
  selector: 'button.storybook-button--secondary',
  html: '<button type="button" class="storybook-button storybook-button--small storybook-button--secondary">Log in</button>',
  text: 'Log in',
  role: 'button',
  name: 'Log in',
};
const at = (minutes) => new Date(Date.now() - minutes * 60000).toISOString();
const comments = [
  {
    id: 'comment-a1',
    author: 'user',
    body: 'Make the Log in button match the height of Sign up.',
    status: 'open',
    anchor: { type: 'element', frameId: 'frame_hdr', target: logIn },
    createdAt: at(30),
    replies: [
      { id: 'reply-a1', author: 'agent', body: 'Done: both use size="small" now. Can you check?', createdAt: at(5) },
    ],
  },
  {
    id: 'comment-a2',
    author: 'agent',
    body: 'This copy differs from the Figma file: should it say "Sign in"?',
    status: 'open',
    anchor: { type: 'element', frameId: 'frame_hdr', target: logIn },
    createdAt: at(4),
    replies: [],
  },
  {
    id: 'comment-a3',
    author: 'agent',
    body: 'The page story has no dark-mode variant yet.',
    status: 'open',
    anchor: { type: 'frame', frameId: 'frame_page', storyId: 'example-page--logged-out', x: 24, y: 120 },
    createdAt: at(3),
    replies: [],
  },
  {
    id: 'comment-a4',
    author: 'user',
    body: 'Old note about a removed icon',
    status: 'open',
    anchor: {
      type: 'element',
      frameId: 'frame_btn',
      target: {
        ...logIn,
        storyId: 'example-button--primary',
        title: 'Example/Button',
        importPath: './src/stories/Button.stories.ts',
        selector: 'svg.icon-gone',
        role: undefined,
        name: undefined,
      },
    },
    createdAt: at(60),
    replies: [],
  },
  {
    id: 'comment-a5',
    author: 'user',
    body: 'Space for a footer story here.',
    status: 'resolved',
    resolvedAt: at(1),
    anchor: { type: 'position', x: -60, y: 640 },
    createdAt: at(90),
    replies: [],
  },
];
for (const c of comments)
  if (c.anchor.target && c.anchor.target.role === undefined) {
    delete c.anchor.target.role;
    delete c.anchor.target.name;
  }

for (const scheme of ['light', 'dark']) {
  writeFileSync(CANVAS_FILE, JSON.stringify({ ...BASE_CANVAS, comments }, null, 2) + '\n');
  await new Promise((resolve) => setTimeout(resolve, 600));
  const { browser, page } = await launch({ dpr: 2, colorScheme: scheme, width: 1600, height: 960 });
  await page.goto(`${SB}/`);
  await setView(page, 'board', { x: 30, y: 90, zoom: 0.62 });
  await page.goto(`${SB}/?path=/story/colab-canvas-board--canvas`);
  await waitForBoard(page, 3);
  const preview = previewFrame(page);
  await page.waitForTimeout(800);

  // Thread + list + pins.
  await preview.locator('[data-colab-comments-toggle]').click();
  await preview.locator('[data-colab-pin="comment-a1"]').click();
  await page.mouse.move(5, 5);
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/comments-${scheme}-thread.png` });

  // Comment mode: hover highlight, then the composer.
  await preview.locator('[data-colab-thread] button[aria-label="Close comment"]').click();
  await preview.locator('[data-colab-comments-toggle]').click();
  await preview.locator('button[data-colab-mode="comment"]').click();
  const signUp = await modelPoint(page, 'frame_hdr', '.storybook-button--primary');
  await page.mouse.move(signUp.x, signUp.y);
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/comments-${scheme}-hover.png` });
  await page.mouse.click(signUp.x, signUp.y);
  await preview.locator('[data-colab-draft] textarea').waitFor();
  await preview.locator('[data-colab-draft] textarea').fill('Primary button should use the brand colour.');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/comments-${scheme}-composer.png` });
  await browser.close();
}
console.log('written to', OUT);
