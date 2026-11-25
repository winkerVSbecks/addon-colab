/**
 * The canvas board: every frame of the canvas file rendered live on an HTML-in-Canvas surface.
 *
 * Mounted by the canvas page once the file has loaded (`canvas` updates live from every source
 * without remounting this component; `channel` is the preview channel for `requestCanvas`).
 */
import React, { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { styled, useTheme } from 'storybook/theming/emotion';

import { boundsOf, DEFAULT_VIEWPORT, fitViewport, type Viewport } from '../board/viewport';
import { frameRect } from '../board/frame-defaults';
import type { CanvasFile } from '../canvas-file';
import type { ChannelLike } from '../channel';
import { FrameBody } from './board/FrameBody';
import { drawableCanvasProps } from './board/html-in-canvas';
import { getPreview } from './board/story-mount';
import { type PaintScene, useDrawableCanvas } from './board/use-drawable-canvas';

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
}));

const Surface = styled.canvas({
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  display: 'block',
});

export function CanvasBoard({ canvas }: CanvasBoardProps) {
  const theme = useTheme();
  const preview = useMemo(() => getPreview(), []);
  const rootRef = useRef<HTMLDivElement>(null);
  const elementsRef = useRef(new Map<string, HTMLElement>());
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(new Map());
  const [view] = useState<Viewport>(DEFAULT_VIEWPORT);

  const frames = canvas.frames;
  const scene = useRef<PaintScene>({
    view,
    frames,
    elements: elementsRef.current,
    colors: { dot: theme.appBorderColor, frameBorder: theme.appBorderColor },
  });
  scene.current = {
    view,
    frames,
    elements: elementsRef.current,
    colors: { dot: theme.appBorderColor, frameBorder: theme.appBorderColor },
  };

  const { canvasRef, size, paint } = useDrawableCanvas(rootRef, scene);

  // The first time the board has a size, show all frames.
  const [fitted, setFitted] = useState<Viewport | null>(null);
  useLayoutEffect(() => {
    if (fitted || size.width === 0) return;
    const bounds = boundsOf(frames.map((frame) => frameRect(frame, heights.get(frame.id))));
    setFitted(bounds ? fitViewport(bounds, size) : DEFAULT_VIEWPORT);
  }, [fitted, size, frames, heights]);
  if (fitted && scene.current.view !== fitted) scene.current.view = fitted;

  useLayoutEffect(() => paint());

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
    <Root ref={rootRef} data-colab-board={canvas.id}>
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
              refreshKey={0}
            />
          ))}
      </Surface>
    </Root>
  );
}
