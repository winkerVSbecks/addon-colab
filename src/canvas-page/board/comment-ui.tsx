/** Small pieces shared by the comment layer and the comment list. */
import React from 'react';

import { SparkleIcon, UserIcon } from '@storybook/icons';

import type { Author } from '../../canvas-file';

/** Text styles every element of the layer sets for itself (stories' CSS must not change them). */
export const hardText = (theme: {
  typography: { fonts: { base: string }; size: { s2: number } };
  color: { defaultText: string };
}) =>
  ({
    fontFamily: theme.typography.fonts.base,
    fontSize: theme.typography.size.s2 - 1,
    fontWeight: 400,
    fontStyle: 'normal',
    lineHeight: '18px',
    letterSpacing: 'normal',
    textTransform: 'none',
    textAlign: 'left',
    color: theme.color.defaultText,
    boxSizing: 'border-box',
    margin: 0,
  }) as const;

export function authorLabel(author: Author): string {
  return author === 'agent' ? 'Agent' : 'You';
}

export function AuthorIcon({ author }: { author: Author }) {
  return author === 'agent' ? <SparkleIcon aria-hidden /> : <UserIcon aria-hidden />;
}

/**
 * Resets for story CSS that reaches the board's page, for a container of Storybook components.
 * Specificity (0,2,1) beats a story's tag, universal and single-class/attribute rules, and only
 * touches what Storybook's components leave at their defaults: the size of buttons (width, min
 * and max width are auto/auto/none on every Storybook Button), and the box of elements that have no
 * class at all (plain list items and wrappers). Elements marked `data-colab-own` style themselves.
 */
export const storyCssShield = {
  '&& button:not([data-colab-own])': {
    width: 'auto',
    minWidth: 'auto',
    maxWidth: 'none',
    margin: 0,
    textTransform: 'none',
    letterSpacing: 'normal',
  },
  '&& :where(:not([class]):not(svg, svg *))': { margin: 0, padding: 0, border: 0, minWidth: 0 },
} as const;

/** The box properties a story's universal or tag rules could change on a plain container. */
export const box = { margin: 0, border: 0, padding: 0, boxSizing: 'border-box', minWidth: 0 } as const;
