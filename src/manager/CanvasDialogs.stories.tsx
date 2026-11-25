import React from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';

import { withUiTheme } from '../stories-support';
import { CanvasDeleteDialog, CanvasNameDialog } from './CanvasDialogs';

const meta = {
  title: 'Addon/Canvas dialogs',
  decorators: [withUiTheme],
  parameters: { layout: 'fullscreen' },
} satisfies Meta;

export default meta;

type NameStory = StoryObj<typeof CanvasNameDialog>;
type DeleteStory = StoryObj<typeof CanvasDeleteDialog>;

const nameArgs = { open: true, onOpenChange: fn(), onSubmit: fn(async () => {}) };
const deleteArgs = {
  open: true,
  onOpenChange: fn(),
  onConfirm: fn(async () => {}),
  name: 'Checkout review',
  fileId: 'checkout-review',
  counts: { frames: 6, comments: 9 },
};

export const NewCanvas: NameStory = {
  render: (args) => <CanvasNameDialog {...args} />,
  args: { ...nameArgs, mode: 'create' },
};

export const RenameCanvas: NameStory = {
  render: (args) => <CanvasNameDialog {...args} />,
  args: { ...nameArgs, mode: 'rename', initialName: 'Checkout review' },
};

export const DeleteConfirmation: DeleteStory = { render: (args) => <CanvasDeleteDialog {...args} />, args: deleteArgs };

export const DeleteConfirmationDark: DeleteStory = {
  ...DeleteConfirmation,
  parameters: { uiTheme: 'dark', backgrounds: { value: 'dark' } },
};

export const NewCanvasDark: NameStory = {
  ...NewCanvas,
  parameters: { uiTheme: 'dark', backgrounds: { value: 'dark' } },
};

/** A broken canvas: no counts. */
export const DeleteBrokenCanvas: DeleteStory = {
  render: (args) => <CanvasDeleteDialog {...args} />,
  args: { ...deleteArgs, name: 'broken.json', fileId: 'broken', counts: undefined },
};
