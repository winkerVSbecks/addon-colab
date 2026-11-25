/**
 * Turns canvas data into what the MCP tools return to a coding agent: compact, self-contained
 * records. Every comment carries enough to find the code it is about (story id, story file,
 * selector, HTML snippet, text, role/name), and strokes are summarised by the story frames they
 * touch instead of raw point arrays. Pure functions; no Node or Storybook imports.
 */
import type { Anchor, CanvasFile, Comment, Frame, Point, Stroke } from '../../canvas-file';

/** What the story index knows about a story id. `undefined` when the story no longer exists. */
export interface StoryInfo {
  title: string;
  name: string;
  /** Story file as Storybook indexes it, e.g. `./src/stories/Header.stories.ts`. */
  importPath: string;
}

export type StoryLookup = (storyId: string) => StoryInfo | undefined;

/**
 * Frames without a stored height size to their rendered content, which the server cannot measure.
 * For overlap checks they are assumed to be this tall; results say when this was assumed.
 */
export const ASSUMED_FRAME_HEIGHT = 400;

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FrameSummary {
  frameId: string;
  storyId: string;
  /** From the story index; absent when the story no longer exists. */
  title?: string;
  storyName?: string;
  storyFile?: string;
  x: number;
  y: number;
  width: number;
  /** Absent: the frame sizes to its content. */
  height?: number;
}

export interface FrameRef {
  frameId: string;
  storyId: string;
  storyFile?: string;
}

export type CommentLocation =
  | {
      type: 'element';
      frameId: string;
      /** False when the frame was removed from the canvas; the target still identifies the element. */
      frameOnCanvas: boolean;
      storyId: string;
      title: string;
      storyFile: string;
      selector: string;
      role?: string;
      name?: string;
      /** Text of the element's row, when other elements in the story look the same (each row's "Delete"). */
      context?: string;
      text: string;
      html: string;
    }
  | {
      type: 'frame';
      frameId: string;
      frameOnCanvas: boolean;
      storyId: string;
      title?: string;
      storyFile?: string;
      /** Pin position relative to the frame's top-left corner, when given. */
      offset?: { x: number; y: number };
    }
  | {
      type: 'position';
      x: number;
      y: number;
      /** Story frames this point lies in, if any. */
      insideFrames: FrameRef[];
    };

export interface CommentSummary {
  canvasId: string;
  commentId: string;
  status: Comment['status'];
  author: Comment['author'];
  body: string;
  createdAt: string;
  resolvedAt?: string;
  location: CommentLocation;
  replies: { replyId: string; author: Comment['author']; body: string; createdAt: string }[];
}

export type StrokeRelation = 'within' | 'crosses' | 'surrounds' | 'near';

export interface StrokeSummary {
  strokeId: string;
  color: string;
  width: number;
  pointCount: number;
  bounds: Rect;
  /**
   * Story frames the stroke relates to: `within` (drawn entirely on the frame), `crosses` (partly on
   * it), `surrounds` (circles or encloses it without touching it), `near` (only their bounding boxes
   * overlap).
   */
  frames: (FrameRef & { relation: StrokeRelation })[];
  /** Only when points were requested. */
  points?: Point[];
}

export function frameRect(frame: Frame): Rect & { heightAssumed: boolean } {
  return {
    x: frame.x,
    y: frame.y,
    width: frame.width,
    height: frame.height ?? ASSUMED_FRAME_HEIGHT,
    heightAssumed: frame.height === undefined,
  };
}

function contains(rect: Rect, x: number, y: number, margin = 0): boolean {
  return (
    x >= rect.x - margin &&
    x <= rect.x + rect.width + margin &&
    y >= rect.y - margin &&
    y <= rect.y + rect.height + margin
  );
}

function intersects(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height;
}

