/**
 * The board's zoom controls, floating in the bottom-right corner of the canvas page.
 *
 * Built like addon-docs' story toolbar (`code/addons/docs/src/blocks/components/Toolbar.tsx`:
 * Storybook's `Toolbar` with ghost `Button`s and `ZoomIcon` / `ZoomOutIcon` / `ZoomResetIcon`) and
 * the manager's zoom tool (`code/core/src/manager/components/preview/tools/zoom.tsx`, which shows the
 * percentage and resets to 100%). Storybook's own toolbar zoom scales the whole preview iframe, so
 * the board has its own controls inside the preview.
 *
 * The mode switcher (select / comment / draw, `src/board/modes.ts`) comes first: one `ToggleButton`
 * per mode, `pressed` for the current one, the way the manager's toolbar toggles work (e.g. the
 * outline and measure tools, `code/core/src/outline/OutlineSelector.tsx` and `code/core/src/measure/Tool.tsx`). It is shown once the
 * board offers more than one mode.
 */
import React from 'react';

import { Button, Separator, ToggleButton, Toolbar } from 'storybook/internal/components';
import {
  CommentIcon,
  CommentsIcon,
  MarkupIcon,
  PointerDefaultIcon,
  ZoomIcon,
  ZoomOutIcon,
  ZoomResetIcon,
} from '@storybook/icons';
import { styled } from 'storybook/theming/emotion';

import { type BoardMode, MODE_LABELS, MODE_SHORTCUTS } from '../../board/modes';
import { MAX_ZOOM, MIN_ZOOM } from '../../board/viewport';
import { storyCssShield } from './comment-ui';

const MODE_ICONS: Record<BoardMode, React.ReactNode> = {
  select: <PointerDefaultIcon />,
  comment: <CommentIcon />,
  draw: <MarkupIcon />,
};

export interface BoardToolbarProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onFit: () => void;
  canFit: boolean;
  /** The current board mode. */
  mode?: BoardMode;
  /** The modes the board offers, in switcher order (the switcher shows with two or more). */
  modes?: readonly BoardMode[];
  onModeChange?: (mode: BoardMode) => void;
  /** Open comments on the canvas (shown on the comment list button). */
  commentCount?: number;
  commentsOpen?: boolean;
  /** Shows or hides the comment list; no button without it. */
  onToggleComments?: () => void;
}

const Floating = styled.div(({ theme }) => ({
  position: 'absolute',
  right: 12,
  bottom: 12,
  zIndex: 3,
  borderRadius: theme.appBorderRadius,
  border: `1px solid ${theme.appBorderColor}`,
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
  overflow: 'hidden',
  '& > *': { border: 'none' },
  // Story CSS shares this page (e.g. \`button { width: 100% }\`): keep Storybook's button sizes.
  ...storyCssShield,
}));

const Count = styled.span({ fontVariantNumeric: 'tabular-nums', marginLeft: 2 });

const Percent = styled(Button)({
  minWidth: 52,
  justifyContent: 'center',
  fontVariantNumeric: 'tabular-nums',
});

export function BoardToolbar({
  zoom,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onFit,
  canFit,
  mode = 'select',
  modes = [],
  onModeChange,
  commentCount = 0,
  commentsOpen = false,
  onToggleComments,
}: BoardToolbarProps) {
  const percent = `${Math.round(zoom * 100)}%`;
  return (
    <Floating data-colab-board-toolbar="">
      <Toolbar aria-label="Canvas tools" innerStyle={{ gap: 2, paddingInline: 4 }}>
        {modes.length > 1 && (
          <>
            {modes.map((option) => (
              <ToggleButton
                key={option}
                variant="ghost"
                padding="small"
                pressed={option === mode}
                ariaLabel={MODE_LABELS[option]}
                tooltip={`${MODE_LABELS[option]} (${MODE_SHORTCUTS[option].toUpperCase()})`}
                data-colab-mode={option}
                onClick={() => onModeChange?.(option)}
              >
                {MODE_ICONS[option]}
              </ToggleButton>
            ))}
            <Separator />
          </>
        )}
        {onToggleComments && (
          <>
            <ToggleButton
              variant="ghost"
              padding="small"
              pressed={commentsOpen}
              ariaLabel={`Comments (${commentCount} open)`}
              tooltip={commentsOpen ? 'Hide comments' : 'Show comments'}
              data-colab-comments-toggle=""
              onClick={onToggleComments}
            >
              <CommentsIcon />
              {commentCount > 0 && <Count>{commentCount}</Count>}
            </ToggleButton>
            <Separator />
          </>
        )}
        <Button
          variant="ghost"
          padding="small"
          ariaLabel="Zoom out"
          onClick={onZoomOut}
          disabled={zoom <= MIN_ZOOM + 1e-6}
        >
          <ZoomOutIcon />
        </Button>
        <Percent variant="ghost" padding="small" ariaLabel={`Zoom ${percent}, reset to 100%`} onClick={onResetZoom}>
          {percent}
        </Percent>
        <Button
          variant="ghost"
          padding="small"
          ariaLabel="Zoom in"
          onClick={onZoomIn}
          disabled={zoom >= MAX_ZOOM - 1e-6}
        >
          <ZoomIcon />
        </Button>
        <Separator />
        <Button variant="ghost" padding="small" ariaLabel="Zoom to fit all stories" onClick={onFit} disabled={!canFit}>
          <ZoomResetIcon />
        </Button>
      </Toolbar>
    </Floating>
  );
}
