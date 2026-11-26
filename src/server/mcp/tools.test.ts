import { copyFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { type CanvasFile, parseCanvasFile } from '../../canvas-file';
import type { CanvasChangeEvent } from '../../channel';
import { type CanvasStore, createCanvasStore } from '../canvas-store';
import type { CommentSummary, StoryLookup } from './format';
import { createColabMcpServer } from './tools';

const FIXTURE = join(__dirname, '../../__fixtures__/example-canvas.json');

const stories: StoryLookup = (storyId) =>
  ({
    'example-header--logged-out': {
      title: 'Example/Header',
      name: 'Logged Out',
      importPath: './src/stories/Header.stories.ts',
    },
    'example-button--primary': {
      title: 'Example/Button',
      name: 'Primary',
      importPath: './src/stories/Button.stories.ts',
    },
  })[storyId];

let dir: string;
let store: CanvasStore;
let client: Client;

async function readCanvas(id: string): Promise<CanvasFile> {
  const result = parseCanvasFile(await readFile(join(dir, `${id}.json`), 'utf8'));
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.canvas;
}

async function call(name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const content = result.content as { type: string; text: string }[];
  return { isError: result.isError === true, text: content[0]?.text ?? '' };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- tests read loosely typed JSON results
async function callJson<T = Record<string, any>>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const { isError, text } = await call(name, args);
  if (isError) throw new Error(`${name} failed: ${text}`);
  return JSON.parse(text) as T;
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'colab-mcp-'));
  await copyFile(FIXTURE, join(dir, 'design-review.json'));
  store = createCanvasStore({ dir });
  const server = createColabMcpServer({ store, stories: async () => stories });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
});

afterEach(async () => {
  await client.close();
  await store.close();
  await rm(dir, { recursive: true, force: true });
});

describe('tool list', () => {
  it('registers the canvas tools with descriptions and annotations', async () => {
    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'add_canvas_comment',
      'get_canvas',
      'list_canvas_comments',
      'list_canvases',
      'reopen_canvas_comment',
      'reply_to_canvas_comment',
      'resolve_canvas_comment',
    ]);
    for (const tool of tools) {
      expect(tool.description?.length).toBeGreaterThan(40);
    }
    expect(tools.find((tool) => tool.name === 'get_canvas')?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((tool) => tool.name === 'add_canvas_comment')?.annotations?.readOnlyHint).toBe(false);
  });

  it('does not announce list-changed notifications', () => {
    expect(client.getServerCapabilities()?.tools?.listChanged).toBe(false);
    expect(client.getInstructions()).toContain('list_canvases');
  });
});

describe('list_canvases', () => {
  it('lists canvases and invalid files', async () => {
    await store.create({ name: 'Second board' });
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(dir, 'broken.json'), '{ nope');
    const result = await callJson('list_canvases');
    expect(result.canvases).toEqual([
      expect.objectContaining({
        canvasId: 'design-review',
        name: 'Design review',
        frameCount: 2,
        commentCount: 3,
        openCommentCount: 2,
      }),
      expect.objectContaining({ canvasId: 'second-board', commentCount: 0 }),
    ]);
    expect(result.invalid).toEqual([expect.objectContaining({ id: 'broken', file: 'broken.json' })]);
  });

  it('omits "invalid" when every file is valid', async () => {
    const result = await callJson('list_canvases');
    expect(result).not.toHaveProperty('invalid');
  });
});

