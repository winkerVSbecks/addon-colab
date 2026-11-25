import React from 'react';

import { STORY_INDEX_INVALIDATED } from 'storybook/internal/core-events';
import { addons, types } from 'storybook/manager-api';

import { type ChannelLike, onCanvasChanged } from './channel';
import { ADDON_ID } from './constants';
import { CanvasTool } from './manager/CanvasTool';
import { installCanvasLayout } from './manager/layout';
import { leaveCanvas, leaveRemovedCanvas } from './manager/navigation';

const CANVAS_TOOL_ID = `${ADDON_ID}/canvases`;

/**
 * Canvases live on the dev server (`storybook dev`). A static build (`storybook build`) has no canvas
 * server and no canvas entries, so the addon adds nothing to its manager.
 */
const hasCanvasServer = (globalThis as { CONFIG_TYPE?: string }).CONFIG_TYPE !== 'PRODUCTION';

// No addon panel on canvas pages: the board fills the preview.
if (hasCanvasServer) installCanvasLayout(addons);

addons.register(ADDON_ID, (api) => {
  if (!hasCanvasServer) return;

  // Canvases toolbar menu (task 5): new, rename, delete, and the list of canvases.
  addons.add(CANVAS_TOOL_ID, {
    type: types.TOOL,
    title: 'Canvases',
    match: ({ viewMode }) => viewMode === 'story' || viewMode === 'docs',
    render: () => <CanvasTool />,
  });

  // A canvas deleted elsewhere (another tab, an MCP agent, a hand edit) while it is open: leave its
  // page. The store's event usually comes first; the index check catches deletes it does not see.
  const channel = addons.getChannel();
  onCanvasChanged(channel as ChannelLike, (event) => {
    if (event.type === 'deleted') void leaveCanvas(api, event.id);
  });
  channel.on(STORY_INDEX_INVALIDATED, () => void leaveRemovedCanvas(api));
});
