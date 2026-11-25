import { defineMain } from '@storybook/react-vite/node';

// Spike-only Storybook: real example stories + the Board experiment. Run: pnpm storybook dev -c spike/.storybook -p 6116
export default defineMain({
  stories: ['../../src/stories/*.stories.ts', '../stories/*.stories.tsx'],
  addons: [],
  framework: '@storybook/react-vite',
});
