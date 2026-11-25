import React from 'react';
import { addons } from 'storybook/manager-api';

// (c) Make leaf story items in the sidebar draggable. Uses the single sidebar.renderLabel slot.
addons.setConfig({
  sidebar: {
    renderLabel: (item: { type: string; id: string; name: string }) =>
      item.type === 'story'
        ? React.createElement(
            'span',
            {
              draggable: true,
              'data-spike-drag': item.id,
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
