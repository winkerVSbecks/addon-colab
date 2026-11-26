// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';

import { STORY_CSS_RESET, STORY_CSS_RESET_ATTRIBUTE, installStoryCssReset } from './story-css-reset';

describe('installStoryCssReset', () => {
  it('adds the reset once', () => {
    installStoryCssReset(document);
    installStoryCssReset(document);
    const styles = document.querySelectorAll('style#addon-colab-story-css-reset');
    expect(styles).toHaveLength(1);
    expect(styles[0]?.textContent).toBe(STORY_CSS_RESET);
  });

  it('covers the container and everything in it, below class specificity', () => {
    expect(STORY_CSS_RESET).toContain(
      `html body :where([${STORY_CSS_RESET_ATTRIBUTE}], [${STORY_CSS_RESET_ATTRIBUTE}] *)`,
    );
  });
});
