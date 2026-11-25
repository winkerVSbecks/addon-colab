/**
 * The canvas board: every frame of the canvas file rendered live on an HTML-in-Canvas surface, with
 * pan and zoom.
 *
 * Mounted by the canvas page once the file has loaded (`canvas` updates live from every source
 * without remounting this component; `channel` is the preview channel for `requestCanvas`).
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { SELECT_STORY, STORY_UNCHANGED } from 'storybook/internal/core-events';
import { styled, useTheme } from 'storybook/theming/emotion';

import { boardKeyAction, focusPlace } from '../board/keyboard';
import { MIN_FRAME_HEIGHT, MIN_FRAME_WIDTH, clampFrameSize, frameRect } from '../board/frame-defaults';
import { type StoryTitle, storyTitle, storyTitleFromId } from '../board/story-title';
import { boundsOf, worldRectToScreen } from '../board/viewport';
import type { CanvasFile } from '../canvas-file';
import { type ChannelLike, requestCanvas } from '../channel';
import { BoardNotice, type BoardNoticeContent } from './board/BoardNotice';
import { BoardToolbar } from './board/BoardToolbar';
import { FrameBody } from './board/FrameBody';
import { FrameChrome, type GestureHandlers, type ResizeEdge } from './board/FrameChrome';
import { drawableCanvasProps } from './board/html-in-canvas';
import { type StoryStatus, getPreview } from './board/story-mount';
import { useBoardView } from './board/use-board-view';
import { type PaintScene, useDrawableCanvas } from './board/use-drawable-canvas';
import { useFrameEdits } from './board/use-frame-edits';
import { usePanZoom } from './board/use-pan-zoom';
import { useStoryDrop } from './board/use-story-drop';

export interface CanvasBoardProps {
  canvas: CanvasFile;
  channel: ChannelLike;
}

const Root = styled.div(({ theme }) => ({
  position: 'absolute',
  inset: 0,
  overflow: 'hidden',
  background: theme.background.app,
  touchAction: 'none',
  outline: 'none',
  '&[data-panning]': { cursor: 'grabbing' },
  // A story from the sidebar is over the board.
  '&[data-drop-target]::after': {
    content: '""',
    position: 'absolute',
    inset: 0,
    zIndex: 4,
    pointerEvents: 'none',
    boxShadow: `inset 0 0 0 2px ${theme.color.secondary}`,
  },
}));

const Surface = styled.canvas({
  position: 'absolute',
  inset: 0,
  width: '100%',
  height: '100%',
  display: 'block',
});

/** Frame titles, outlines and handles, above the canvas; only the controls themselves catch the pointer. */
const ChromeLayer = styled.div({
  position: 'absolute',
  inset: 0,
  zIndex: 1,
  pointerEvents: 'none',
  overflow: 'hidden',
});

/** Covers the board while Space is held, so the drag pans and the stories get no hover. */
const PanCatcher = styled.div({
  position: 'absolute',
  inset: 0,
  zIndex: 2,
  cursor: 'grab',
  '[data-panning] > &': { cursor: 'grabbing' },
});

function titleOf(status: StoryStatus): StoryTitle | undefined {
  const story = status.kind === 'ready' ? status.story : status.kind === 'error' ? status.story : undefined;
  return story && storyTitle(story);
}

