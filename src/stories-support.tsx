/** Decorators for this addon's own UI stories: render under Storybook's light and dark themes. */
import React from 'react';

import type { Decorator } from '@storybook/react-vite';
import { Global, styled } from 'storybook/theming/emotion';

import { StorybookThemeProvider } from './ui-theme';

const Row = styled.div({ display: 'flex', flexWrap: 'wrap', gap: 16, padding: 16 });

const Pane = styled.div<{ height?: number }>(({ theme, height }) => ({
  flex: '1 1 320px',
  // A transform makes position: fixed children (the canvas page) fill this pane instead of the window.
  transform: 'translateZ(0)',
  position: 'relative',
  height,
  overflow: 'hidden',
  background: theme.background.app,
  color: theme.color.defaultText,
  fontFamily: theme.typography.fonts.base,
  border: `1px solid ${theme.appBorderColor}`,
  borderRadius: theme.appBorderRadius,
}));

/** Renders the story twice, light and dark. `parameters.paneHeight` sets the pane height. */
export const withLightAndDark: Decorator = (Story, context) => {
  const height = context.parameters.paneHeight as number | undefined;
  return (
    <Row>
      {(['light', 'dark'] as const).map((theme) => (
        <StorybookThemeProvider key={theme} theme={theme}>
          <Pane height={height} data-theme={theme}>
            <Story />
          </Pane>
        </StorybookThemeProvider>
      ))}
    </Row>
  );
};

/**
 * Renders the story under one theme, `parameters.uiTheme` (`'light'` or `'dark'`). For modals, which portal out
 * to `<body>`: the body gets the theme's font, as it has in the manager, so the dialog text is not the browser's serif.
 */
export const withUiTheme: Decorator = (Story, context) => (
  <StorybookThemeProvider theme={context.parameters.uiTheme as 'light' | 'dark' | undefined}>
    <Global styles={({ typography }) => ({ body: { fontFamily: typography.fonts.base } })} />
    <Story />
  </StorybookThemeProvider>
);
