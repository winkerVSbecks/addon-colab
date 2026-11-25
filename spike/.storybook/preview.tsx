import React, { useEffect } from 'react';

import type { Decorator } from '@storybook/react-vite';

// Sidebar-entry experiment: render the board for canvas entries (see main.ts). Counts mounts so the
// check can tell whether a canvas file change remounts the board.
function Board({ id }: { id: string }) {
  useEffect(() => {
    const w = window as unknown as { __canvasMounts?: string[] };
    (w.__canvasMounts ||= []).push(id);
  }, [id]);
  return <div data-canvas-board={id}>Canvas board placeholder: {id}</div>;
}

const withCanvasBoard: Decorator = (Story, context) => {
  const id = context.parameters.colabCanvas as string | undefined;
  return id ? <Board id={id} /> : <Story />;
};

export default { decorators: [withCanvasBoard] };
