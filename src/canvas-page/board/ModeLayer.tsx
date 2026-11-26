/**
 * The layer that gives a board mode (`src/board/modes.ts`) its presses. In `select` it is not
 * rendered, so stories get every press. In `comment` and `draw` it covers the whole board above the
 * frames and their chrome, so a left-button press:
 * - never reaches the story (no button action, no navigation, no hover inside it),
 * - never selects or raises a frame (the board's select-on-press reads `[data-colab-frame]`), and
 * - never pans (the pan listener only takes the empty canvas, the middle button and Space drags).
 * The middle button, Space-drag (the pan catcher sits above this layer) and the wheel still pan and
 * zoom. Pins, the toolbar and notices sit above this layer and stay clickable.
 *
 * Each mode passes its own handlers; they get the event plus the pointer in screen (board-relative)
 * and world coordinates.
 */
import React, { useRef } from 'react';

import { styled } from 'storybook/theming/emotion';

import { type BoardMode, modeCatchesPresses, pressBelongsToMode } from '../../board/modes';
import { type Point, type Viewport, screenToWorld } from '../../board/viewport';

export interface ModePointer {
  /** Board-relative CSS pixels. */
  screen: Point;
  /** Canvas world coordinates (zoom 1). */
  world: Point;
}

export type ModePointerHandler = (event: React.PointerEvent<HTMLDivElement>, pointer: ModePointer) => void;

export interface ModeHandlers {
  /** A left-button press (not while Space is held). */
  onPress?: ModePointerHandler;
  /** Every pointer move over the layer, pressed or not (hover). */
  onMove?: ModePointerHandler;
  onRelease?: ModePointerHandler;
  /** The pointer left the board, or the press was cancelled. */
  onLeave?: () => void;
  /** CSS cursor over the layer. */
  cursor?: string;
}

export interface ModeLayerProps {
  mode: BoardMode;
  handlers: ModeHandlers | undefined;
  view: Viewport;
  spaceHeld: boolean;
  /** Called on every press the mode takes (the board puts keyboard focus on itself). */
  onPress?: () => void;
}

/** Above the chrome layer (1), below the pan catcher, pins, notice and toolbar. */
export const MODE_LAYER_Z = 2;

const Layer = styled.div({
  position: 'absolute',
  inset: 0,
  zIndex: MODE_LAYER_Z,
  touchAction: 'none',
  userSelect: 'none',
  WebkitUserSelect: 'none',
  background: 'transparent',
});

export function ModeLayer({ mode, handlers, view, spaceHeld, onPress }: ModeLayerProps) {
  const ref = useRef<HTMLDivElement>(null);
  if (!modeCatchesPresses(mode)) return null;

  const pointer = (event: React.PointerEvent<HTMLDivElement>): ModePointer => {
    const rect = event.currentTarget.getBoundingClientRect();
    const screen = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    return { screen, world: screenToWorld(view, screen) };
  };

  return (
    <Layer
      ref={ref}
      data-colab-mode-layer={mode}
      style={{ cursor: handlers?.cursor ?? 'crosshair' }}
      onPointerDown={(event) => {
        if (!pressBelongsToMode(mode, event.button, spaceHeld)) return;
        // No focus change, text selection or emulated mouse events from the press.
        event.preventDefault();
        onPress?.();
        handlers?.onPress?.(event, pointer(event));
      }}
      onPointerMove={(event) => handlers?.onMove?.(event, pointer(event))}
      onPointerUp={(event) => handlers?.onRelease?.(event, pointer(event))}
      onPointerCancel={() => handlers?.onLeave?.()}
      onPointerLeave={() => handlers?.onLeave?.()}
      // Clicks never reach anything below (a story's link or button).
      onClick={(event) => event.preventDefault()}
      onContextMenu={(event) => event.preventDefault()}
    />
  );
}
