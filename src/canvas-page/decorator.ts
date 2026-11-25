import React from 'react';

import { addons } from 'storybook/preview-api';
import type { DecoratorFunction, Renderer } from 'storybook/internal/types';

import { CANVAS_PARAMETER } from '../canvas-entry';
import { canvasThemeParameters } from '../ui-theme';
import { CanvasPage } from './CanvasPage';

/**
 * Renders the canvas page instead of the story for canvas entries. Their CSF stub (see
 * `src/server/canvas-index.ts`) cannot import anything, so the page comes from here.
 */
export const withCanvasPage: DecoratorFunction<Renderer> = (Story, context) => {
  const fileId = context.parameters[CANVAS_PARAMETER];
  if (typeof fileId !== 'string') return Story();
  return React.createElement(CanvasPage, {
    key: fileId,
    fileId,
    channel: addons.getChannel(),
    ...canvasThemeParameters(context.parameters),
  }) as unknown as ReturnType<typeof Story>;
};