describe('get_canvas', () => {
  it('returns frames with story files, comments with locations, and summarised strokes', async () => {
    const result = await callJson('get_canvas', { canvasId: 'design-review' });
    expect(result.canvasId).toBe('design-review');
    expect(result.frames[0]).toEqual({
      frameId: 'frame-header01',
      storyId: 'example-header--logged-out',
      title: 'Example/Header',
      storyName: 'Logged Out',
      storyFile: './src/stories/Header.stories.ts',
      x: 0,
      y: 0,
      width: 800,
    });
    expect(result.comments).toHaveLength(3);
    expect(result.strokes).toEqual([
      {
        strokeId: 'stroke-circle01',
        color: '#ff4785',
        width: 3,
        pointCount: 5,
        bounds: { x: -10, y: 150, width: 260, height: 100 },
        frames: [
          {
            frameId: 'frame-header01',
            storyId: 'example-header--logged-out',
            storyFile: './src/stories/Header.stories.ts',
            relation: 'crosses',
          },
          {
            frameId: 'frame-button01',
            storyId: 'example-button--primary',
            storyFile: './src/stories/Button.stories.ts',
            relation: 'surrounds',
          },
        ],
      },
    ]);
    expect(result.note).toMatch(/assume they are 400px tall/);
    expect(JSON.stringify(result)).not.toContain('[-10,150]');
  });

  it('includes stroke points only when asked', async () => {
    const result = await callJson('get_canvas', { canvasId: 'design-review', includeStrokePoints: true });
    expect(result.strokes[0].points).toEqual([
      [-10, 150],
      [250, 150],
      [250, 250],
      [-10, 250],
      [-10, 150],
    ]);
  });

  it('reports a missing canvas as an error the agent can read', async () => {
    const { isError, text } = await call('get_canvas', { canvasId: 'nope' });
    expect(isError).toBe(true);
    expect(text).toMatch(/^NOT_FOUND: /);
  });

  it('rejects an id that is not a canvas id before touching the disk', async () => {
    const { isError, text } = await call('get_canvas', { canvasId: '../secrets' });
    expect(isError).toBe(true);
    expect(text).toMatch(/canvas id/);
  });
});

describe('list_canvas_comments', () => {
  it('returns each element comment with its full target', async () => {
    const { comments } = await callJson<{ comments: CommentSummary[] }>('list_canvas_comments', {
      canvasId: 'design-review',
    });
    expect(comments.map((c) => c.commentId)).toEqual(['comment-login01', 'comment-space01', 'comment-button01']);
    expect(comments[0]).toEqual({
      canvasId: 'design-review',
      commentId: 'comment-login01',
      status: 'open',
      author: 'user',
      body: 'Make the Log in button secondary.',
      createdAt: '2026-11-25T15:10:00.000Z',
      location: {
        type: 'element',
        frameId: 'frame-header01',
        frameOnCanvas: true,
        storyId: 'example-header--logged-out',
        title: 'Example/Header',
        storyFile: './src/stories/Header.stories.ts',
        selector: 'header > div > div:nth-of-type(2) > button:nth-of-type(1)',
        role: 'button',
        name: 'Log in',
        text: 'Log in',
        html: '<button type="button" class="storybook-button storybook-button--small storybook-button--secondary">Log in</button>',
      },
      replies: [
        {
          replyId: 'reply-agent01',
          author: 'agent',
          body: 'Done: Header now passes primary={false} to the Log in button.',
          createdAt: '2026-11-25T15:20:00.000Z',
        },
      ],
    });
    expect(comments[1]!.location).toEqual({
      type: 'position',
      x: 120,
      y: 140,
      insideFrames: [
        {
          frameId: 'frame-header01',
          storyId: 'example-header--logged-out',
          storyFile: './src/stories/Header.stories.ts',
        },
      ],
    });
    expect(comments[2]!.location).toEqual({
      type: 'frame',
      frameId: 'frame-button01',
      frameOnCanvas: true,
      storyId: 'example-button--primary',
      title: 'Example/Button',
      storyFile: './src/stories/Button.stories.ts',
      offset: { x: 24, y: 12 },
    });
  });

  it('filters by status and author', async () => {
    const open = await callJson('list_canvas_comments', { status: 'open' });
    expect(open.comments.map((c: CommentSummary) => c.commentId)).toEqual(['comment-login01', 'comment-button01']);
    const byUser = await callJson('list_canvas_comments', { author: 'user' });
    expect(byUser.comments.map((c: CommentSummary) => c.commentId)).toEqual(['comment-login01']);
    const resolvedAgent = await callJson('list_canvas_comments', { status: 'resolved', author: 'agent' });
    expect(resolvedAgent.count).toBe(1);
  });

  it('lists comments across all canvases, oldest first', async () => {
    await store.create({ name: 'Other' });
    await store.addComment({
      canvasId: 'other',
      comment: { author: 'user', body: 'Earliest? No, newest.', anchor: { type: 'position', x: 0, y: 0 } },
    });
    const result = await callJson('list_canvas_comments');
    expect(result.count).toBe(4);
    expect(result.comments.at(-1).canvasId).toBe('other');
  });

  it('marks a target whose frame was removed', async () => {
    await store.removeFrame({ canvasId: 'design-review', frameId: 'frame-header01' });
    const { comments } = await callJson('list_canvas_comments', { canvasId: 'design-review', author: 'user' });
    expect(comments[0].location.frameOnCanvas).toBe(false);
    expect(comments[0].location.selector).toContain('button');
  });

  it('omits story details it cannot look up', async () => {
    const server = createColabMcpServer({ store });
    const [a, b] = InMemoryTransport.createLinkedPair();
    const bare = new Client({ name: 'bare', version: '0' });
    await Promise.all([server.connect(b), bare.connect(a)]);
    const result = await bare.callTool({ name: 'get_canvas', arguments: { canvasId: 'design-review' } });
    const parsed = JSON.parse((result.content as { text: string }[])[0]!.text);
    expect(parsed.frames[0]).not.toHaveProperty('storyFile');
    // Element targets carry their own story file, so they stay complete.
    expect(parsed.comments[0].location.storyFile).toBe('./src/stories/Header.stories.ts');
    await bare.close();
  });
});

