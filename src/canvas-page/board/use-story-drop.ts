/**
 * The board as a drop target for stories dragged from Storybook's sidebar (native HTML5 drag and
 * drop: the drag starts in the manager, the drop lands in this preview iframe). The new frame's
 * top-left corner goes where the pointer is, in world coordinates at the current pan and zoom.
 */
import { type RefObject, useEffect, useRef, useState } from 'react';

import { STORY_DRAG_TYPE, defaultFrameWidth, roundPoint } from '../../board/frame-defaults';
import { type Point, type Viewport, screenToWorld } from '../../board/viewport';
import { isCanvasStoryId } from '../../canvas-entry';
import type { PreviewLike } from './story-mount';

export interface StoryDropOptions {
  root: RefObject<HTMLElement | null>;
  view: Viewport;
  preview: PreviewLike | undefined;
  /** Adds the frame; resolves with its id. */
  addFrame: (frame: { storyId: string; x: number; y: number; width: number }) => Promise<string | undefined>;
  onError: (message: string) => void;
}

function carriesStory(event: DragEvent): boolean {
  return !!event.dataTransfer && [...event.dataTransfer.types].includes(STORY_DRAG_TYPE);
}

/** Returns whether a story is being dragged over the board, for a drop highlight. */
export function useStoryDrop({ root, view, preview, addFrame, onError }: StoryDropOptions): boolean {
  const [over, setOver] = useState(false);
  const latest = useRef({ view, preview, addFrame, onError });
  latest.current = { view, preview, addFrame, onError };

  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let leaveTimer: ReturnType<typeof setTimeout> | undefined;

    const onDragOver = (event: DragEvent) => {
      if (!carriesStory(event)) return;
      event.preventDefault();
      event.dataTransfer!.dropEffect = 'copy';
      // dragleave fires for every child crossed; treat "no dragover for a moment" as having left.
      clearTimeout(leaveTimer);
      leaveTimer = setTimeout(() => setOver(false), 150);
      setOver(true);
    };

    const onDrop = async (event: DragEvent) => {
      if (!carriesStory(event)) return;
      event.preventDefault();
      clearTimeout(leaveTimer);
      setOver(false);
      const storyId = event.dataTransfer!.getData(STORY_DRAG_TYPE).trim();
      const { view: currentView, preview: currentPreview, addFrame: add, onError: fail } = latest.current;
      if (!storyId) return;
      if (isCanvasStoryId(storyId)) {
        fail("A canvas can't be added to a canvas. Drag a story instead.");
        return;
      }
      const rect = element.getBoundingClientRect();
      const screen: Point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const at = roundPoint(screenToWorld(currentView, screen));
      let parameters: Record<string, unknown> | undefined;
      try {
        parameters = (await currentPreview?.loadStory({ storyId }))?.parameters;
      } catch (error) {
        fail(`Couldn't add ${storyId}: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      await add({ storyId, x: at.x, y: at.y, width: defaultFrameWidth(parameters) });
    };

    element.addEventListener('dragover', onDragOver);
    element.addEventListener('drop', onDrop);
    return () => {
      clearTimeout(leaveTimer);
      element.removeEventListener('dragover', onDragOver);
      element.removeEventListener('drop', onDrop);
    };
  }, [root]);

  return over;
}
