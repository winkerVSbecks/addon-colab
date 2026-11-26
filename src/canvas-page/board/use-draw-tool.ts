/**
 * Draw mode's tool: pen or whole-stroke eraser, with a colour and a width, as handlers for the
 * board's mode layer (`ModeLayer.tsx`, which keeps presses away from stories, selection and pan).
 *
 * The pen reads every coalesced pointer sample (smooth lines at any pointer rate), draws the stroke
 * locally on the stroke layer's live canvas once per animation frame, and writes it once on pointer
 * up, simplified (`src/board/strokes.ts`). A pen's pressure scales the saved width. The eraser
 * fades every stroke it passes over and erases them together on pointer up (one undo step).
 *
 * Only one pointer draws at a time; a second finger on a touch screen cancels the stroke.
 */
import type React from 'react';
import { type RefObject, useCallback, useMemo, useRef, useState } from 'react';

import { pressureWidth, simplifyStroke, strokesAlong, type StrokePoint } from '../../board/strokes';
import { type Point, type Viewport, screenToWorld } from '../../board/viewport';
import type { Stroke } from '../../canvas-file';
import type { ModeHandlers, ModePointerHandler } from './ModeLayer';
import type { StrokeLayerHandle } from './StrokeLayer';
import type { StrokesApi } from './use-strokes';

export type DrawTool = 'pen' | 'eraser';

export interface DrawSettings {
  tool: DrawTool;
  color: string;
  width: number;
}

/** How close (in screen pixels) the eraser must pass to a stroke's line. */
const ERASER_SCREEN_SLOP = 6;

const STORAGE_KEY = 'addon-colab:draw-settings';

function readSettings(fallback: DrawSettings, colors: readonly string[], widths: readonly number[]): DrawSettings {
  try {
    const value = JSON.parse(globalThis.localStorage?.getItem(STORAGE_KEY) ?? 'null') as Partial<DrawSettings> | null;
    return {
      tool: 'pen',
      color: value && colors.includes(value.color as string) ? (value.color as string) : fallback.color,
      width: value && widths.includes(value.width as number) ? (value.width as number) : fallback.width,
    };
  } catch {
    return fallback;
  }
}

/** A circle the eraser's size, as the cursor. */
const ERASER_CURSOR = `url("data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><circle cx="8" cy="8" r="6.5" fill="white" fill-opacity="0.6" stroke="black" stroke-width="1"/></svg>',
)}") 8 8, cell`;

export interface DrawToolOptions {
  strokes: StrokesApi;
  layer: RefObject<StrokeLayerHandle | null>;
  view: Viewport;
  colors: readonly string[];
  widths: readonly number[];
  defaults: DrawSettings;
}

export interface DrawToolApi {
  settings: DrawSettings;
  setSettings: (changes: Partial<DrawSettings>) => void;
  handlers: ModeHandlers;
  /** Strokes the eraser has passed over in the current gesture. */
  fadedIds: ReadonlySet<string>;
}

interface Gesture {
  pointerId: number;
  pointerType: string;
  /** The board's top-left on screen when the press started. */
  origin: Point;
  points: StrokePoint[];
  pressures: number[];
  last: Point;
  erasing: Map<string, Stroke>;
}

export function useDrawTool({ strokes, layer, view, colors, widths, defaults }: DrawToolOptions): DrawToolApi {
  const [settings, setState] = useState(() => readSettings(defaults, colors, widths));
  const [fadedIds, setFadedIds] = useState<ReadonlySet<string>>(new Set());
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const viewRef = useRef(view);
  viewRef.current = view;
  const strokesRef = useRef(strokes);
  strokesRef.current = strokes;
  const gesture = useRef<Gesture | null>(null);

  const setSettings = useCallback((changes: Partial<DrawSettings>) => {
    setState((current) => {
      const next = { ...current, ...changes };
      try {
        globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify({ color: next.color, width: next.width }));
      } catch {
        // Not remembered.
      }
      return next;
    });
  }, []);

  const showLive = useCallback(() => {
    const current = gesture.current;
    if (!current || settingsRef.current.tool !== 'pen') return;
    const { color, width } = settingsRef.current;
    layer.current?.setLive({ color, width, points: current.points });
  }, [layer]);

  const cancel = useCallback(() => {
    gesture.current = null;
    layer.current?.setLive(null);
    setFadedIds((current) => (current.size === 0 ? current : new Set()));
  }, [layer]);

  const eraseAlong = useCallback((current: Gesture, to: Point) => {
    const slop = ERASER_SCREEN_SLOP / viewRef.current.zoom;
    const hit = strokesAlong(strokesRef.current.strokes, current.last, to, slop);
    current.last = to;
    const fresh = hit.filter((stroke) => !current.erasing.has(stroke.id));
    if (fresh.length === 0) return;
    for (const stroke of fresh) current.erasing.set(stroke.id, stroke);
    setFadedIds(new Set(current.erasing.keys()));
  }, []);

  const onPress: ModePointerHandler = useCallback(
    (event, pointer) => {
      if (gesture.current) {
        // A second finger: that is a gesture, not a drawing.
        if (event.pointerType === 'touch' && gesture.current.pointerType === 'touch') cancel();
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      const rect = event.currentTarget.getBoundingClientRect();
      const current: Gesture = {
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        origin: { x: rect.left, y: rect.top },
        points: [[pointer.world.x, pointer.world.y]],
        pressures: event.pointerType === 'pen' ? [event.pressure] : [],
        last: pointer.world,
        erasing: new Map(),
      };
      gesture.current = current;
      if (settingsRef.current.tool === 'eraser') eraseAlong(current, pointer.world);
      else showLive();
    },
    [cancel, eraseAlong, showLive],
  );

  const onMove: ModePointerHandler = useCallback(
    (event) => {
      const current = gesture.current;
      if (!current || event.pointerId !== current.pointerId) return;
      const native = event.nativeEvent;
      const samples = native.getCoalescedEvents?.() ?? [];
      for (const sample of samples.length > 0 ? samples : [native]) {
        const world = screenToWorld(viewRef.current, {
          x: sample.clientX - current.origin.x,
          y: sample.clientY - current.origin.y,
        });
        if (settingsRef.current.tool === 'eraser') {
          eraseAlong(current, world);
          continue;
        }
        current.points.push([world.x, world.y]);
        if (current.pointerType === 'pen') current.pressures.push(sample.pressure);
      }
      showLive();
    },
    [eraseAlong, showLive],
  );

  const onRelease: ModePointerHandler = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const current = gesture.current;
      if (!current || event.pointerId !== current.pointerId) return;
      gesture.current = null;
      const { tool, color, width } = settingsRef.current;
      if (tool === 'eraser') {
        strokesRef.current.erase([...current.erasing.values()]);
        setFadedIds(new Set());
        return;
      }
      const points = simplifyStroke(current.points, viewRef.current.zoom);
      if (points.length > 0) strokesRef.current.draw({ color, width: pressureWidth(width, current.pressures), points });
      layer.current?.setLive(null);
    },
    [layer],
  );

  const handlers = useMemo<ModeHandlers>(
    () => ({
      onPress,
      onMove,
      onRelease,
      onLeave: () => {
        // Pointer capture keeps the gesture through leaving the board; this is a cancel.
        if (gesture.current) cancel();
      },
      cursor: settings.tool === 'eraser' ? ERASER_CURSOR : 'crosshair',
    }),
    [onPress, onMove, onRelease, cancel, settings.tool],
  );

  return { settings, setSettings, handlers, fadedIds };
}
