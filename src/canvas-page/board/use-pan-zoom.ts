/**
 * Pointer and wheel input that moves the board's viewport:
 * - trackpad scroll / mouse wheel pans; shift+wheel pans sideways with a plain mouse wheel;
 * - pinch (Chrome reports it as ctrl+wheel) and ctrl/⌘+wheel zoom around the pointer;
 * - dragging the empty background, the middle button anywhere, or any drag while Space is held pans
 *   (Space only counts while focus is on the board itself, see `src/board/keyboard.ts`).
 *
 * Everything else reaches the stories untouched, so they stay interactive.
 */
import { type RefObject, useEffect, useRef, useState } from 'react';

import { focusPlace, spaceStartsPan } from '../../board/keyboard';
import { type Point, wheelDeltaToPixels, wheelZoomFactor, zoomAt } from '../../board/viewport';
import type { BoardView } from './use-board-view';

export interface PanZoomOptions {
  root: RefObject<HTMLElement | null>;
  /** The board's canvas: a pointerdown on it (not on a drawn frame) is a press on empty space. */
  surface: RefObject<HTMLElement | null>;
  board: BoardView;
  /** Called on a press on empty space (clears the selection). */
  onBackgroundPress?: () => void;
}

export function usePanZoom({ root, surface, board, onBackgroundPress }: PanZoomOptions) {
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);
  const boardRef = useRef(board);
  boardRef.current = board;
  const backgroundRef = useRef(onBackgroundPress);
  backgroundRef.current = onBackgroundPress;
  const spaceRef = useRef(false);
  spaceRef.current = spaceHeld;

  // Wheel: needs a non-passive listener to stop the page (and the browser) zooming or scrolling.
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = element.getBoundingClientRect();
      const anchor: Point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      const dx = wheelDeltaToPixels(event.deltaX, event.deltaMode, rect.width);
      const dy = wheelDeltaToPixels(event.deltaY, event.deltaMode, rect.height);
      if (event.ctrlKey || event.metaKey) {
        boardRef.current.setView((view) => zoomAt(view, anchor, view.zoom * wheelZoomFactor(dy)));
      } else if (event.shiftKey && dx === 0) {
        boardRef.current.panBy(-dy, 0);
      } else {
        boardRef.current.panBy(-dx, -dy);
      }
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, [root]);

  // Space held: the next drag pans, wherever it starts.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Space belongs to whatever has focus (a button in a story, say) unless that is the board.
      if (event.code !== 'Space' || event.defaultPrevented) return;
      if (!spaceStartsPan(focusPlace(document.activeElement))) return;
      event.preventDefault();
      if (!event.repeat) setSpaceHeld(true);
    };
    const onKeyUp = (event: KeyboardEvent) => event.code === 'Space' && setSpaceHeld(false);
    const onBlur = () => setSpaceHeld(false);
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // Drag to pan. Listens in the capture phase so a middle-button or Space drag over a story pans
  // instead of reaching the story.
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    let drag: { id: number; x: number; y: number } | undefined;

    const onPointerDown = (event: PointerEvent) => {
      const onBackground = event.target === surface.current;
      const wantsPan = event.button === 1 || (event.button === 0 && (spaceRef.current || onBackground));
      if (!wantsPan) return;
      if (onBackground && event.button === 0 && !spaceRef.current) backgroundRef.current?.();
      event.preventDefault();
      event.stopPropagation();
      // preventDefault also stops the click from focusing the preview, which Space and Delete need.
      element.focus({ preventScroll: true });
      drag = { id: event.pointerId, x: event.clientX, y: event.clientY };
      element.setPointerCapture(event.pointerId);
      setPanning(true);
    };
    const onPointerMove = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      drag = { ...drag, x: event.clientX, y: event.clientY };
      if (dx || dy) boardRef.current.panBy(dx, dy);
    };
    const onPointerUp = (event: PointerEvent) => {
      if (!drag || event.pointerId !== drag.id) return;
      drag = undefined;
      if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId);
      setPanning(false);
    };
    // Middle-click would otherwise start autoscroll or paste on some systems.
    const onAuxClick = (event: MouseEvent) => event.button === 1 && event.preventDefault();

    element.addEventListener('pointerdown', onPointerDown, true);
    element.addEventListener('pointermove', onPointerMove);
    element.addEventListener('pointerup', onPointerUp);
    element.addEventListener('pointercancel', onPointerUp);
    element.addEventListener('auxclick', onAuxClick);
    return () => {
      element.removeEventListener('pointerdown', onPointerDown, true);
      element.removeEventListener('pointermove', onPointerMove);
      element.removeEventListener('pointerup', onPointerUp);
      element.removeEventListener('pointercancel', onPointerUp);
      element.removeEventListener('auxclick', onAuxClick);
    };
  }, [root, surface]);

  return { spaceHeld, panning };
}
