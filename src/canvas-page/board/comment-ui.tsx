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