export function CanvasBoard({ canvas, channel }: CanvasBoardProps) {
  const theme = useTheme();
  const preview = useMemo(() => getPreview(), []);
  const rootRef = useRef<HTMLDivElement>(null);
  const elementsRef = useRef(new Map<string, HTMLElement>());
  const [heights, setHeights] = useState<ReadonlyMap<string, number>>(new Map());
  const [titles, setTitles] = useState<ReadonlyMap<string, StoryTitle>>(new Map());
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const [notice, setNotice] = useState<BoardNoticeContent | null>(null);
  const dismissNotice = useCallback(() => setNotice(null), []);
  const showError = useCallback((message: string) => setNotice({ message, tone: 'error' }), []);

  const edits = useFrameEdits(canvas, channel, showError);
  const frames = edits.frames;
  const scene = useRef<PaintScene>(null as unknown as PaintScene);
  const { canvasRef, size, paint } = useDrawableCanvas(rootRef, scene);

  const bounds = useMemo(
    () => boundsOf(frames.map((frame) => frameRect(frame, heights.get(frame.id)))),
    [frames, heights],
  );
  const measured = frames.every((frame) => heights.has(frame.id));
  const board = useBoardView(canvas.id, size, bounds, measured);
  const deselect = useCallback(() => setSelectedId(null), []);
  const { spaceHeld, panning } = usePanZoom({ root: rootRef, surface: canvasRef, board, onBackgroundPress: deselect });

  const addFrame = useCallback(
    async (frame: { storyId: string; x: number; y: number; width: number }) => {
      try {
        const result = await requestCanvas(channel, 'addFrame', { canvasId: canvas.id, frame });
        setSelectedId(result.frame.id);
        return result.frame.id;
      } catch (error) {
        showError(`Couldn't add the story: ${error instanceof Error ? error.message : String(error)}`);
        return undefined;
      }
    },
    [channel, canvas.id, showError],
  );
  const dropping = useStoryDrop({ root: rootRef, view: board.view, preview, addFrame, onError: showError });

  scene.current = {
    view: board.view,
    frames,
    elements: elementsRef.current,
    colors: { dot: theme.appBorderColor, frameBorder: theme.appBorderColor },
  };
  useLayoutEffect(() => paint());

  // A story file was hot-reloaded: Storybook re-renders the canvas entry as "unchanged", so each
  // frame reloads its story and re-renders it if its implementation changed.
  useEffect(() => {
    const onUnchanged = () => setRefreshKey((key) => key + 1);
    channel.on(STORY_UNCHANGED, onUnchanged);
    return () => channel.off(STORY_UNCHANGED, onUnchanged);
  }, [channel]);

  // The selected frame was removed (here or elsewhere).
  useEffect(() => {
    if (selectedId && !frames.some((frame) => frame.id === selectedId)) setSelectedId(null);
  }, [frames, selectedId]);

  const framesRef = useRef(frames);
  framesRef.current = frames;
  const titlesRef = useRef(titles);
  titlesRef.current = titles;

  // Removing a frame: it goes at once, focus moves to the board (its title is gone), and a notice
  // offers Undo, which puts it back with the same id, position, size and place in the stacking order.
  const fileRef = useRef(canvas);
  fileRef.current = canvas;
  const undoRef = useRef<(() => void) | null>(null);
  const editsRemove = edits.remove;
  const editsRestore = edits.restore;
  const remove = useCallback(
    (frameId: string) => {
      const frame = framesRef.current.find((f) => f.id === frameId);
      if (!frame) return;
      const index = fileRef.current.frames.findIndex((f) => f.id === frameId);
      const name = titlesRef.current.get(frameId)?.short ?? storyTitleFromId(frame.storyId).short;
      const removed = editsRemove(frameId);
      rootRef.current?.focus({ preventScroll: true });
      const undo = () => {
        if (undoRef.current !== undo) return;
        undoRef.current = null;
        setNotice(null);
        // The removal must have landed before the frame can go back under the same id.
        void removed
          .then(() => editsRestore(frame, index < 0 ? fileRef.current.frames.length : index))
          .then((restored) => {
            if (!restored) return;
            setSelectedId(frame.id);
            rootRef.current?.focus({ preventScroll: true });
          });
      };
      undoRef.current = undo;
      setNotice({ message: `Removed ${name}`, tone: 'info', action: { label: 'Undo', run: undo } });
    },
    [editsRemove, editsRestore],
  );
  // Undo is on offer only while its notice is showing.
  useEffect(() => {
    if (!notice?.action) undoRef.current = null;
  }, [notice]);

  // Escape deselects when focus is on the board, and ⌘Z undoes a removal while its notice shows.
  // Delete/Backspace are handled only by a frame's title (FrameChrome): a press inside a story
  // leaves focus on the board root or in the story, and must never remove the frame
  // (src/board/keyboard.ts).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const place = focusPlace(document.activeElement);
      const action = boardKeyAction(event, place, {
        hasSelection: selectedId !== null,
        canUndo: undoRef.current !== null,
      });
      if (action === 'deselect') setSelectedId(null);
      else if (action === 'undo') {
        event.preventDefault();
        undoRef.current?.();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedId]);

  const onElement = useCallback((frameId: string, element: HTMLDivElement | null) => {
    if (element) elementsRef.current.set(frameId, element);
    else elementsRef.current.delete(frameId);
  }, []);
  const editsMeasured = edits.measured;
  const onMeasure = useCallback(
    (frameId: string, height: number) => {
      setHeights((current) => (current.get(frameId) === height ? current : new Map(current).set(frameId, height)));
      editsMeasured(frameId, height);
    },
    [editsMeasured],
  );
  const onStatus = useCallback((frameId: string, status: StoryStatus) => {
    setTitles((current) => {
      const title = titleOf(status);
      if (!title || current.get(frameId)?.full === title.full) return current;
      return new Map(current).set(frameId, title);
    });
  }, []);

  // Gestures read the frame as it was when they started; the view cannot change mid-gesture.
  const viewRef = useRef(board.view);
  viewRef.current = board.view;
  const heightsRef = useRef(heights);
  heightsRef.current = heights;

  const moveHandlers = useCallback(
    (frameId: string): GestureHandlers => {
      let origin: { x: number; y: number } | undefined;
      return {
        onStart: () => {
          const frame = framesRef.current.find((f) => f.id === frameId);
          origin = frame && { x: frame.x, y: frame.y };
          edits.setBusy(frameId, true);
          setMoving(true);
        },
        onMove: (dx, dy) => {
          if (!origin) return;
          const zoom = viewRef.current.zoom;
          edits.preview(frameId, { x: Math.round(origin.x + dx / zoom), y: Math.round(origin.y + dy / zoom) });
        },
        onEnd: (moved) => {
          setMoving(false);
          edits.setBusy(frameId, false);
          if (moved && origin) edits.commit(frameId);
        },
      };
    },
    [edits],
  );

  const resizeHandlers = useCallback(
    (frameId: string, edge: ResizeEdge): GestureHandlers => {
      let origin: { width: number; height: number } | undefined;
      return {
        onStart: () => {
          const frame = framesRef.current.find((f) => f.id === frameId);
          if (!frame) return;
          const height = heightsRef.current.get(frameId) ?? frame.height ?? MIN_FRAME_HEIGHT;
          origin = { width: frame.width, height };
          edits.setBusy(frameId, true);
        },
        onMove: (dx, dy) => {
          if (!origin) return;
          const zoom = viewRef.current.zoom;
          const changes: { width?: number; height?: number } = {};
          if (edge !== 's') changes.width = clampFrameSize(origin.width + dx / zoom, MIN_FRAME_WIDTH);
          if (edge !== 'e') changes.height = clampFrameSize(origin.height + dy / zoom, MIN_FRAME_HEIGHT);
          edits.preview(frameId, changes);
        },
        onEnd: (moved) => {
          edits.setBusy(frameId, false);
          if (moved && origin) edits.commit(frameId);
        },
      };
    },
    [edits],
  );

  const nudge = useCallback(
    (frameId: string, dx: number, dy: number) => {
      const frame = framesRef.current.find((f) => f.id === frameId);
      if (!frame) return;
      edits.preview(frameId, { x: frame.x + dx, y: frame.y + dy });
      edits.commit(frameId);
    },
    [edits],
  );

  const openStory = useCallback((storyId: string) => channel.emit(SELECT_STORY, { storyId }), [channel]);

  // Pressing inside a story selects its frame (without stopping the press: the story still gets it).
  const onPointerDownCapture = (event: React.PointerEvent) => {
    const frameId = (event.target as Element).closest?.('[data-colab-frame]')?.getAttribute('data-colab-frame');
    if (frameId) setSelectedId(frameId);
  };

  return (
    <Root
      ref={rootRef}
      data-colab-board={canvas.id}
      tabIndex={-1}
      data-panning={panning ? '' : undefined}
      data-moving={moving ? '' : undefined}
      data-drop-target={dropping ? '' : undefined}
      // Read by the browser checks in scripts/: the viewport and the frames as shown.
      data-colab-board-state={JSON.stringify({ view: board.view, frames, selectedId })}
      style={{ visibility: board.ready ? 'visible' : 'hidden' }}
      onPointerDownCapture={onPointerDownCapture}
    >
      <Surface ref={canvasRef} {...drawableCanvasProps} aria-label={`Canvas ${canvas.name}`}>
        {preview &&
          frames.map((frame) => (
            <FrameBody
              key={frame.id}
              frameId={frame.id}
              storyId={frame.storyId}
              width={frame.width}
              height={frame.height}
              preview={preview}
              onElement={onElement}
              onMeasure={onMeasure}
              onStatus={onStatus}
              onRemove={remove}
              refreshKey={refreshKey}
            />
          ))}
      </Surface>
      <ChromeLayer>
        {frames.map((frame) => {
          const title = titles.get(frame.id) ?? storyTitleFromId(frame.storyId);
          return (
            <FrameChrome
              key={frame.id}
              frameId={frame.id}
              rect={worldRectToScreen(board.view, {
                x: frame.x,
                y: frame.y,
                width: frame.width,
                height: heights.get(frame.id) ?? frame.height ?? MIN_FRAME_HEIGHT,
              })}
              title={title.short}
              fullTitle={title.full}
              selected={frame.id === selectedId}
              onSelect={() => setSelectedId(frame.id)}
              move={moveHandlers(frame.id)}
              resize={(edge) => resizeHandlers(frame.id, edge)}
              onNudge={(dx, dy) => nudge(frame.id, dx, dy)}
              onRemove={() => remove(frame.id)}
              onOpen={() => openStory(frame.storyId)}
            />
          );
        })}
      </ChromeLayer>
      {spaceHeld && <PanCatcher data-colab-pan-catcher="" />}
      <BoardNotice notice={notice} onDismiss={dismissNotice} />
      <BoardToolbar
        zoom={board.view.zoom}
        onZoomIn={() => board.zoomStep(1)}
        onZoomOut={() => board.zoomStep(-1)}
        onResetZoom={() => board.zoomTo(1)}
        onFit={board.fit}
        canFit={frames.length > 0}
      />
    </Root>
  );
}
