/**
 * Freehand strokes over the board, above every frame.
 *
 * Drawn on two plain 2D canvases laid exactly over the board's HTML-in-Canvas surface (same box,
 * same device-pixel backing, same viewport transform as `use-drawable-canvas.ts`), not on the
 * drawable canvas itself: repainting that one re-rasterises every live story with
 * `drawElementImage`, which is too slow to do on every pointer move, and strokes must not take part
 * in its hit-testing. One canvas holds the saved strokes (redrawn when they or the view change); the
 * other holds only the stroke being drawn, redrawn once per animation frame while the pen moves.
 * Neither catches the pointer.
 */
import React, { forwardRef, useImperativeHandle, useLayoutEffect, useRef } from 'react';

import { styled } from 'storybook/theming/emotion';

import { THEME_INK } from '../../board/strokes';
import type { Size, Viewport } from '../../board/viewport';
import type { Stroke } from '../../canvas-file';

type DrawableStroke = Pick<Stroke, 'color' | 'width' | 'points'>;

/** The stroke being drawn, in world coordinates. */
export type LiveStroke = DrawableStroke;

export interface StrokeLayerHandle {
  /** Shows the stroke being drawn (or none); drawn on the next animation frame. */
  setLive: (stroke: LiveStroke | null) => void;
}

export interface StrokeLayerProps {
  view: Viewport;
  size: Size;
  strokes: readonly Stroke[];
  /** What `currentColor` strokes are drawn in: the theme's text colour. */
  ink: string;
  /** Strokes drawn faded (about to be erased). */
  fadedIds?: ReadonlySet<string>;
}

const Layer = styled.canvas({
  // Story CSS shares this document: set everything a `canvas { … }` rule could change.
  position: 'absolute',
  inset: 0,
  zIndex: 1,
  display: 'block',
  width: '100%',
  height: '100%',
  maxWidth: 'none',
  maxHeight: 'none',
  margin: 0,
  padding: 0,
  border: 0,
  background: 'transparent',
  pointerEvents: 'none',
  opacity: 1,
  transform: 'none',
});

/** Strokes through the midpoints of their points, so a simplified stroke still reads as a smooth line. */
export function traceStroke(ctx: CanvasRenderingContext2D, points: DrawableStroke['points']) {
  const [first, ...rest] = points;
  if (!first) return;
  ctx.moveTo(first[0], first[1]);
  if (rest.length === 1) {
    ctx.lineTo(rest[0]![0], rest[0]![1]);
    return;
  }
  for (let i = 0; i < rest.length - 1; i++) {
    const [x, y] = rest[i]!;
    const [nx, ny] = rest[i + 1]!;
    ctx.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2);
  }
  const last = rest[rest.length - 1];
  if (last) ctx.lineTo(last[0], last[1]);
}

export function drawStroke(ctx: CanvasRenderingContext2D, stroke: DrawableStroke, ink: string, alpha = 1) {
  if (stroke.points.length === 0) return;
  const color = stroke.color === THEME_INK ? ink : stroke.color;
  ctx.globalAlpha = alpha;
  if (stroke.points.length === 1) {
    const [x, y] = stroke.points[0]!;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x, y, stroke.width / 2, 0, Math.PI * 2);
    ctx.fill();
    return;
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = stroke.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  traceStroke(ctx, stroke.points);
  ctx.stroke();
}

/** Sizes the canvas backing to the board at the device pixel ratio; returns a context in world coordinates. */
function prepare(canvas: HTMLCanvasElement, size: Size, view: Viewport) {
  const dpr = window.devicePixelRatio || 1;
  const width = Math.round(size.width * dpr);
  const height = Math.round(size.height * dpr);
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, width, height);
  ctx.setTransform(dpr * view.zoom, 0, 0, dpr * view.zoom, dpr * view.x, dpr * view.y);
  return ctx;
}

export const StrokeLayer = forwardRef<StrokeLayerHandle, StrokeLayerProps>(function StrokeLayer(
  { view, size, strokes, ink, fadedIds },
  ref,
) {
  const savedRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
  const live = useRef<LiveStroke | null>(null);
  const frame = useRef(0);
  const latest = useRef({ view, size, ink });
  latest.current = { view, size, ink };

  const drawLive = () => {
    frame.current = 0;
    const canvas = liveRef.current;
    if (!canvas) return;
    const { view: v, size: s, ink: i } = latest.current;
    const ctx = prepare(canvas, s, v);
    if (ctx && live.current) drawStroke(ctx, live.current, i);
  };

  useImperativeHandle(ref, () => ({
    setLive: (stroke) => {
      live.current = stroke;
      if (!frame.current) frame.current = requestAnimationFrame(drawLive);
    },
  }));

  useLayoutEffect(() => () => cancelAnimationFrame(frame.current), []);

  // Saved strokes: redrawn in the same commit as the view, so they move with the frames.
  useLayoutEffect(() => {
    const canvas = savedRef.current;
    if (!canvas || size.width === 0) return;
    const ctx = prepare(canvas, size, view);
    if (!ctx) return;
    for (const stroke of strokes) drawStroke(ctx, stroke, ink, fadedIds?.has(stroke.id) ? 0.25 : 1);
    drawLive();
  }, [view, size, strokes, ink, fadedIds]);

  return (
    <>
      <Layer ref={savedRef} aria-hidden data-colab-stroke-layer="saved" />
      <Layer ref={liveRef} aria-hidden data-colab-stroke-layer="live" />
    </>
  );
});