describe('add_canvas_comment', () => {
  it('adds an agent comment on an element, written to the file and broadcast to subscribers', async () => {
    const events: CanvasChangeEvent[] = [];
    store.subscribe((event) => events.push(event));
    const [existing] = (await callJson('list_canvas_comments', { canvasId: 'design-review' })).comments;
    const { location } = existing;
    const result = await callJson<CommentSummary>('add_canvas_comment', {
      canvasId: 'design-review',
      body: 'This button also needs an aria-label.',
      anchor: {
        type: 'element',
        frameId: location.frameId,
        target: {
          storyId: location.storyId,
          title: location.title,
          importPath: location.storyFile,
          selector: location.selector,
          html: location.html,
          text: location.text,
          role: location.role,
          name: location.name,
        },
      },
    });
    expect(result).toMatchObject({
      author: 'agent',
      status: 'open',
      location: { type: 'element', selector: location.selector },
    });

    const onDisk = await readCanvas('design-review');
    const stored = onDisk.comments.find((c) => c.id === result.commentId);
    expect(stored).toMatchObject({ author: 'agent', body: 'This button also needs an aria-label.' });
    expect(stored?.anchor).toEqual(onDisk.comments[0]!.anchor);
    expect(events).toEqual([expect.objectContaining({ type: 'changed', id: 'design-review', source: 'store' })]);
  });

  it('anchors to a frame, filling in its story', async () => {
    const result = await callJson('add_canvas_comment', {
      canvasId: 'design-review',
      body: 'Whole header looks cramped.',
      anchor: { type: 'frame', frameId: 'frame-header01', x: 10, y: 4 },
    });
    expect(result.location).toMatchObject({
      type: 'frame',
      storyId: 'example-header--logged-out',
      offset: { x: 10, y: 4 },
    });
    const stored = (await readCanvas('design-review')).comments.at(-1);
    expect(stored?.anchor).toEqual({
      type: 'frame',
      frameId: 'frame-header01',
      storyId: 'example-header--logged-out',
      x: 10,
      y: 4,
    });
  });

  it('anchors to a position', async () => {
    const result = await callJson('add_canvas_comment', {
      canvasId: 'design-review',
      body: 'Empty space here.',
      anchor: { type: 'position', x: 1000, y: 1000 },
    });
    expect(result.location).toEqual({ type: 'position', x: 1000, y: 1000, insideFrames: [] });
  });

  it('anchors to the same place as an existing comment', async () => {
    const result = await callJson('add_canvas_comment', {
      canvasId: 'design-review',
      body: 'Same button, another point.',
      anchor: { type: 'sameAs', commentId: 'comment-login01' },
    });
    expect(result.location.selector).toBe('header > div > div:nth-of-type(2) > button:nth-of-type(1)');
  });

  it.each([
    [{ type: 'frame', frameId: 'frame-missing' }, /no frame "frame-missing".*frame-header01/],
    [{ type: 'frame', frameId: 'frame-header01', x: 3 }, /x and anchor.y must be given together/],
    [{ type: 'sameAs', commentId: 'comment-nope' }, /no comment "comment-nope"/],
    [
      {
        type: 'element',
        frameId: 'frame-button01',
        target: {
          storyId: 'example-header--logged-out',
          title: 'Example/Header',
          importPath: './x.ts',
          selector: 'button',
          html: '',
          text: '',
        },
      },
      /does not match frame "frame-button01"/,
    ],
  ])('rejects a bad anchor %#', async (anchor, message) => {
    const before = await readFile(join(dir, 'design-review.json'), 'utf8');
    const { isError, text } = await call('add_canvas_comment', { canvasId: 'design-review', body: 'x', anchor });
    expect(isError).toBe(true);
    expect(text).toMatch(/^INVALID_INPUT: /);
    expect(text).toMatch(message);
    expect(await readFile(join(dir, 'design-review.json'), 'utf8')).toBe(before);
  });

  it('validates input with the canvas schemas (element target, body, anchor type)', async () => {
    const tooLong = await call('add_canvas_comment', {
      canvasId: 'design-review',
      body: 'x',
      anchor: {
        type: 'element',
        frameId: 'frame-header01',
        target: {
          storyId: 'example-header--logged-out',
          title: 'T',
          importPath: './x.ts',
          selector: 'b',
          html: 'x'.repeat(2001),
          text: '',
        },
      },
    });
    expect(tooLong.isError).toBe(true);
    const empty = await call('add_canvas_comment', {
      canvasId: 'design-review',
      body: '   ',
      anchor: { type: 'position', x: 0, y: 0 },
    });
    expect(empty.isError).toBe(true);
    const unknown = await call('add_canvas_comment', {
      canvasId: 'design-review',
      body: 'x',
      anchor: { type: 'circle' },
    });
    expect(unknown.isError).toBe(true);
    const author = await call('add_canvas_comment', {
      canvasId: 'design-review',
      body: 'x',
      author: 'user',
      anchor: { type: 'position', x: 0, y: 0 },
    });
    // Extra keys are ignored; the agent can never write as the user.
    expect(JSON.parse(author.text).author).toBe('agent');
  });
});

