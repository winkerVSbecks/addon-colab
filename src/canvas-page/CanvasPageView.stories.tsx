import React from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';

import { createCanvasFile } from '../canvas-file';
import { withLightAndDark } from '../stories-support';
import { CanvasBoard } from './CanvasBoard';
import { CanvasPageView } from './CanvasPageView';

const emptyCanvas = createCanvasFile({
  id: 'checkout-review',
  name: 'Checkout review',
  now: new Date('2026-11-25T09:00:00Z'),
});

const meta = {
  title: 'Addon/Canvas page',
  component: CanvasPageView,
  decorators: [withLightAndDark],
  parameters: { layout: 'fullscreen', paneHeight: 360 },
  args: {
    state: { kind: 'ready', canvas: emptyCanvas },
    renderBoard: (canvas) => <CanvasBoard canvas={canvas} channel={{ emit() {}, on() {}, off() {} }} />,
  },
} satisfies Meta<typeof CanvasPageView>;

export default meta;
type Story = StoryObj<typeof meta>;

/**
 * A new canvas: the board mount point with the empty-state message over it.
 *
 * Not snapshotted in Chromatic: the board needs HTML-in-Canvas (Chrome 157+), which the capture browser may
 * lack, and without it this story throws instead of rendering. `UnsupportedBrowser` covers the fallback.
 */
export const Empty: Story = {
  parameters: { chromatic: { disableSnapshot: true } },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement);
    await expect(page.getAllByText('Checkout review is empty')).toHaveLength(2);
    await expect(canvasElement.querySelectorAll('[data-colab-board="checkout-review"]')).toHaveLength(2);
  },
};

/** Shown instead of the board when the browser lacks HTML-in-Canvas (anything but Chrome 157+). */
export const UnsupportedBrowser: Story = {
  args: { state: { kind: 'unsupported' } },
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getAllByText('Canvases need Chrome 157 or later')).toHaveLength(2);
  },
};

export const Loading: Story = { args: { state: { kind: 'loading' } } };

/** The canvas was deleted while open (another tab or an agent). */
export const Deleted: Story = { args: { state: { kind: 'missing', fileId: 'checkout-review' } } };

/** The file exists but does not validate. */
export const InvalidFile: Story = {
  args: {
    state: {
      kind: 'invalid',
      fileId: 'broken',
      errors: [
        'frames[0].width: expected a positive number',
        'comments[2].resolvedAt: required when status is "resolved"',
      ],
    },
  },
};

/** A file whose name is not a canvas id, so it cannot be opened or deleted from Storybook. */
export const BadFileName: Story = {
  args: {
    state: {
      kind: 'invalid',
      fileId: 'My Board',
      errors: ['file name: "My Board" is not a canvas id (a lowercase slug such as "design-review")'],
    },
  },
};

/** The canvas server did not answer, e.g. in a static build. */
export const ServerUnavailable: Story = {
  args: { state: { kind: 'error', message: 'Timed out waiting for the canvas server (get)' } },
};
