/**
 * Whether this browser can draw the board. The board uses HTML-in-Canvas (`<canvas content="drawable">`
 * with `drawElementImage`), shipped without flags from Chrome 157. Older Chromium behind a flag exposes
 * `drawElementImage` with an obsolete shape, so check `content` and `updateElementGeometry` instead.
 */
export function supportsHtmlInCanvas(proto: object | undefined = globalThis.HTMLCanvasElement?.prototype): boolean {
  return !!proto && 'content' in proto && 'updateElementGeometry' in proto;
}

/** What the unsupported-browser message asks for. */
export const REQUIRED_BROWSER = 'Chrome 157 or later';
