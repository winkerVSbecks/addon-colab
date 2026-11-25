/**
 * Comments on the board: the comment mode's press handlers (hover highlight, pinning to an element,
 * a frame or the canvas), the pins' positions, and every comment action (add, reply, resolve,
 * reopen, delete with undo), all written through the store channel.
 *
 * The board calls this once and plugs `handlers` into its mode layer (`modeHandlers.comment`) and
 * renders `CommentLayer` with `layer`.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { accessibleName, collapsedText, describeElement, roleOf } from '../../board/element-target';
import {
  type ElementOffset,
  type PinFrame,
  type PinPlacement,
  describeTarget,
  pinPlacement,
  sortComments,
  stackIndexes,
} from '../../board/comment-pins';
import type { UndoEntry, UndoStack } from '../../board/undo-stack';
import { type Point, type Viewport, worldToScreen } from '../../board/viewport';
import type { Anchor, CanvasFile, Comment } from '../../canvas-file';
import { CanvasRequestError, type ChannelLike, requestCanvas } from '../../channel';
import { pinOffsetInFrame, pointInFrame, resolveElementOffset, storyHitAt, targetStory } from './comment-dom';
import type { ModeHandlers } from './ModeLayer';
import type { PreviewLike } from './story-mount';

/** A highlighted element or frame under the pointer, in board-relative screen pixels. */
export interface HoverBox {
  left: number;
  top: number;
  width: number;
  height: number;
  label: string;
  kind: 'element' | 'frame';
}

/** A comment being written: where it goes and what it is about. */
export interface Draft {
  anchor: Anchor;
  /** World point of the pin. */
  point: Point;
  /** What it is about, in a few words. */
  label: string;
  /** Set when the element target's story facts are still loading. */
  loading?: boolean;
}

export interface ShownPin {
  comment: Comment;
  placement: PinPlacement;
  /** Board-relative screen position of the pin's point (absent for orphans). */
  screen?: Point;
  /** Position within a stack of pins on the same spot. */
  stack: number;
  /** An agent comment that arrived while the board was open (shown with a pulse for a while). */
  fresh: boolean;
}

export interface UseCommentsOptions {
  canvas: CanvasFile;
  frames: readonly { id: string; storyId: string; x: number; y: number; width: number }[];
  view: Viewport;
  root: React.RefObject<HTMLElement | null>;
  preview: PreviewLike | undefined;
  channel: ChannelLike;
  undoStack: UndoStack;
  showUndoable: (message: string, entry: UndoEntry) => void;
  showError: (message: string) => void;
  /** Story name for a story id (short title), for descriptions. */
  storyName: (storyId: string) => string;
  /** Centres the board on a world point (focusing a pin from the list). */
  centerOn: (point: Point) => void;
  /** Whether comment mode is on. */
  active: boolean;
}

const FRESH_MS = 4000;

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function sameOffsets(a: ReadonlyMap<string, ElementOffset>, b: ReadonlyMap<string, ElementOffset>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, offset] of a) {
    const other = b.get(id);
    if (!other || other.kind !== offset.kind) return false;
    if (offset.kind === 'offset' && other.kind === 'offset') {
      if (Math.abs(offset.offset.x - other.offset.x) > 0.5 || Math.abs(offset.offset.y - other.offset.y) > 0.5) {
        return false;
      }
    }
  }
  return true;
}

