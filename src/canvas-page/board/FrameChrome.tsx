/**
 * The controls drawn around a frame, in screen space above the canvas (so they keep a readable size
 * at any zoom, like frame names in design tools):
 * - the story's name above the frame: press and drag it to move the frame, click to select it;
 *   with the keyboard, Tab to it, arrows nudge (Shift for 10px), Delete removes;
 * - when selected, an outline, resize handles on the right edge, bottom edge and corner, and buttons
 *   to open the story in Storybook and to remove it from the canvas.
 *
 * The story itself is not covered: it is drawn by the canvas and stays interactive.
 */
import React, { useRef } from 'react';

import { Button } from 'storybook/internal/components';
import { CloseIcon, ShareAltIcon } from '@storybook/icons';
import { styled } from 'storybook/theming/emotion';

import type { Rect } from '../../board/viewport';

export type ResizeEdge = 'e' | 's' | 'se';

/** A pointer gesture on the chrome, in screen pixels relative to where it started. */
export interface GestureHandlers {
  onStart: () => void;
  onMove: (dx: number, dy: number) => void;
  onEnd: (moved: boolean) => void;
}

export interface FrameChromeProps {
  frameId: string;
  /** The frame's rectangle on screen (CSS pixels relative to the board). */
  rect: Rect;
  title: string;
  /** Full story title for the tooltip, e.g. "Example/Button › Primary". */
  fullTitle: string;
  selected: boolean;
  onSelect: () => void;
  move: GestureHandlers;
  resize: (edge: ResizeEdge) => GestureHandlers;
  onNudge: (dx: number, dy: number) => void;
  onRemove: () => void;
  onOpen: () => void;
}

const TITLE_HEIGHT = 24;
/** A press that moves less than this is a click, not a drag. */
const DRAG_THRESHOLD = 3;

const Box = styled.div({
  position: 'absolute',
  pointerEvents: 'none',
  // The selected frame's controls stay above the others. (Not re-ordered in the DOM: moving the
  // element would drop the pointer capture of a drag that has just started.)
  '&[data-selected]': { zIndex: 1 },
});

const Outline = styled.div(({ theme }) => ({
  position: 'absolute',
  inset: -1,
  border: `2px solid ${theme.color.secondary}`,
  borderRadius: 1,
  pointerEvents: 'none',
}));

const TitleBar = styled.div({
  position: 'absolute',
  left: 0,
  right: 0,
  bottom: '100%',
  height: TITLE_HEIGHT,
  display: 'flex',
  alignItems: 'center',
  gap: 2,
  minWidth: 0,
});

const Title = styled.button(({ theme }) => ({
  all: 'unset',
  pointerEvents: 'auto',
  boxSizing: 'border-box',
  flex: '0 1 auto',
  minWidth: 0,
  height: 20,
  padding: '0 4px',
  borderRadius: theme.appBorderRadius,
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  whiteSpace: 'nowrap',
  fontFamily: theme.typography.fonts.base,
  fontSize: theme.typography.size.s1,
  lineHeight: '20px',
  color: theme.textMutedColor,
  cursor: 'grab',
  userSelect: 'none',
  '&:hover': { color: theme.color.defaultText },
  '&:focus-visible': { outline: `2px solid ${theme.color.secondary}`, outlineOffset: -2 },
  '&[aria-pressed="true"]': { color: theme.color.secondary, fontWeight: theme.typography.weight.bold },
  '[data-moving] &': { cursor: 'grabbing' },
}));

const Actions = styled.div({
  marginLeft: 'auto',
  display: 'flex',
  gap: 2,
  pointerEvents: 'auto',
  flex: 'none',
});

const Handle = styled.div(({ theme }) => ({
  position: 'absolute',
  pointerEvents: 'auto',
  touchAction: 'none',
  '&[data-edge="e"]': { top: 0, bottom: 8, right: -5, width: 10, cursor: 'ew-resize' },
  '&[data-edge="s"]': { left: 0, right: 8, bottom: -5, height: 10, cursor: 'ns-resize' },
  '&[data-edge="se"]': {
    right: -6,
    bottom: -6,
    width: 12,
    height: 12,
    cursor: 'nwse-resize',
    '&::after': {
      content: '""',
      position: 'absolute',
      inset: 2,
      borderRadius: 2,
      background: theme.background.content,
      border: `2px solid ${theme.color.secondary}`,
      boxSizing: 'border-box',
    },
  },
}));

