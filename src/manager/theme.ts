/**
 * Manager side of `src/theme-sync.ts`: answers the canvas page's theme requests with the theme the
 * manager is showing.
 */
import { useEffect } from 'react';

import { addons, useStorybookState } from 'storybook/manager-api';
import { type ThemeVars, create } from 'storybook/theming';

import type { ChannelLike } from '../channel';
import { serveManagerTheme } from '../theme-sync';

let live: ThemeVars | undefined;
let send: ((theme: ThemeVars) => void) | undefined;

/**
 * The manager's theme. Storybook sets it to `addons.setConfig({ theme })` or, without one, `create()`
 * (the system colour scheme); `live` is the state's theme once a manager component has seen it.
 */
export function currentManagerTheme(): ThemeVars {
  return live ?? (addons.getConfig().theme as ThemeVars | undefined) ?? create();
}

/** Call once from `addons.register`. */
export function installManagerTheme(channel: ChannelLike): void {
  send = serveManagerTheme(channel, currentManagerTheme);
}

/** Keeps the canvas page in step when the manager's theme changes at runtime (`api.setOptions`). */
export function useSyncManagerTheme(): void {
  const { theme } = useStorybookState();
  useEffect(() => {
    if (!theme || theme === live) return;
    const changed = live !== undefined;
    live = theme;
    if (changed) send?.(theme);
  }, [theme]);
}
