import { useEffect, useState } from 'react';

import type { ThemeVars } from 'storybook/theming';

import type { ChannelLike } from '../channel';
import { followManagerTheme } from '../theme-sync';

// The last theme the manager sent. The preview iframe outlives canvas pages, so the next page
// starts in the right theme instead of flashing the fallback.
let lastManagerTheme: ThemeVars | undefined;

/** The manager's theme, once it has answered (`undefined` until then, or without a manager). */
export function useManagerTheme(channel: ChannelLike): ThemeVars | undefined {
  const [theme, setTheme] = useState(lastManagerTheme);
  useEffect(
    () =>
      followManagerTheme(channel, (next) => {
        lastManagerTheme = next;
        setTheme(next);
      }),
    [channel],
  );
  return theme;
}
