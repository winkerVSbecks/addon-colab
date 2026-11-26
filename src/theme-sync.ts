/**
 * Tells the canvas page (preview) which theme the manager is using. Storybook 11 has no built-in way
 * for the preview to learn the manager theme (addon-docs asks projects to repeat it in
 * `parameters.docs.theme`), so the addon uses its own channel events:
 *
 * - The preview emits `THEME_REQUEST` when a canvas page mounts.
 * - The manager answers with `THEME_CHANGED` (the theme it was configured with: `addons.setConfig({ theme })`
 *   in `.storybook/manager`, else Storybook's default, which follows the system colour scheme), and
 *   emits it again whenever its live theme changes (`api.setOptions({ theme })`).
 *
 * Payloads are JSON strings, like the canvas channel's (see `src/channel.ts`).
 * Safe in manager and preview: only type imports plus `ADDON_ID`.
 */
import type { ThemeVars } from 'storybook/theming';

import type { ChannelLike } from './channel';
import { ADDON_ID } from './constants';

export const THEME_REQUEST = `${ADDON_ID}/theme-request`;
export const THEME_CHANGED = `${ADDON_ID}/theme-changed`;

function decodeTheme(data: unknown): ThemeVars | undefined {
  if (typeof data !== 'string') return undefined;
  try {
    const theme = JSON.parse(data) as Partial<ThemeVars> | null;
    return theme && (theme.base === 'light' || theme.base === 'dark') ? (theme as ThemeVars) : undefined;
  } catch {
    return undefined;
  }
}

/** Manager side: answers theme requests with `getTheme()`. Returns a function that sends a new theme. */
export function serveManagerTheme(channel: ChannelLike, getTheme: () => ThemeVars) {
  const send = (theme: ThemeVars) => channel.emit(THEME_CHANGED, JSON.stringify(theme));
  channel.on(THEME_REQUEST, () => send(getTheme()));
  return send;
}

/** Preview side: asks for the manager theme and follows its changes. Returns an unsubscribe function. */
export function followManagerTheme(channel: ChannelLike, listener: (theme: ThemeVars) => void): () => void {
  const handle = (data: unknown) => {
    const theme = decodeTheme(data);
    if (theme) listener(theme);
  };
  channel.on(THEME_CHANGED, handle);
  channel.emit(THEME_REQUEST);
  return () => channel.off(THEME_CHANGED, handle);
}
