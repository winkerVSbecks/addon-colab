/**
 * The outline ("halo") drawn under every stroke, so a line of any colour stays visible on any
 * background: white story content, the light board, the dark board.
 *
 * Each stroke gets an opaque outline in white or near-black, whichever contrasts more with the
 * stroke's own colour (WCAG relative luminance). The stroke then always has at least about 4:1
 * against its outline, and the outline in turn contrasts with whatever is behind it unless that
 * background already contrasts with the stroke. Nothing is stored: the file keeps the stroke's
 * colour as it was (including `currentColor` for Ink).
 */

export type Rgb = [number, number, number];

export const HALO_LIGHT = 'rgb(255, 255, 255)';
export const HALO_DARK = 'rgb(17, 18, 19)';

/** Outline width on each side of the line, in screen pixels (the same at every zoom). */
export const HALO_SCREEN_PX = 1.5;

/** Reads `#rgb`, `#rrggbb(aa)`, `rgb()` and `rgba()`; alpha is ignored. Anything else: undefined. */
export function parseRgb(value: string): Rgb | undefined {
  const text = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(text)?.[1];
  if (hex) {
    const full = hex.length === 3 ? [...hex].map((c) => c + c).join('') : hex.slice(0, 6);
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16)) as Rgb;
  }
  const fn = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/i.exec(text);
  if (fn) return [Number(fn[1]), Number(fn[2]), Number(fn[3])];
  return undefined;
}

export function relativeLuminance([r, g, b]: Rgb): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const LIGHT = parseRgb(HALO_LIGHT)!;
const DARK = parseRgb(HALO_DARK)!;

/** The outline colour for a stroke colour: the one of white and near-black it contrasts with more. */
export function haloFor(rgb: Rgb): string {
  return contrastRatio(rgb, LIGHT) >= contrastRatio(rgb, DARK) ? HALO_LIGHT : HALO_DARK;
}
