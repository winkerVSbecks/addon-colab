// A check-only story (not in the addon's example stories): one short line of text.
// scripts/check-board-heights.mjs deletes and restores this file while its canvas is open.
import React from 'react';

import type { Meta, StoryObj } from '@storybook/react-vite';

function HeightProbe() {
  return <p style={{ margin: 0, fontFamily: 'sans-serif', lineHeight: '20px' }}>Height probe</p>;
}

const meta = { title: 'Checks/Height probe', component: HeightProbe } satisfies Meta<typeof HeightProbe>;
export default meta;
export const Default: StoryObj<typeof meta> = {};
