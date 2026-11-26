/**
 * A short message at the bottom-left of the board: something the user did that did not work (a
 * failed save, a canvas dropped on a canvas), or something that can be undone (a removed frame,
 * with an Undo button). Clears itself after a few seconds.
 */
import React, { useEffect } from 'react';

import { Button } from 'storybook/internal/components';
import { styled } from 'storybook/theming/emotion';

export interface BoardNoticeContent {
  message: string;
  /** `error`: something failed. `info`: something happened that the user may want to undo. */
  tone: 'error' | 'info';
  action?: { label: string; run: () => void };
}

export interface BoardNoticeProps {
  notice: BoardNoticeContent | null;
  onDismiss: () => void;
}

/** How long a notice stays: longer when it offers an action. */
export const NOTICE_MS = 6000;
export const ACTION_NOTICE_MS = 10000;

const Box = styled.div(({ theme }) => ({
  position: 'absolute',
  left: 12,
  bottom: 12,
  zIndex: 3,
  maxWidth: 420,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '8px 12px',
  borderRadius: theme.appBorderRadius,
  border: `1px solid ${theme.appBorderColor}`,
  background: theme.background.content,
  color: theme.color.defaultText,
  fontFamily: theme.typography.fonts.base,
  fontSize: theme.typography.size.s2,
  lineHeight: '18px',
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
  '&[data-tone="error"]': { borderLeft: `3px solid ${theme.color.negative}` },
  '&[data-tone="info"]': { borderLeft: `3px solid ${theme.color.secondary}` },
}));

export function BoardNotice({ notice, onDismiss }: BoardNoticeProps) {
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(onDismiss, notice.action ? ACTION_NOTICE_MS : NOTICE_MS);
    return () => clearTimeout(timer);
  }, [notice, onDismiss]);
  return (
    <div role="status" aria-live="polite">
      {notice && (
        <Box data-colab-board-notice={notice.tone} data-tone={notice.tone}>
          <span>{notice.message}</span>
          {notice.action && (
            <Button
              variant="outline"
              size="small"
              ariaLabel={false}
              data-colab-notice-action=""
              onClick={notice.action.run}
            >
              {notice.action.label}
            </Button>
          )}
        </Box>
      )}
    </div>
  );
}
