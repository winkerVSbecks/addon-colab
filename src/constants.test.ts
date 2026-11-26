import { describe, expect, it } from 'vitest';

import { ADDON_ID } from './constants';

describe('constants', () => {
  it('uses the addon-colab id', () => {
    expect(ADDON_ID).toBe('addon-colab');
  });
});