/** Pointer capture on the pressed element, so the gesture continues outside it. */
function useGesture(handlers: () => GestureHandlers | undefined, onPress?: () => void) {
  const state = useRef<{ id: number; x: number; y: number; moved: boolean; handlers: GestureHandlers } | null>(null);
  return {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (event.button !== 0) return;
      const current = handlers();
      if (!current) return;
      event.preventDefault();
      event.stopPropagation();
      // preventDefault keeps the press from focusing anything; keyboard shortcuts need the focus here.
      const element = event.currentTarget as HTMLElement;
      // A pointer press shows no focus ring (`focusVisible: false`); Tab still does.
      if (element.tabIndex >= 0) element.focus({ preventScroll: true, focusVisible: false } as FocusOptions);
      else (element.closest('[data-colab-board]') as HTMLElement | null)?.focus({ preventScroll: true });
      onPress?.();
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
      state.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false, handlers: current };
    },
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
      const gesture = state.current;
      if (!gesture || event.pointerId !== gesture.id) return;
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      if (!gesture.moved) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        gesture.moved = true;
        gesture.handlers.onStart();
      }
      gesture.handlers.onMove(dx, dy);
    },
    onPointerUp: (event: React.PointerEvent<HTMLElement>) => {
      const gesture = state.current;
      if (!gesture || event.pointerId !== gesture.id) return;
      state.current = null;
      gesture.handlers.onEnd(gesture.moved);
    },
    onPointerCancel: (event: React.PointerEvent<HTMLElement>) => {
      const gesture = state.current;
      if (!gesture || event.pointerId !== gesture.id) return;
      state.current = null;
      gesture.handlers.onEnd(gesture.moved);
    },
  };
}

function ResizeHandle({
  edge,
  handlers,
  onPress,
}: {
  edge: ResizeEdge;
  handlers: GestureHandlers;
  onPress: () => void;
}) {
  const gesture = useGesture(() => handlers, onPress);
  return <Handle data-edge={edge} data-colab-resize={edge} aria-hidden {...gesture} />;
}

export function FrameChrome({
  frameId,
  rect,
  title,
  fullTitle,
  selected,
  onSelect,
  move,
  resize,
  onNudge,
  onRemove,
  onOpen,
}: FrameChromeProps) {
  const titleGesture = useGesture(() => move, onSelect);

  const onKeyDown = (event: React.KeyboardEvent) => {
    const step = event.shiftKey ? 10 : 1;
    const nudges: Record<string, [number, number]> = {
      ArrowLeft: [-step, 0],
      ArrowRight: [step, 0],
      ArrowUp: [0, -step],
      ArrowDown: [0, step],
    };
    const nudge = nudges[event.key];
    if (nudge) {
      event.preventDefault();
      onSelect();
      onNudge(nudge[0], nudge[1]);
    } else if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      onRemove();
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onSelect();
    }
  };

  return (
    <Box
      data-colab-chrome={frameId}
      data-selected={selected ? '' : undefined}
      style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
    >
      {selected && <Outline />}
      <TitleBar>
        <Title
          type="button"
          title={`${fullTitle}. Drag to move; arrow keys nudge; Delete removes.`}
          aria-label={`${fullTitle}: frame on the canvas`}
          aria-pressed={selected}
          data-colab-frame-title={frameId}
          onKeyDown={onKeyDown}
          {...titleGesture}
        >
          {title}
        </Title>
        {selected && (
          <Actions>
            <Button variant="ghost" padding="small" size="small" ariaLabel="Open story" onClick={onOpen}>
              <ShareAltIcon />
            </Button>
            <Button variant="ghost" padding="small" size="small" ariaLabel="Remove from canvas" onClick={onRemove}>
              <CloseIcon />
            </Button>
          </Actions>
        )}
      </TitleBar>
      {selected && (
        <>
          <ResizeHandle edge="e" handlers={resize('e')} onPress={onSelect} />
          <ResizeHandle edge="s" handlers={resize('s')} onPress={onSelect} />
          <ResizeHandle edge="se" handlers={resize('se')} onPress={onSelect} />
        </>
      )}
    </Box>
  );
}
