/**
 * Draw mode's options, floating at the top of the board while the mode is on: pen or eraser, a
 * small colour set, three widths, and Clear drawing (with a confirmation dialog; undoable).
 *
 * Built from Storybook's own pieces, the way the manager's toolbar tools and addon-docs' story
 * toolbar are: `Toolbar` + ghost `ToggleButton`s with `tooltip`s (as in
 * `code/core/src/measure/Tool.tsx` and `code/core/src/outline/OutlineSelector.tsx`), and colour
 * swatches like the backgrounds tool's list (`code/core/src/backgrounds/components/Tool.tsx`). The
 * confirmation follows the manager's delete dialogs (`Modal` with a solid action and
 * `Modal.Close` for Cancel, focus on Cancel; see `src/manager/CanvasDialogs.tsx`), rendered inside
 * the board so it shares the board's theme and the story CSS hardening.
 *
 * Colours are Storybook's palette (`color` from `storybook/theming`), the same in light and dark so
 * a stroke means the same thing on every screen, plus "Ink", stored as `currentColor` and drawn in
 * the theme's text colour (dark on light, light on dark).
 */
import React, { useEffect, useRef, useState } from 'react';

import { Button, Modal, Separator, ToggleButton, Toolbar } from 'storybook/internal/components';
import { ClearIcon, PaintBrushIcon, TrashIcon } from '@storybook/icons';
import { color, styled } from 'storybook/theming/emotion';

import { THEME_INK } from '../../board/strokes';
import type { DrawSettings } from './use-draw-tool';

export const DRAW_COLORS: readonly { value: string; label: string }[] = [
  { value: THEME_INK, label: 'Ink' },
  { value: color.negative, label: 'Red' },
  { value: color.warning, label: 'Amber' },
  { value: color.positive, label: 'Green' },
  { value: color.secondary, label: 'Blue' },
  { value: color.purple, label: 'Purple' },
];

export const DRAW_WIDTHS: readonly { value: number; label: string }[] = [
  { value: 2, label: 'Thin' },
  { value: 4, label: 'Medium' },
  { value: 8, label: 'Thick' },
];

export const DEFAULT_DRAW_SETTINGS: DrawSettings = { tool: 'pen', color: color.negative, width: 4 };

const Floating = styled.div(({ theme }) => ({
  position: 'absolute',
  top: 12,
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 3,
  boxSizing: 'border-box',
  borderRadius: theme.appBorderRadius,
  border: `1px solid ${theme.appBorderColor}`,
  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
  overflow: 'hidden',
  '& > *': { border: 'none' },
}));

const Swatch = styled.span(({ theme }) => ({
  display: 'block',
  boxSizing: 'border-box',
  width: 14,
  height: 14,
  borderRadius: '50%',
  border: `1px solid ${theme.appBorderColor}`,
}));

const WidthDot = styled.span({
  display: 'block',
  borderRadius: '50%',
  background: 'currentColor',
});

/** Square 28px slot so the dots of different widths line up. */
const Slot = styled.span({
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 14,
  height: 14,
});

const DeleteButton = styled(Button)(({ theme }) => ({
  // Storybook's Button has no destructive variant; as in the manager's delete dialog.
  '&&': { background: theme.color.negative, color: theme.color.lightest },
  '&&:hover:not(:disabled)': { background: theme.color.negativeText },
}));

export interface DrawOptionsProps {
  settings: DrawSettings;
  onChange: (changes: Partial<DrawSettings>) => void;
  strokeCount: number;
  onClear: () => void;
  /** The board root: the dialog renders inside it. */
  container: HTMLElement | null;
}

export function DrawOptions({ settings, onChange, strokeCount, onClear, container }: DrawOptionsProps) {
  const [confirming, setConfirming] = useState(false);
  // The count the dialog states: follows the canvas while open, then stays put, so the dialog does
  // not read "All 0 strokes" while it fades out after Clear.
  const [shownCount, setShownCount] = useState(strokeCount);
  useEffect(() => {
    if (confirming) setShownCount(strokeCount);
  }, [confirming, strokeCount]);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const isPen = settings.tool === 'pen';

  // The dialog focuses its first button (Clear). Start on Cancel, so Enter does not clear by accident.
  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => cancelRef.current?.focus(), 0);
    return () => clearTimeout(timer);
  }, [confirming]);

  return (
    <Floating data-colab-draw-options="">
      <Toolbar aria-label="Drawing options" innerStyle={{ gap: 2, paddingInline: 4 }}>
        <ToggleButton
          variant="ghost"
          padding="small"
          pressed={isPen}
          ariaLabel="Pen"
          tooltip="Pen"
          data-colab-draw-tool="pen"
          onClick={() => onChange({ tool: 'pen' })}
        >
          <PaintBrushIcon />
        </ToggleButton>
        <ToggleButton
          variant="ghost"
          padding="small"
          pressed={!isPen}
          ariaLabel="Eraser"
          tooltip="Eraser: erases whole strokes"
          data-colab-draw-tool="eraser"
          onClick={() => onChange({ tool: 'eraser' })}
        >
          <ClearIcon />
        </ToggleButton>
        <Separator />
        {DRAW_COLORS.map(({ value, label }) => (
          <ToggleButton
            key={value}
            variant="ghost"
            padding="small"
            pressed={isPen && settings.color === value}
            ariaLabel={`${label} pen`}
            tooltip={label}
            data-colab-draw-color={value}
            onClick={() => onChange({ tool: 'pen', color: value })}
          >
            <Swatch style={{ background: value }} />
          </ToggleButton>
        ))}
        <Separator />
        {DRAW_WIDTHS.map(({ value, label }) => (
          <ToggleButton
            key={value}
            variant="ghost"
            padding="small"
            pressed={isPen && settings.width === value}
            ariaLabel={`${label} line`}
            tooltip={`${label} line`}
            data-colab-draw-width={value}
            onClick={() => onChange({ tool: 'pen', width: value })}
          >
            <Slot>
              <WidthDot style={{ width: value + 2, height: value + 2 }} />
            </Slot>
          </ToggleButton>
        ))}
        <Separator />
        <Button
          variant="ghost"
          padding="small"
          ariaLabel="Clear drawing"
          tooltip={strokeCount > 0 ? 'Clear drawing' : 'Nothing drawn yet'}
          data-colab-draw-clear=""
          disabled={strokeCount === 0}
          onClick={() => {
            setShownCount(strokeCount);
            setConfirming(true);
          }}
        >
          <TrashIcon />
        </Button>
      </Toolbar>
      <Modal
        ariaLabel="Clear drawing"
        width={360}
        open={confirming}
        onOpenChange={setConfirming}
        container={container ?? undefined}
      >
        <Modal.Content data-colab-clear-dialog="">
          <Modal.Header>
            <Modal.Title>Clear the drawing?</Modal.Title>
            <Modal.Description>
              {shownCount === 1 ? 'The 1 stroke' : `All ${shownCount} strokes`} on this canvas will be removed for
              everyone. You can undo this (⌘Z or Ctrl+Z).
            </Modal.Description>
          </Modal.Header>
          <Modal.Actions>
            <DeleteButton
              ariaLabel={false}
              variant="solid"
              size="medium"
              data-colab-clear-confirm=""
              onClick={() => {
                setConfirming(false);
                onClear();
              }}
            >
              Clear drawing
            </DeleteButton>
            <Modal.Close asChild>
              <Button ref={cancelRef} ariaLabel={false} size="medium">
                Cancel
              </Button>
            </Modal.Close>
          </Modal.Actions>
        </Modal.Content>
      </Modal>
    </Floating>
  );
}
