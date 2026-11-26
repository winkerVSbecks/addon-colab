/**
 * A reset for the board's own UI (comment layer, board toolbar) against a story's global CSS, which
 * shares this document. A rule such as `* { margin: 12px; padding: 8px; font: 20px serif }` would
 * otherwise push the thread's buttons out of view, hide icons inside padded svgs and balloon the
 * list and the toolbar.
 *
 * The reset's specificity is (0,0,2) (`html body` plus a zero-specificity `:where()`): it beats a
 * story's universal (`*`) and single-tag (`button`, `p`) rules, and loses to any class rule, so
 * Storybook's components (emotion classes) and our own styled elements keep the spacing and type
 * they set. A story rule of equal specificity (`ul li`) that comes later can still win; one with a
 * class or id wins anyway, which is the known limit without a shadow root.
 *
 * Width and height are left alone: an author rule would override svg icons' width/height attributes.
 *
 * Containers opt in with the `data-colab-reset` attribute (`STORY_CSS_RESET_ATTRIBUTE`).
 */
export const STORY_CSS_RESET_ATTRIBUTE = 'data-colab-reset';

const STYLE_ID = 'addon-colab-story-css-reset';

export const STORY_CSS_RESET = `
html body :where([${STORY_CSS_RESET_ATTRIBUTE}], [${STORY_CSS_RESET_ATTRIBUTE}] *) {
  margin: 0;
  padding: 0;
  border-width: 0;
  min-width: 0;
  min-height: 0;
  max-width: none;
  max-height: none;
  float: none;
  font: inherit;
  letter-spacing: inherit;
  text-transform: inherit;
  text-indent: 0;
  text-decoration: inherit;
  color: inherit;
  box-sizing: border-box;
}
`;

/** Adds the reset to `doc` once (idempotent). */
export function installStoryCssReset(doc: Document = document): void {
  if (doc.getElementById(STYLE_ID)) return;
  const style = doc.createElement('style');
  style.id = STYLE_ID;
  style.textContent = STORY_CSS_RESET;
  doc.head.append(style);
}
