/**
 * MOUNT POINT FOR THE BOARD (task 6 replaces the body of `CanvasBoard`).
 *
 * The canvas page renders this once the canvas file has loaded and the browser supports
 * HTML-in-Canvas. It fills the page. Props:
 * - `canvas`: the current file contents. The page re-renders with a new object whenever the file
 *   changes (from this tab, another tab, an MCP agent or a hand edit), without remounting the board.
 * - `channel`: the preview channel, for `requestCanvas(channel, 'addFrame', …)` and friends.
 *
 * The empty-state message is drawn by the page on top of the board while `canvas.frames` is empty,
 * with `pointer-events: none`, so drops still reach the board.
 */
import React from 'react';

import { styled } from 'storybook/theming/emotion';

import type { CanvasFile } from '../canvas-file';
import type { ChannelLike } from '../channel';

export interface CanvasBoardProps {
  canvas: CanvasFile;
  channel: ChannelLike;
}

const Mount = styled.div(({ theme }) => ({
  position: 'absolute',
  inset: 0,
  background: theme.background.content,
}));

export function CanvasBoard({ canvas }: CanvasBoardProps) {
  return <Mount data-colab-board={canvas.id} />;
}
