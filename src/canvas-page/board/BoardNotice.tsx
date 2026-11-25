/**
 * A short message at the bottom-left of the board, for things the user did that did not work (a
 * failed save, a canvas dropped on a canvas). Clears itself after a few seconds.
 */
import React, { useEffect } from 'react';

import { styled } from 'storybook/theming/emotion';

export interface BoardNoticeProps {
  message: string | null;
  onDismiss: () => void;
}

const Box = styled.div(({ theme }) => ({
  position: 'absolute',
  left: 12,
  bottom: 12,
  zIndex: 3,
  maxWidth: 420,
  padding: '8px 12px',
  borderRadius: theme.appBorderRadius,
  border: `1px solid ${theme.appBorderColor}`,
  background: theme.background.content,
  color: theme.color.defaultText,
  fontFamily: theme.typography.fonts.base,
  fontSize: theme.typography.size.s2,
  lineHeight: '18px',
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
  borderLeft: `3px solid ${theme.color.negative}`,
}));

export function BoardNotice({ message, onDismiss }: BoardNoticeProps) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onDismiss, 6000);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);
  return (
    <div role="status" aria-live="polite">
      {message && <Box data-colab-board-notice="">{message}</Box>}
    </div>
  );
}
