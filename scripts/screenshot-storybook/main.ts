// Storybook config for the README screenshots (`pnpm screenshots`). It loads the addon straight
// from src/ (through the browser checks' local preset), shows only the example stories, and keeps
// canvases in its own throwaway folder ($COLAB_CHECK_CANVAS_DIR, set by
// scripts/readme-screenshots.mjs), never in .storybook/canvases.
import { defineMain } from '@storybook/react-vite/node';

const canvasDir = process.env.COLAB_CHECK_CANVAS_DIR;
if (!canvasDir) throw new Error('COLAB_CHECK_CANVAS_DIR is not set; start this config with `pnpm screenshots`');

const config = defineMain({
  stories: ['../../src/stories/*.stories.@(js|jsx|ts|tsx)'],
  addons: [
    '@storybook/addon-docs',
    { name: import.meta.resolve('../check-storybook/local-preset.ts'), options: { canvasDir } },
  ],
  framework: '@storybook/react-vite',
});

export default config;