export function useComments({
  canvas,
  frames,
  view,
  root,
  preview,
  channel,
  undoStack,
  showUndoable,
  showError,
  storyName,
  centerOn,
  active,
}: UseCommentsOptions) {
  const [hover, setHover] = useState<HoverBox | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [listOpen, setListOpen] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [offsets, setOffsets] = useState<ReadonlyMap<string, ElementOffset>>(new Map());
  const [domTick, setDomTick] = useState(0);
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());

  const canvasRef = useRef(canvas);
  canvasRef.current = canvas;
  const viewRef = useRef(view);
  viewRef.current = view;
  const framesRef = useRef(frames);
  framesRef.current = frames;

  const comments = useMemo(() => canvas.comments.filter((c) => !hidden.has(c.id)), [canvas.comments, hidden]);

  // Deleted comments are hidden at once; forget them once the file agrees (or they came back).
  useEffect(() => {
    if (hidden.size === 0) return;
    const ids = new Set(canvas.comments.map((c) => c.id));
    const still = [...hidden].filter((id) => ids.has(id));
    if (still.length !== hidden.size) setHidden(new Set(still));
  }, [canvas.comments, hidden]);

  // Agent comments that arrive while the board is open pulse for a moment.
  const known = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = canvas.comments.map((c) => c.id);
    if (!known.current) {
      known.current = new Set(ids);
      return;
    }
    const arrived = canvas.comments.filter((c) => c.author === 'agent' && !known.current?.has(c.id)).map((c) => c.id);
    for (const id of ids) known.current.add(id);
    if (arrived.length === 0) return;
    setFresh((current) => new Set([...current, ...arrived]));
    const timer = setTimeout(
      () => setFresh((current) => new Set([...current].filter((id) => !arrived.includes(id)))),
      FRESH_MS,
    );
    return () => clearTimeout(timer);
  }, [canvas.comments]);

  // A thread whose comment went away (deleted here or by the agent) closes.
  useEffect(() => {
    if (openId && !comments.some((c) => c.id === openId)) setOpenId(null);
  }, [comments, openId]);

  // What is typed in the draft's composer. A draft with text is never dropped behind the user's
  // back (switching mode, opening another thread); only Cancel, Escape or saving it ends it.
  const draftText = useRef('');
  const setDraftText = useCallback((text: string) => {
    draftText.current = text;
  }, []);
  const draftHasText = () => draftText.current.trim().length > 0;
  useEffect(() => {
    if (!draft) draftText.current = '';
  }, [draft]);

  // Leaving comment mode drops the highlight, and the draft unless something is typed in it.
  useEffect(() => {
    if (!active) {
      setHover(null);
      if (!draftHasText()) setDraft(null);
    }
  }, [active]);

  // Stories re-render on their own (state, effects, hot reload): re-check element pins then.
  useEffect(() => {
    const surface = root.current?.querySelector('canvas');
    if (!surface) return;
    let frame = 0;
    const observer = new MutationObserver(() => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        setDomTick((tick) => tick + 1);
      });
    });
    observer.observe(surface, { subtree: true, childList: true, attributes: true, characterData: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [root]);

  // Element pins: where each element is inside its frame, after every render.
  const frameMap = useMemo(() => new Map<string, PinFrame>(frames.map((f) => [f.id, f])), [frames]);
  useLayoutEffect(() => {
    const doc = root.current?.ownerDocument;
    if (!doc) return;
    const next = new Map<string, ElementOffset>();
    for (const comment of comments) {
      const { anchor } = comment;
      if (anchor.type !== 'element') continue;
      const frame = frameMap.get(anchor.frameId);
      if (!frame) continue;
      next.set(comment.id, resolveElementOffset(doc, frame.id, frame.width, anchor.target));
    }
    setOffsets((current) => (sameOffsets(current, next) ? current : next));
  });
  void domTick;

  const pins = useMemo<ShownPin[]>(() => {
    const visible = sortComments(comments).filter((c) => showResolved || c.status === 'open' || c.id === openId);
    const placed = visible.map((comment) => ({
      comment,
      placement: pinPlacement(comment.anchor, frameMap, () => offsets.get(comment.id) ?? { kind: 'pending' }),
    }));
    const stacks = stackIndexes(
      placed.flatMap(({ comment, placement }) =>
        placement.state === 'orphan' ? [] : [{ id: comment.id, point: placement.point }],
      ),
    );
    return placed.map(({ comment, placement }) => ({
      comment,
      placement,
      screen: placement.state === 'orphan' ? undefined : worldToScreen(view, placement.point),
      stack: stacks.get(comment.id) ?? 0,
      fresh: fresh.has(comment.id),
    }));
  }, [comments, showResolved, openId, frameMap, offsets, view, fresh]);

  // ---- Comment mode: hover and press ---------------------------------------------------------

  const hoverFrame = useRef(0);
  const describeHit = useCallback(
    (clientX: number, clientY: number, exact: boolean) => {
      const element = root.current;
      if (!element) return null;
      const hit = storyHitAt(element.ownerDocument, clientX, clientY, { exact });
      if (!hit) return null;
      const box = element.getBoundingClientRect();
      const target = hit.element ?? hit.frame;
      const rect = target.getBoundingClientRect();
      return {
        hit,
        box: {
          left: rect.left - box.left,
          top: rect.top - box.top,
          width: rect.width,
          height: rect.height,
          kind: hit.element ? 'element' : 'frame',
          label: hit.element
            ? describeTarget({
                html: `<${hit.element.tagName.toLowerCase()}>`,
                text: collapsedText(hit.element),
                role: roleOf(hit.element),
                name: accessibleName(hit.element),
              })
            : storyName(framesRef.current.find((f) => f.id === hit.frameId)?.storyId ?? ''),
        } satisfies HoverBox,
      };
    },
    [root, storyName],
  );

  const onMove: ModeHandlers['onMove'] = (event) => {
    const { clientX, clientY, altKey } = event;
    if (hoverFrame.current) cancelAnimationFrame(hoverFrame.current);
    hoverFrame.current = requestAnimationFrame(() => {
      hoverFrame.current = 0;
      setHover(describeHit(clientX, clientY, altKey)?.box ?? null);
    });
  };

  const onPress: ModeHandlers['onPress'] = (event, pointer) => {
    setOpenId(null);
    const found = describeHit(event.clientX, event.clientY, event.altKey);
    if (!found) {
      const point = { x: Math.round(pointer.world.x), y: Math.round(pointer.world.y) };
      setDraft({ anchor: { type: 'position', ...point }, point, label: 'On the canvas' });
      return;
    }
    const { hit } = found;
    const frame = framesRef.current.find((f) => f.id === hit.frameId);
    if (!frame) return;
    if (!hit.element) {
      const offset = pointInFrame(hit.frame, frame.width, event.clientX, event.clientY);
      setDraft({
        anchor: { type: 'frame', frameId: frame.id, storyId: frame.storyId, ...offset },
        point: { x: frame.x + offset.x, y: frame.y + offset.y },
        label: storyName(frame.storyId),
      });
      return;
    }
    // Describe the element now (the story may change while its facts load), then add the story facts.
    const placeholder = { storyId: frame.storyId, title: frame.storyId, importPath: 'unknown' };
    const target = describeElement(hit.element, hit.root, placeholder);
    const offset = pinOffsetInFrame(hit.element, hit.frame, frame.width);
    const point =
      offset.kind === 'offset'
        ? { x: frame.x + offset.offset.x, y: frame.y + offset.offset.y }
        : { x: frame.x, y: frame.y };
    const label = `${describeTarget(target)} in ${storyName(frame.storyId)}`;
    const anchor: Anchor = { type: 'element', frameId: frame.id, target };
    setDraft({ anchor, point, label, loading: true });
    if (!preview) {
      setDraft((current) => (current?.anchor === anchor ? { ...current, loading: false } : current));
      return;
    }
    targetStory(preview, frame.storyId)
      .then((story) => {
        const complete: Anchor = { type: 'element', frameId: frame.id, target: { ...target, ...story } };
        setDraft((current) =>
          current?.anchor === anchor ? { ...current, anchor: complete, loading: false } : current,
        );
      })
      .catch((error: unknown) => {
        setDraft((current) => (current?.anchor === anchor ? null : current));
        showError(`Couldn't read the story for the comment: ${describe(error)}`);
      });
  };

  const handlers: ModeHandlers = {
    onPress,
    onMove,
    onLeave: () => setHover(null),
    cursor: 'crosshair',
  };

  // ---- Actions -------------------------------------------------------------------------------

  const canvasId = canvas.id;

  const submitDraft = useCallback(
    async (body: string) => {
      if (!draft || draft.loading) return false;
      try {
        await requestCanvas(channel, 'addComment', {
          canvasId,
          comment: { author: 'user', body, anchor: draft.anchor },
        });
        setDraft(null);
        root.current?.focus({ preventScroll: true });
        return true;
      } catch (error) {
        showError(`Couldn't save the comment: ${describe(error)}`);
        return false;
      }
    },
    [canvasId, channel, draft, root, showError],
  );

  const cancelDraft = useCallback(() => {
    setDraft(null);
    root.current?.focus({ preventScroll: true });
  }, [root]);

  const reply = useCallback(
    async (commentId: string, body: string) => {
      try {
        await requestCanvas(channel, 'addReply', { canvasId, commentId, reply: { author: 'user', body } });
        return true;
      } catch (error) {
        showError(`Couldn't save the reply: ${describe(error)}`);
        return false;
      }
    },
    [canvasId, channel, showError],
  );

  const setResolved = useCallback(
    async (commentId: string, resolved: boolean) => {
      try {
        await requestCanvas(channel, resolved ? 'resolveComment' : 'reopenComment', { canvasId, commentId });
      } catch (error) {
        showError(`Couldn't ${resolved ? 'resolve' : 'reopen'} the comment: ${describe(error)}`);
      }
    },
    [canvasId, channel, showError],
  );

  const remove = useCallback(
    (commentId: string) => {
      const current = canvasRef.current;
      const index = current.comments.findIndex((c) => c.id === commentId);
      const comment = current.comments[index];
      if (!comment) return;
      setHidden((set) => new Set(set).add(commentId));
      setOpenId(null);
      root.current?.focus({ preventScroll: true });
      const del = () =>
        requestCanvas(channel, 'deleteComment', { canvasId: current.id, commentId }).then(
          () => true,
          (error: unknown) => {
            if (error instanceof CanvasRequestError && error.code === 'NOT_FOUND') return true;
            setHidden((set) => {
              const next = new Set(set);
              next.delete(commentId);
              return next;
            });
            showError(`Couldn't delete the comment: ${describe(error)}`);
            return false;
          },
        );
      let deleted = del();
      const entry = undoStack.push({
        label: 'Delete comment',
        undo: async () => {
          if (!(await deleted)) return false;
          try {
            await requestCanvas(channel, 'restoreComment', { canvasId: current.id, comment, index });
          } catch (error) {
            if (!(error instanceof CanvasRequestError && error.code === 'ALREADY_EXISTS')) {
              showError(`Couldn't put the comment back: ${describe(error)}`);
              return false;
            }
          }
          setHidden((set) => {
            const next = new Set(set);
            next.delete(commentId);
            return next;
          });
          return true;
        },
        redo: () => {
          setHidden((set) => new Set(set).add(commentId));
          deleted = del();
          return deleted;
        },
      });
      showUndoable('Deleted comment', entry);
    },
    [channel, root, showError, showUndoable, undoStack],
  );

  /** Opens a comment's thread and brings its pin into view (from the list). */
  const focus = useCallback(
    (commentId: string) => {
      const pin = pins.find((p) => p.comment.id === commentId);
      const comment = pin?.comment ?? comments.find((c) => c.id === commentId);
      if (!comment) return;
      if (comment.status === 'resolved') setShowResolved(true);
      if (!draftHasText()) setDraft(null);
      setOpenId(commentId);
      const placement =
        pin?.placement ?? pinPlacement(comment.anchor, frameMap, () => offsets.get(commentId) ?? { kind: 'pending' });
      if (placement.state !== 'orphan') centerOn(placement.point);
    },
    [centerOn, comments, frameMap, offsets, pins],
  );

  const toggleList = useCallback(() => setListOpen((open) => !open), []);

  return {
    handlers,
    comments,
    openCount: comments.filter((c) => c.status === 'open').length,
    layer: {
      pins,
      hover: active && !draft ? hover : null,
      draft,
      draftScreen: draft ? worldToScreen(view, draft.point) : undefined,
      openId,
      setOpenId,
      listOpen,
      setListOpen,
      toggleList,
      showResolved,
      setShowResolved,
      submitDraft,
      cancelDraft,
      setDraftText,
      reply,
      setResolved,
      remove,
      focus,
      storyName,
      comments,
    },
  };
}

export type CommentLayerState = ReturnType<typeof useComments>['layer'];
