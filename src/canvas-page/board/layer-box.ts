/**
 * Story CSS shares the board's document, and a story rule with an id or `:root` selector, or with
 * `!important`, beats any class-based style. The board's canvases must stay exactly over each other
 * (strokes over stories), so their layout-critical properties are set inline with `!important`,
 * which no stylesheet rule can override.
 */

/** Everything that can move, resize, hide or distort a canvas laid over the whole board. */
export const LAYER_BOX: Readonly<Record<string, string>> = {
  position: 'absolute',
  top: '0px',
  right: '0px',
  bottom: '0px',
  left: '0px',
  display: 'block',
  float: 'none',
  'box-sizing': 'border-box',
  width: '100%',
  height: '100%',
  'min-width': '0px',
  'min-height': '0px',
  'max-width': 'none',
  'max-height': 'none',
  'aspect-ratio': 'auto',
  margin: '0px',
  padding: '0px',
  border: '0px none',
  transform: 'none',
  translate: 'none',
  scale: 'none',
  rotate: 'none',
  zoom: '1',
  filter: 'none',
  'clip-path': 'none',
  mask: 'none',
  'mix-blend-mode': 'normal',
  opacity: '1',
  // `inherit`, not `visible`: the board hides itself until it is ready.
  visibility: 'inherit',
  'content-visibility': 'visible',
  'object-fit': 'fill',
  'object-position': '50% 50%',
  background: 'transparent',
};

/** Sets `properties` inline with `!important` on `element`. */
export function pinStyle(element: HTMLElement, properties: Readonly<Record<string, string>>) {
  for (const [name, value] of Object.entries(properties)) element.style.setProperty(name, value, 'important');
}
