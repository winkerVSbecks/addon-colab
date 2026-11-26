// Storybook config for the browser checks (`pnpm check:browser`). It loads the addon straight from
// src/ and keeps canvases in its own throwaway folder ($COLAB_CHECK_CANVAS_DIR, set by
// scripts/run-browser-checks.mjs), never in .storybook/canvases.
import { defineMain } from '@storybook/react-vite/node';

const canvasDir = process.env.COLAB_CHECK_CANVAS_DIR;
if (!canvasDir) throw new Error('COLAB_CHECK_CANVAS_DIR is not set; start this config with `pnpm check:browser`');

const config = defineMain({
  stories: ['../../src/**/*.stories.@(js|jsx|ts|tsx)', '../fixtures/*.stories.tsx'],
  addons: ['@storybook/addon-docs', { name: import.meta.resolve('./local-preset.ts'), options: { canvasDir } }],
  framework: '@storybook/react-vite',
});

export default config;
