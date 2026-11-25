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

import { inStableOrder, isOnTop, raiseSettled, withRaised } from '../board/frame-order';
import { boardKeyAction, focusPlace } from '../board/keyboard';
import { BOARD_MODES, type BoardMode } from '../board/modes';
import type { UndoEntry } from '../board/undo-stack';
import { MIN_FRAME_HEIGHT, MIN_FRAME_WIDTH, clampFrameSize, frameRect } from '../board/frame-defaults';
import { type StoryTitle, storyTitle, storyTitleFromId } from '../board/story-title';
import { boundsOf, worldRectToScreen } from '../board/viewport';
import type { CanvasFile } from '../canvas-file';
import { CanvasRequestError, type ChannelLike, requestCanvas } from '../channel';
import { BoardNotice, type BoardNoticeContent } from './board/BoardNotice';
import { BoardToolbar } from './board/BoardToolbar';
import { CommentLayer } from './board/CommentLayer';
import { FrameBody } from './board/FrameBody';
import { FrameChrome, type GestureHandlers, type ResizeEdge } from './board/FrameChrome';
import { type ModeHandlers, ModeLayer } from './board/ModeLayer';
import { drawableCanvasProps } from './board/html-in-canvas';
import { type StoryStatus, getPreview } from './board/story-mount';
import { useBoardView } from './board/use-board-view';
import { type PaintScene, useDrawableCanvas } from './board/use-drawable-canvas';
import { useFrameEdits } from './board/use-frame-edits';
import { usePanZoom } from './board/use-pan-zoom';
import { useStoryDrop } from './board/use-story-drop';
import { useUndoStack } from './board/use-undo-stack';
import { useComments } from './board/use-comments';
// Drawing (task 8): strokes over the frames, and draw mode's tool.
import { DEFAULT_DRAW_SETTINGS, DRAW_COLORS, DRAW_WIDTHS, DrawOptions } from './board/DrawOptions';
import { StrokeLayer, type StrokeLayerHandle } from './board/StrokeLayer';
import { useDrawTool } from './board/use-draw-tool';
import { useStrokes } from './board/use-strokes';

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
  // Story CSS shares this document: a `canvas { … }` rule must not move the stories off the strokes.
  maxWidth: 'none',
  maxHeight: 'none',
  margin: 0,
  padding: 0,
  border: 0,
  opacity: 1,
  transform: 'none',
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
  // A notice may offer Undo for one undo-stack entry; a later notice replaces the message but the
  // entry stays on the stack (⌘Z still undoes it).
  const [notice, setNotice] = useState<(BoardNoticeContent & { entry?: UndoEntry }) | null>(null);
  const dismissNotice = useCallback(() => setNotice(null), []);
  const showError = useCallback((message: string) => setNotice({ message, tone: 'error' }), []);
  const undo = useUndoStack(canvas.id);
  const undoStack = undo.stack;
  /** Shows a notice whose Undo button undoes `entry` (for as long as the entry is on the stack). */
  const showUndoable = useCallback(
    (message: string, entry: UndoEntry) => setNotice({ message, tone: 'info', entry }),
    [],
  );

  // Board modes (src/board/modes.ts). Each mode other than select plugs its press handlers in here;
  // the switcher offers only modes that have handlers.
  const [mode, setMode] = useState<BoardMode>('select');
  const modeHandlers: Partial<Record<BoardMode, ModeHandlers>> = {};

  const edits = useFrameEdits(canvas, channel, showError);
  // Selecting a frame brings it to the front: shown at once, and kept until the file agrees.
  const [raisedId, setRaisedId] = useState<string | null>(null);
  const frames = useMemo(() => withRaised(edits.frames, raisedId), [edits.frames, raisedId]);
  // The DOM keeps one order whatever the stacking: the canvas draws (and hit-tests) in `frames` order.
  const domFrames = useMemo(() => inStableOrder(frames), [frames]);
  useEffect(() => {
    if (raisedId && raiseSettled(canvas.frames, raisedId)) setRaisedId(null);
  }, [canvas.frames, raisedId]);
  const scene = useRef<PaintScene>(null as unknown as PaintScene);
  const { canvasRef, size, paint } = useDrawableCanvas(rootRef, scene);

  const bounds = useMemo(
    () => boundsOf(frames.map((frame) => frameRect(frame, heights.get(frame.id)))),
    [frames, heights],
  );
  const measured = frames.every((frame) => heights.has(frame.id));
  const board = useBoardView(canvas.id, size, bounds, measured);

  // Drawing: strokes in world coordinates, drawn above every frame; draw mode's pen and eraser.
  const strokes = useStrokes(canvas, channel, undoStack, showError);
  const strokeLayerRef = useRef<StrokeLayerHandle>(null);
  const drawTool = useDrawTool({
    strokes,
    layer: strokeLayerRef,
    view: board.view,
    colors: DRAW_COLORS.map((option) => option.value),
    widths: DRAW_WIDTHS.map((option) => option.value),
    defaults: DEFAULT_DRAW_SETTINGS,
  });
  modeHandlers.draw = drawTool.handlers;
  const strokesClear = strokes.clear;
  const clearDrawing = useCallback(() => {
    void strokesClear().then((entry) => entry && showUndoable(`${entry.label.replace('Clear', 'Cleared')}`, entry));
    rootRef.current?.focus({ preventScroll: true });
  }, [strokesClear, showUndoable]);
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

  // Comments (task 7): pins, threads and the list; comment mode's hover and press.
  const storyName = useCallback(
    (storyId: string) => {
      const frame = frames.find((f) => f.storyId === storyId);
      return (frame && titles.get(frame.id)?.short) ?? storyTitleFromId(storyId).short;
    },
    [frames, titles],
  );
  const setView = board.setView;
  const centerOn = useCallback(
    (point: { x: number; y: number }) =>
      setView((view) => ({
        ...view,
        x: size.width / 2 - point.x * view.zoom,
        y: size.height / 2 - point.y * view.zoom,
      })),
    [setView, size],
  );
  const comments = useComments({
    canvas,
    frames,
    view: board.view,
    root: rootRef,
    preview,
    channel,
    undoStack,
    showUndoable,
    showError,
    storyName,
    centerOn,
    active: mode === 'comment',
  });
  modeHandlers.comment = comments.handlers;

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
  const fileRef = useRef(canvas);
  fileRef.current = canvas;
  const titlesRef = useRef(titles);
  titlesRef.current = titles;

  const select = useCallback(
    (frameId: string) => {
      setSelectedId(frameId);
      if (isOnTop(framesRef.current, frameId) || !framesRef.current.some((f) => f.id === frameId)) return;
      setRaisedId(frameId);
      requestCanvas(channel, 'raiseFrame', { canvasId: fileRef.current.id, frameId }).catch((error: unknown) => {
        setRaisedId((current) => (current === frameId ? null : current));
        if (error instanceof CanvasRequestError && error.code === 'NOT_FOUND') return;
        showError(`Couldn't bring the story to the front: ${error instanceof Error ? error.message : String(error)}`);
      });
    },
    [channel, showError],
  );

  // Removing a frame: it goes at once, focus moves to the board (its title is gone), and an undo
  // entry puts it back with the same id, position, size and place in the stacking order.
  const editsRemove = edits.remove;
  const editsRestore = edits.restore;
  const remove = useCallback(
    (frameId: string) => {
      const frame = framesRef.current.find((f) => f.id === frameId);
      if (!frame) return;
      // Its place in the order as shown (a frame selected by its title has just come to the front).
      const index = framesRef.current.findIndex((f) => f.id === frameId);
      const name = titlesRef.current.get(frameId)?.short ?? storyTitleFromId(frame.storyId).short;
      let removed = editsRemove(frameId);
      rootRef.current?.focus({ preventScroll: true });
      const entry = undoStack.push({
        label: `Remove ${name}`,
        // The removal must have landed before the frame can go back under the same id.
        undo: async () => {
          await removed;
          const restored = await editsRestore(frame, index < 0 ? fileRef.current.frames.length : index);
          if (restored) {
            setSelectedId(frame.id);
            rootRef.current?.focus({ preventScroll: true });
          }
          return restored;
        },
        redo: () => {
          removed = editsRemove(frameId);
          return removed;
        },
      });
      showUndoable(`Removed ${name}`, entry);
    },
    [editsRemove, editsRestore, undoStack, showUndoable],
  );

  const undoLatest = useCallback(
    (direction: 'undo' | 'redo') => {
      // Nothing on the stack yet may still mean an undo/redo is running: the stack queues this one.
      if (!(direction === 'undo' ? undoStack.canUndo : undoStack.canRedo)) return;
      void (direction === 'undo' ? undoStack.undo() : undoStack.redo()).then((done) => {
        if (done) setNotice({ message: `${direction === 'undo' ? 'Undid' : 'Redid'}: ${done.label}`, tone: 'info' });
      });
    },
    [undoStack],
  );

  // The notice as shown: Undo only while its entry can still be undone. Memoised so the notice's
  // timer is not restarted by unrelated re-renders.
  const shownNotice = useMemo<BoardNoticeContent | null>(() => {
    if (!notice) return null;
    const { entry, ...content } = notice;
    if (!entry || !undoStack.has(entry)) return content;
    const run = () => void undoStack.undoEntry(entry).then(() => setNotice(null));
    return { ...content, action: { label: 'Undo', run } };
    // `undo.version` tracks `undoStack.has`.
  }, [notice, undoStack, undo.version]);

  const changeMode = useCallback((next: BoardMode) => {
    setMode(next);
    if (next !== 'select') setSelectedId(null);
  }, []);

  // The board's only key handler (rules in src/board/keyboard.ts): Escape leaves a mode or
  // deselects, ⌘Z / ⇧⌘Z undo and redo, V/C/D switch mode. Delete/Backspace are handled only by a
  // frame's title (FrameChrome): a press inside a story leaves focus on the board root or in the
  // story, and must never remove the frame.
  const keyState = {
    hasSelection: selectedId !== null,
    canUndo: undo.canUndo,
    canRedo: undo.canRedo,
    mode,
    modes: BOARD_MODES.filter((option) => option === 'select' || modeHandlers[option]),
  };
  const keyStateRef = useRef(keyState);
  keyStateRef.current = keyState;
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const action = boardKeyAction(event, focusPlace(document.activeElement), keyStateRef.current);
      if (!action) return;
      if (action === 'deselect') setSelectedId(null);
      else if (action === 'exit-mode') changeMode('select');
      else if (action === 'undo' || action === 'redo') {
        event.preventDefault();
        undoLatest(action);
      } else {
        event.preventDefault();
        changeMode(action.slice('mode:'.length) as BoardMode);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [changeMode, undoLatest]);

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

  // Pressing inside a story selects its frame and brings it to the front (without stopping the
  // press: the story still gets it, and its DOM node does not move).
  const onPointerDownCapture = (event: React.PointerEvent) => {
    const frameId = (event.target as Element).closest?.('[data-colab-frame]')?.getAttribute('data-colab-frame');
    if (frameId) select(frameId);
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
      data-colab-board-state={JSON.stringify({ view: board.view, frames, selectedId, mode })}
      data-colab-mode={mode}
      style={{ visibility: board.ready ? 'visible' : 'hidden' }}
      onPointerDownCapture={onPointerDownCapture}
    >
      <Surface ref={canvasRef} {...drawableCanvasProps} aria-label={`Canvas ${canvas.name}`}>
        {preview &&
          domFrames.map((frame) => (
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
      <StrokeLayer
        ref={strokeLayerRef}
        view={board.view}
        size={size}
        strokes={strokes.strokes}
        ink={theme.color.defaultText}
        fadedIds={drawTool.fadedIds}
      />
      <ChromeLayer>
        {domFrames.map((frame) => {
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
              onSelect={() => select(frame.id)}
              move={moveHandlers(frame.id)}
              resize={(edge) => resizeHandlers(frame.id, edge)}
              onNudge={(dx, dy) => nudge(frame.id, dx, dy)}
              onRemove={() => remove(frame.id)}
              onOpen={() => openStory(frame.storyId)}
            />
          );
        })}
      </ChromeLayer>
      <CommentLayer state={comments.layer} board={size} />
      <ModeLayer
        mode={mode}
        handlers={modeHandlers[mode]}
        view={board.view}
        spaceHeld={spaceHeld}
        onPress={() => rootRef.current?.focus({ preventScroll: true })}
      />
      {spaceHeld && <PanCatcher data-colab-pan-catcher="" />}
      {mode === 'draw' && (
        <DrawOptions
          settings={drawTool.settings}
          onChange={drawTool.setSettings}
          strokeCount={strokes.strokes.length}
          onClear={clearDrawing}
          container={rootRef.current}
        />
      )}
      <BoardNotice notice={shownNotice} onDismiss={dismissNotice} />
      <BoardToolbar
        zoom={board.view.zoom}
        onZoomIn={() => board.zoomStep(1)}
        onZoomOut={() => board.zoomStep(-1)}
        onResetZoom={() => board.zoomTo(1)}
        onFit={board.fit}
        canFit={frames.length > 0}
        mode={mode}
        modes={keyState.modes}
        onModeChange={changeMode}
        commentCount={comments.openCount}
        commentsOpen={comments.layer.listOpen}
        onToggleComments={comments.layer.toggleList}
      />
    </Root>
  );
}
