/**
 * Storybook's theme for UI the addon draws outside the manager (the canvas page in the preview, and
 * this addon's own stories). The manager themes its UI itself; the preview has no theme, so this
 * follows addon-docs (`DocsContainer` wraps docs pages in `ThemeProvider` with
 * `parameters.docs.theme`, defaulting to the system colour scheme, as the manager does).
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

/**
 * The theme for the canvas page: `parameters.colab.theme`, else the docs theme (projects that theme
 * their docs usually match the manager there), else the system colour scheme.
 */
export function themeFromParameters(parameters: Record<string, unknown> | undefined): ThemeChoice {
  const colab = parameters?.colab as { theme?: ThemeChoice } | undefined;
  const docs = parameters?.docs as { theme?: ThemeChoice } | undefined;
  return colab?.theme ?? docs?.theme;
}

export function StorybookThemeProvider({ theme, children }: { theme: ThemeChoice; children: ReactNode }) {
  return <ThemeProvider theme={resolveTheme(theme)}>{children}</ThemeProvider>;
}
