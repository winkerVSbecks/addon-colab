/**
 * Storybook's theme for UI the addon draws outside the manager (the canvas page in the preview, and
 * this addon's own stories). The manager themes its UI itself; the preview has no theme of its own.
 * The canvas page follows the manager's theme (see `chooseCanvasTheme`); stories pick one directly.
 */
import React, { type ReactNode } from 'react';

import type { ThemeVars } from 'storybook/theming';
import { ThemeProvider, convert, ensure, getPreferredColorScheme, themes } from 'storybook/theming/emotion';

/** `'light'`, `'dark'`, a theme from `create()`, or nothing for the system colour scheme. */
export type ThemeChoice = 'light' | 'dark' | ThemeVars | undefined;

export function resolveTheme(choice: ThemeChoice) {
  if (choice && typeof choice === 'object') return ensure(choice);
  return convert(themes[choice ?? getPreferredColorScheme()]);
}

/** The theme choices a story's parameters make for the canvas page. */
export interface CanvasThemeParameters {
  /** `parameters.colab.theme`: wins over the manager theme. */
  theme?: ThemeChoice;
  /** `parameters.docs.theme`: used only until (or unless) the manager says which theme it uses. */
  fallback?: ThemeChoice;
}

export function canvasThemeParameters(parameters: Record<string, unknown> | undefined): CanvasThemeParameters {
  const colab = parameters?.colab as { theme?: ThemeChoice } | undefined;
  const docs = parameters?.docs as { theme?: ThemeChoice } | undefined;
  return { theme: colab?.theme, fallback: docs?.theme };
}

/**
 * The theme for the canvas page, in order: `parameters.colab.theme`, the manager's theme (sent over
 * the channel, see `src/theme-sync.ts`), `parameters.docs.theme`, the system colour scheme.
 */
export function chooseCanvasTheme({
  theme,
  manager,
  fallback,
}: CanvasThemeParameters & { manager?: ThemeVars }): ThemeChoice {
  return theme ?? manager ?? fallback;
}

export function StorybookThemeProvider({ theme, children }: { theme: ThemeChoice; children: ReactNode }) {
  return <ThemeProvider theme={resolveTheme(theme)}>{children}</ThemeProvider>;
}
