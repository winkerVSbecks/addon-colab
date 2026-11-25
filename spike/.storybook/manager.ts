import React from 'react';
import { addons, type API } from 'storybook/manager-api';

// (c) Make leaf story items in the sidebar draggable. Uses the single sidebar.renderLabel slot.
//
// Storybook 11's sidebar is a react-aria tree that selects (and so navigates to) a row on
// pointerdown. Without the stopPropagation below, starting a drag navigates the preview to the
// dragged story and the board unmounts before the drop. Storybook does the same for its own
// row buttons (stopRowPress). Clicking the label then navigates explicitly through `api`.
const stopRowPress = (e: { stopPropagation: () => void }) => e.stopPropagation();

addons.setConfig({
  sidebar: {
    renderLabel: (item: { type: string; id: string; name: string }, api: API) =>
      item.type === 'story'
        ? React.createElement(
            'span',
            {
              draggable: true,
              'data-spike-drag': item.id,
              onPointerDown: stopRowPress,
              onMouseDown: stopRowPress,
              onClick: () => api.selectStory(item.id),
              onDragStart: (e: DragEvent & { dataTransfer: DataTransfer }) => {
                e.dataTransfer.setData('application/x-storybook-story', item.id);
                e.dataTransfer.setData('text/plain', item.id);
                e.dataTransfer.effectAllowed = 'copy';
                (window as any).__spikeDragStarted = item.id;
              },
            },
            item.name,
          )
        : item.name,
  },
});
