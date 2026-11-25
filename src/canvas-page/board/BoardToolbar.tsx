/**
 * The board's zoom controls, floating in the bottom-right corner of the canvas page.
 *
 * Built like addon-docs' story toolbar (`code/addons/docs/src/blocks/components/Toolbar.tsx`:
 * Storybook's `Toolbar` with ghost `Button`s and `ZoomIcon` / `ZoomOutIcon` / `ZoomResetIcon`) and
 * the manager's zoom tool (`code/core/src/manager/components/preview/tools/zoom.tsx`, which shows the
 * percentage and resets to 100%). Storybook's own toolbar zoom scales the whole preview iframe, so
 * the board has its own controls inside the preview.
 */
import React from 'react';

import { Button, Separator, Toolbar } from 'storybook/internal/components';
import { ExpandAltIcon, ZoomIcon, ZoomOutIcon } from '@storybook/icons';
import { styled } from 'storybook/theming/emotion';

import { MAX_ZOOM, MIN_ZOOM } from '../../board/viewport';

export interface BoardToolbarProps {
  zoom: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onFit: () => void;
  canFit: boolean;
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
}));

const Percent = styled(Button)({
  minWidth: 52,
  justifyContent: 'center',
  fontVariantNumeric: 'tabular-nums',
});

export function BoardToolbar({ zoom, onZoomIn, onZoomOut, onResetZoom, onFit, canFit }: BoardToolbarProps) {
  const percent = `${Math.round(zoom * 100)}%`;
  return (
    <Floating data-colab-board-toolbar="">
      <Toolbar aria-label="Canvas zoom" innerStyle={{ gap: 2, paddingInline: 4 }}>
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
          <ExpandAltIcon />
        </Button>
      </Toolbar>
    </Floating>
  );
}
