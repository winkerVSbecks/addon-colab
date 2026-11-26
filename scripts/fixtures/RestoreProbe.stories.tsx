// A check-only copy of a real story file: the example Button with two stories. Only the check
// Storybook loads scripts/fixtures, so scripts/check-board-restore.mjs can delete and restore this
// file while its canvas is open without touching the example stories other Storybooks use.
import { fn } from 'storybook/test';

import type { Meta, StoryObj } from '@storybook/react-vite';

import { Button } from '../../src/stories/Button';

const meta = {
  title: 'Checks/Restore probe',
  component: Button,
  args: { onClick: fn(), label: 'Restore probe' },
} satisfies Meta<typeof Button>;
export default meta;

type Story = StoryObj<typeof meta>;

export const Primary: Story = { args: { primary: true } };
export const Secondary: Story = {};
