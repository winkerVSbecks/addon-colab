/**
 * Test fixture: a project that customises sidebar labels with `sidebar.renderLabel`.
 *
 * The addon makes sidebar story rows draggable onto canvases without touching this slot, so this
 * label must still render (and the rows must still drag). The checks in
 * `scripts/check-board-drag.mjs` look for `data-project-label`.
 */
import React from 'react';

import { addons } from 'storybook/manager-api';

addons.setConfig({
  sidebar: {
    renderLabel: (item) =>
      item.type === 'story'
        ? React.createElement('span', { 'data-project-label': item.id, title: item.name }, item.name)
        : item.name,
  },
});