function boundsOf(points: Point[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of points) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function round(rect: Rect): Rect {
  const r = (n: number) => Math.round(n * 10) / 10;
  return { x: r(rect.x), y: r(rect.y), width: r(rect.width), height: r(rect.height) };
}

function frameRef(frame: Frame, lookup: StoryLookup): FrameRef {
  const storyFile = lookup(frame.storyId)?.importPath;
  return { frameId: frame.id, storyId: frame.storyId, ...(storyFile ? { storyFile } : {}) };
}

export function summarizeFrame(frame: Frame, lookup: StoryLookup): FrameSummary {
  const story = lookup(frame.storyId);
  return {
    frameId: frame.id,
    storyId: frame.storyId,
    ...(story ? { title: story.title, storyName: story.name, storyFile: story.importPath } : {}),
    x: frame.x,
    y: frame.y,
    width: frame.width,
    ...(frame.height !== undefined ? { height: frame.height } : {}),
  };
}

export function describeAnchor(anchor: Anchor, canvas: CanvasFile, lookup: StoryLookup): CommentLocation {
  switch (anchor.type) {
    case 'element': {
      const { target } = anchor;
      return {
        type: 'element',
        frameId: anchor.frameId,
        frameOnCanvas: canvas.frames.some((frame) => frame.id === anchor.frameId),
        storyId: target.storyId,
        title: target.title,
        storyFile: target.importPath,
        selector: target.selector,
        ...(target.role ? { role: target.role } : {}),
        ...(target.name ? { name: target.name } : {}),
        ...(target.context ? { context: target.context } : {}),
        text: target.text,
        html: target.html,
      };
    }
    case 'frame': {
      const story = lookup(anchor.storyId);
      return {
        type: 'frame',
        frameId: anchor.frameId,
        frameOnCanvas: canvas.frames.some((frame) => frame.id === anchor.frameId),
        storyId: anchor.storyId,
        ...(story ? { title: story.title, storyFile: story.importPath } : {}),
        ...(anchor.x !== undefined && anchor.y !== undefined ? { offset: { x: anchor.x, y: anchor.y } } : {}),
      };
    }
    case 'position':
      return {
        type: 'position',
        x: anchor.x,
        y: anchor.y,
        insideFrames: canvas.frames
          .filter((frame) => contains(frameRect(frame), anchor.x, anchor.y))
          .map((frame) => frameRef(frame, lookup)),
      };
  }
}

export function summarizeComment(comment: Comment, canvas: CanvasFile, lookup: StoryLookup): CommentSummary {
  return {
    canvasId: canvas.id,
    commentId: comment.id,
    status: comment.status,
    author: comment.author,
    body: comment.body,
    createdAt: comment.createdAt,
    ...(comment.resolvedAt ? { resolvedAt: comment.resolvedAt } : {}),
    location: describeAnchor(comment.anchor, canvas, lookup),
    replies: comment.replies.map((reply) => ({
      replyId: reply.id,
      author: reply.author,
      body: reply.body,
      createdAt: reply.createdAt,
    })),
  };
}

export function summarizeStroke(
  stroke: Stroke,
  canvas: CanvasFile,
  lookup: StoryLookup,
  { includePoints = false }: { includePoints?: boolean } = {},
): StrokeSummary {
  const bounds = boundsOf(stroke.points);
  const margin = stroke.width / 2;
  const frames: StrokeSummary['frames'] = [];
  for (const frame of canvas.frames) {
    const rect = frameRect(frame);
    const inside = stroke.points.filter(([x, y]) => contains(rect, x, y, margin)).length;
    let relation: StrokeRelation | undefined;
    if (inside === stroke.points.length) {
      relation = 'within';
    } else if (inside > 0) {
      relation = 'crosses';
    } else if (contains(bounds, rect.x + rect.width / 2, rect.y + rect.height / 2)) {
      relation = 'surrounds';
    } else if (intersects(bounds, rect)) {
      relation = 'near';
    }
    if (relation) {
      frames.push({ ...frameRef(frame, lookup), relation });
    }
  }
  return {
    strokeId: stroke.id,
    color: stroke.color,
    width: stroke.width,
    pointCount: stroke.points.length,
    bounds: round(bounds),
    frames,
    ...(includePoints ? { points: stroke.points } : {}),
  };
}

export interface CanvasDetails {
  canvasId: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  frames: FrameSummary[];
  comments: CommentSummary[];
  strokes: StrokeSummary[];
  /** Present when some frame has no stored height, so overlap results for it are estimates. */
  note?: string;
}

export function summarizeCanvas(
  canvas: CanvasFile,
  lookup: StoryLookup,
  { includeStrokePoints = false }: { includeStrokePoints?: boolean } = {},
): CanvasDetails {
  const anyAssumed = canvas.frames.some((frame) => frame.height === undefined);
  return {
    canvasId: canvas.id,
    name: canvas.name,
    createdAt: canvas.createdAt,
    updatedAt: canvas.updatedAt,
    frames: canvas.frames.map((frame) => summarizeFrame(frame, lookup)),
    comments: canvas.comments.map((comment) => summarizeComment(comment, canvas, lookup)),
    strokes: canvas.strokes.map((stroke) =>
      summarizeStroke(stroke, canvas, lookup, { includePoints: includeStrokePoints }),
    ),
    ...(anyAssumed
      ? {
          note: `Frames without a height size to their content; overlap checks assume they are ${ASSUMED_FRAME_HEIGHT}px tall.`,
        }
      : {}),
  };
}
