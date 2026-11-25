/**
 * Keeps the board's `<canvas content="drawable">` the size of its container at the device pixel
 * ratio, and paints the frames with `drawElementImage` under the current viewport.
 *
 * Gotchas (see the spike findings): the context is scaled by the device pixel ratio, so every
 * `drawElementImage` call passes the element's CSS size explicitly (without it, Chrome draws at the
 * default size in device pixels and hit-testing disagrees with the pixels at DPR > 1). Drawing order
 * is hit-test order: the last frame drawn is on top.
 */
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

import type { Rect, Size, Viewport } from '../../board/viewport';
import type { DrawableCanvas, DrawableCanvasContext } from './html-in-canvas';

export interface PaintFrame {
  id: string;
  x: number;
  y: number;
}

export interface PaintScene {
  view: Viewport;
  frames: readonly PaintFrame[];
  elements: ReadonlyMap<string, HTMLElement>;
  colors: { dot: string; frameBorder: string };
}

const GRID = 24;

function drawGrid(ctx: CanvasRenderingContext2D, view: Viewport, size: Size, color: string) {
  let step = GRID * view.zoom;
  while (step < 12) step *= 2;
  const radius = view.zoom >= 0.5 ? 1 : 0.75;
  const startX = ((view.x % step) + step) % step;
  const startY = ((view.y % step) + step) % step;
  ctx.fillStyle = color;
  ctx.beginPath();
  for (let x = startX; x < size.width; x += step) {
    for (let y = startY; y < size.height; y += step) {
      ctx.moveTo(x + radius, y);
      ctx.arc(x, y, radius, 0, Math.PI * 2);
    }
  }
  ctx.fill();
}

/**
 * Returns the canvas ref, the board's size in CSS pixels, and `paint()` to request a repaint after
 * anything in the scene changed. Frames are drawn from `scene.current` at paint time.
 */
export function useDrawableCanvas(container: RefObject<HTMLElement | null>, scene: RefObject<PaintScene>) {
  const canvasRef = useRef<DrawableCanvas>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  /** Where each frame was last drawn, in world coordinates, for hit tests outside the canvas. */
  const drawnRef = useRef(new Map<string, Rect>());

  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;
    const update = () => {
      const rect = element.getBoundingClientRect();
      setSize((current) =>
        current.width === rect.width && current.height === rect.height
          ? current
          : { width: rect.width, height: rect.height },
      );
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(element);
    window.addEventListener('resize', update);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [container]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d') as DrawableCanvasContext | null;
    if (!ctx) return;

    canvas.onpaint = () => {
      const current = scene.current;
      if (!current) return;
      const dpr = window.devicePixelRatio || 1;
      const width = canvas.width / dpr;
      const height = canvas.height / dpr;
      ctx.reset();
      ctx.scale(dpr, dpr);
      drawGrid(ctx, current.view, { width, height }, current.colors.dot);
      ctx.translate(current.view.x, current.view.y);
      ctx.scale(current.view.zoom, current.view.zoom);
      drawnRef.current.clear();
      for (const frame of current.frames) {
        const element = current.elements.get(frame.id);
        if (!element || !element.isConnected) continue;
        const w = element.offsetWidth;
        const h = element.offsetHeight;
        try {
          ctx.drawElementImage(element, frame.x, frame.y, w, h);
        } catch {
          // Not laid out yet (first frame after mount); the next paint draws it.
          continue;
        }
        drawnRef.current.set(frame.id, { x: frame.x, y: frame.y, width: w, height: h });
        ctx.strokeStyle = current.colors.frameBorder;
        ctx.lineWidth = 1 / current.view.zoom;
        ctx.strokeRect(
          frame.x - 0.5 / current.view.zoom,
          frame.y - 0.5 / current.view.zoom,
          w + 1 / current.view.zoom,
          h + 1 / current.view.zoom,
        );
      }
    };
    canvas.requestPaint();
    return () => {
      canvas.onpaint = null;
    };
  }, [scene]);

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(size.width * dpr);
    canvas.height = Math.round(size.height * dpr);
    canvas.requestPaint();
  }, [size]);

  const paint = useCallback(() => canvasRef.current?.requestPaint(), []);

  return { canvasRef, size, paint, drawnRef };
}
