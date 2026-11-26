/**
 * Types for the parts of HTML-in-Canvas the board uses (Chrome 157+; TypeScript's DOM types do not
 * have them yet). See https://github.com/WICG/html-in-canvas.
 *
 * - `<canvas content="drawable">` lays out its `drawable` children without showing them.
 * - `ctx.drawElementImage(el, x, y, width, height)` draws a child and registers where it was drawn,
 *   so pointer events and `getBoundingClientRect()` match the drawing (the last drawn is on top).
 * - The canvas fires `paint` whenever a drawn child changes; anything else (pan, zoom, moves) must
 *   call `requestPaint()`.
 */

export interface DrawableCanvasContext extends CanvasRenderingContext2D {
  reset(): void;
  drawElementImage(element: Element, x: number, y: number, width: number, height: number): void;
}

export interface DrawableCanvas extends HTMLCanvasElement {
  requestPaint(): void;
  onpaint: ((event: Event) => void) | null;
}

/** Spread on the `<canvas>`: React passes `content` through, but its typings do not know it. */
export const drawableCanvasProps = { content: 'drawable' } as Record<string, string>;

/** Attribute every child the canvas draws must have. */
export const DRAWABLE_ATTRIBUTE = 'drawable';
