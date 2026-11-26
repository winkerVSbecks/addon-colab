/**
 * Manager side of the canvas board: stories in the sidebar become drag sources, and the
 * toolbar gets "Add to canvas" while a story is open. Called from `src/manager.tsx`.
 */
import React from 'react';

import { type API, addons, types } from 'storybook/manager-api';

import { ADDON_ID } from '../constants';
import { AddToCanvasTool } from './AddToCanvasTool';
import { installSidebarDrag } from './sidebar-drag';

const ADD_TO_CANVAS_TOOL_ID = `${ADDON_ID}/add-to-canvas`;

export function registerBoard(api: API) {
  addons.add(ADD_TO_CANVAS_TOOL_ID, {
    type: types.TOOL,
    title: 'Add to canvas',
    match: ({ viewMode }) => viewMode === 'story',
    render: () => <AddToCanvasTool />,
  });

  if (typeof document !== 'undefined') {
    installSidebarDrag({
      selectStory: (storyId) => api.selectStory(storyId),
      getData: (storyId) => api.getData(storyId) as { type?: string; tags?: string[] } | undefined,
    });
  }
}
