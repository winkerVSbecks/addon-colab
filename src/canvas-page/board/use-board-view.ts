/**
 * The board's viewport: pan and zoom state, remembered per canvas in this browser (localStorage),
 * so a reload shows the same part of the canvas. A canvas opened for the first time is fitted to its
 * frames once their heights are known.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import {
  type Point,
  type Rect,
  type Size,
  type Viewport,
  DEFAULT_VIEWPORT,
  fitViewport,
  isViewport,
  panBy,
  stepZoom,
  zoomAt,
} from '../../board/viewport';

const STORAGE_PREFIX = 'addon-colab:board-view:';

function readStoredView(canvasId: string): Viewport | undefined {
  try {
    const value: unknown = JSON.parse(globalThis.localStorage?.getItem(STORAGE_PREFIX + canvasId) ?? 'null');
    return isViewport(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

function storeView(canvasId: string, view: Viewport) {
  try {
    globalThis.localStorage?.setItem(STORAGE_PREFIX + canvasId, JSON.stringify(view));
  } catch {
    // Private mode or quota: the view is just not remembered.
  }
}

export interface BoardView {
  view: Viewport;
  /** False until a stored view was found or the frames were fitted once. */
  ready: boolean;
  setView: (update: (view: Viewport) => Viewport) => void;
  panBy: (dx: number, dy: number) => void;
  zoomAt: (anchor: Point, zoom: number) => void;
  zoomStep: (direction: 1 | -1) => void;
  zoomTo: (zoom: number) => void;
  fit: () => void;
}

/**
 * `contentBounds` is the bounding box of the frames (undefined for an empty canvas); `contentReady`
 * says whether their heights are measured, so the first fit sees the real sizes.
 */
export function useBoardView(
  canvasId: string,
  size: Size,
  contentBounds: Rect | undefined,
  contentReady: boolean,
): BoardView {
  const [state, setState] = useState(() => {
    const stored = readStoredView(canvasId);
    return { view: stored ?? DEFAULT_VIEWPORT, ready: !!stored };
  });
  const sizeRef = useRef(size);
  sizeRef.current = size;
  const boundsRef = useRef(contentBounds);
  boundsRef.current = contentBounds;

  // First visit: fit once the board has a size and the frames have been measured.
  useEffect(() => {
    if (state.ready || size.width === 0 || !contentReady) return;
    setState({ view: contentBounds ? fitViewport(contentBounds, size) : DEFAULT_VIEWPORT, ready: true });
  }, [state.ready, size, contentBounds, contentReady]);

  // Remember the view, a moment after it stops changing.
  useEffect(() => {
    if (!state.ready) return;
    const timer = setTimeout(() => storeView(canvasId, state.view), 250);
    return () => clearTimeout(timer);
  }, [canvasId, state]);

  const setView = useCallback(
    (update: (view: Viewport) => Viewport) => setState((current) => ({ view: update(current.view), ready: true })),
    [],
  );
  const center = () => ({ x: sizeRef.current.width / 2, y: sizeRef.current.height / 2 });

  return {
    view: state.view,
    ready: state.ready,
    setView,
    panBy: useCallback((dx, dy) => setView((view) => panBy(view, dx, dy)), [setView]),
    zoomAt: useCallback((anchor, zoom) => setView((view) => zoomAt(view, anchor, zoom)), [setView]),
    zoomStep: useCallback(
      (direction) => setView((view) => zoomAt(view, center(), stepZoom(view.zoom, direction))),
      [setView],
    ),
    zoomTo: useCallback((zoom) => setView((view) => zoomAt(view, center(), zoom)), [setView]),
    fit: useCallback(
      () =>
        setView((view) => {
          const bounds = boundsRef.current;
          return bounds ? fitViewport(bounds, sizeRef.current) : { ...DEFAULT_VIEWPORT, zoom: view.zoom };
        }),
      [setView],
    ),
  };
}