describe('reply, resolve and reopen', () => {
  it('replies as the agent', async () => {
    const result = await callJson('reply_to_canvas_comment', {
      canvasId: 'design-review',
      commentId: 'comment-button01',
      body: 'Added a Disabled story.',
    });
    expect(result.replies).toEqual([expect.objectContaining({ author: 'agent', body: 'Added a Disabled story.' })]);
    const stored = (await readCanvas('design-review')).comments.find((c) => c.id === 'comment-button01');
    expect(stored?.replies).toEqual([expect.objectContaining({ author: 'agent', body: 'Added a Disabled story.' })]);
  });

  it('resolves and reopens', async () => {
    const resolved = await callJson('resolve_canvas_comment', {
      canvasId: 'design-review',
      commentId: 'comment-login01',
    });
    expect(resolved.status).toBe('resolved');
    expect(resolved.resolvedAt).toMatch(/Z$/);
    let stored = (await readCanvas('design-review')).comments[0];
    expect(stored).toMatchObject({ status: 'resolved' });

    const reopened = await callJson('reopen_canvas_comment', {
      canvasId: 'design-review',
      commentId: 'comment-login01',
    });
    expect(reopened.status).toBe('open');
    expect(reopened).not.toHaveProperty('resolvedAt');
    stored = (await readCanvas('design-review')).comments[0];
    expect(stored?.status).toBe('open');
    expect(stored?.resolvedAt).toBeUndefined();
  });

  it('reports an unknown comment', async () => {
    for (const name of ['reply_to_canvas_comment', 'resolve_canvas_comment', 'reopen_canvas_comment']) {
      const { isError, text } = await call(name, { canvasId: 'design-review', commentId: 'comment-nope', body: 'x' });
      expect(isError).toBe(true);
      expect(text).toMatch(/^NOT_FOUND: /);
    }
  });
});
