/**
 * The canvas board: every frame of the canvas file rendered live on an HTML-in-Canvas surface, with
 * pan and zoom.
 *
 * Mounted by the canvas page once the file has loaded (`canvas` updates live from every source
 * without remounting this component; `channel` is the preview channel for `requestCanvas`).
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { STORY_UNCHANGED } from 'storybook/internal/core-events';
import { styled, useTheme } from 'storybook/theming/emotion';

import { frameRect } from '../board/frame-defaults';
import { boundsOf } from '../board/viewport';
import type { CanvasFile } from '../canvas-file';
import type { ChannelLike } from '../channel';
import { BoardToolbar } from './board/BoardToolbar';
import { FrameBody } from './board/FrameBody';
import { drawableCanvasProps } from './board/html-in-canvas';
import { getPreview } from './board/story-mount';
import { useBoardView } from './board/use-board-view';
import { type PaintScene, useDrawableCanvas } from './board/use-drawable-canvas';
import { usePanZoom } from './board/use-pan-zoom';

export interface CanvasBoardProps {
  canvas: CanvasFile;
  channel: ChannelLike;
}

const Root = styled.div(({ theme }) => ({
  position: 'absolute',
  inset: 0,
  overflow: 'hidden',
  background: theme.background.app,
  touchAction: 'none',
  outline: 'none',
  '&[data-panning]': { cursor: 'grabbing' },
}));

const Surface = styled.canvas({
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  display: 'block',
});

/** Covers the board while Space is held, so the drag pans and the stories get no hover. */
const PanCatcher = styled.div({
  position: 'absolute',
  inset: 0,
  zIndex: 2,
  cursor: 'grab',
  '[data-panning] > &': { cursor: 'grabbing' },
});

export function CanvasBoard({ canvas, channel }: CanvasBoardProps) {
  const theme = useTheme();
  const preview = useMemo(() => getPreview(), []);
  const rootRef = useRef<HTMLDivElement>(null);
  const elementsRef = useRef(new Map<string, HTMLElement>());
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(new Map());
  const [refreshKey, setRefreshKey] = useState(0);

  const frames = canvas.frames;
  const scene = useRef<PaintScene>(null as unknown as PaintScene);
  const { canvasRef, size, paint } = useDrawableCanvas(rootRef, scene);

  const bounds = useMemo(
    () => boundsOf(frames.map((frame) => frameRect(frame, heights.get(frame.id)))),
    [frames, heights],
  );
  const measured = frames.every((frame) => heights.has(frame.id));
  const board = useBoardView(canvas.id, size, bounds, measured);
  const { spaceHeld, panning } = usePanZoom({ root: rootRef, surface: canvasRef, board });

  scene.current = {
    view: board.view,
    frames,
    elements: elementsRef.current,
    colors: { dot: theme.appBorderColor, frameBorder: theme.appBorderColor },
  };
  useLayoutEffect(() => paint());

  // A story file was hot-reloaded: Storybook re-renders the canvas entry as "unchanged", so each
  // frame reloads its story and re-renders it if its implementation changed.
  useEffect(() => {
    const onUnchanged = () => setRefreshKey((key) => key + 1);
    channel.on(STORY_UNCHANGED, onUnchanged);
    return () => channel.off(STORY_UNCHANGED, onUnchanged);
  }, [channel]);

  const onElement = useCallback((frameId: string, element: HTMLDivElement | null) => {
    if (element) elementsRef.current.set(frameId, element);
    else elementsRef.current.delete(frameId);
  }, []);
  const onMeasure = useCallback(
    (frameId: string, height: number) =>
      setHeights((current) => (current.get(frameId) === height ? current : new Map(current).set(frameId, height))),
    [],
  );
  const onStatus = useCallback(() => undefined, []);

  return (
    <Root
      ref={rootRef}
      data-colab-board={canvas.id}
      tabIndex={-1}
      data-panning={panning ? '' : undefined}
      // Read by the browser checks in scripts/: the viewport and the frames as shown.
      data-colab-board-state={JSON.stringify({ view: board.view, frames })}
      style={{ visibility: board.ready ? 'visible' : 'hidden' }}
    >
      <Surface ref={canvasRef} {...drawableCanvasProps} aria-label={`Canvas ${canvas.name}`}>
        {preview &&
          frames.map((frame) => (
            <FrameBody
              key={frame.id}
              frameId={frame.id}
              storyId={frame.storyId}
              width={frame.width}
              height={frame.height}
              preview={preview}
              onElement={onElement}
              onMeasure={onMeasure}
              onStatus={onStatus}
              refreshKey={refreshKey}
            />
          ))}
      </Surface>
      {spaceHeld && <PanCatcher data-colab-pan-catcher="" />}
      <BoardToolbar
        zoom={board.view.zoom}
        onZoomIn={() => board.zoomStep(1)}
        onZoomOut={() => board.zoomStep(-1)}
        onResetZoom={() => board.zoomTo(1)}
        onFit={board.fit}
        canFit={frames.length > 0}
      />
    </Root>
  );
}
