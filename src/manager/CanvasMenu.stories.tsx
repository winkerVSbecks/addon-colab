import React from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';
import { styled } from 'storybook/theming/emotion';
import { fn } from 'storybook/test';

import type { CanvasListing } from '../channel';
import { withLightAndDark } from '../stories-support';
import { CanvasMenu } from './CanvasMenu';

const listing: CanvasListing = {
  canvases: [
    {
      id: 'checkout-review',
      name: 'Checkout review',
      createdAt: '2026-11-20T10:00:00.000Z',
      updatedAt: '2026-11-25T09:30:00.000Z',
      frameCount: 6,
      commentCount: 9,
      openCommentCount: 4,
    },
    {
      id: 'design-review',
      name: 'Design review',
      createdAt: '2026-11-21T10:00:00.000Z',
      updatedAt: '2026-11-24T15:00:00.000Z',
      frameCount: 1,
      commentCount: 0,
      openCommentCount: 0,
    },
    {
      id: 'empty',
      name: 'Onboarding flow, second pass with the new illustrations',
      createdAt: '2026-11-25T08:00:00.000Z',
      updatedAt: '2026-11-25T08:00:00.000Z',
      frameCount: 0,
      commentCount: 0,
      openCommentCount: 0,
    },
  ],
  invalid: [{ id: 'broken', file: 'broken.json', errors: ['frames[0].width: expected a positive number'] }],
};

/** Looks like the popover the toolbar button opens. */
const Popover = styled.div(({ theme }) => ({
  display: 'inline-block',
  margin: 16,
  background: theme.base === 'dark' ? theme.background.content : theme.color.lightest,
  border: `1px solid ${theme.appBorderColor}`,
  borderRadius: theme.appBorderRadius + 2,
  boxShadow: '0 5px 15px 0 rgba(0, 0, 0, 0.1)',
  fontSize: theme.typography.size.s2,
}));

const meta = {
  title: 'Addon/Canvas menu',
  component: CanvasMenu,
  decorators: [
    (Story) => (
      <Popover>
        <Story />
      </Popover>
    ),
    withLightAndDark,
  ],
  args: {
    listing: { status: 'ready', listing },
    onOpen: fn(),
    onNew: fn(),
    onRename: fn(),
    onDelete: fn(),
  },
} satisfies Meta<typeof CanvasMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

/** The list of canvases, opened from a story page: no actions for a current canvas. */
export const List: Story = {};

/** Opened on a canvas page: rename and delete act on it, and it is marked in the list. */
export const OnACanvas: Story = { args: { currentFileId: 'checkout-review' } };

/** Opened on a broken canvas: it can only be deleted. */
export const OnABrokenCanvas: Story = { args: { currentFileId: 'broken' } };

export const NoCanvases: Story = { args: { listing: { status: 'ready', listing: { canvases: [], invalid: [] } } } };

export const Loading: Story = { args: { listing: { status: 'loading' } } };

/** In a static build, or when the dev server has stopped. */
export const ServerUnavailable: Story = {
  args: { listing: { status: 'error', message: 'Timed out waiting for the canvas server (list)' } },
};
