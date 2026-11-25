/**
 * The canvas file format: one JSON file per canvas in `.storybook/canvases/<id>.json`.
 *
 * This module is the contract shared by the board (preview), the storage server (preset),
 * and the MCP tools the coding agent uses. Every reader and writer goes through
 * `validateCanvasFile` / `parseCanvasFile` and `serializeCanvasFile`.
 *
 * Coordinates (frame positions, position anchors, stroke points) are world coordinates
 * on the board in CSS pixels at zoom 1, independent of pan and zoom. Frame anchor offsets are
 * CSS pixels from the frame's top-left corner.
 */
import { z } from 'zod';

export const CANVAS_SCHEMA_VERSION = 1;

/** Canvas ids double as file names, so they are lowercase slugs: `design-review`, `sprint-12`. */
export const CANVAS_ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

const id = z.string().min(1).max(100).regex(ID_PATTERN, 'must contain only letters, digits, "-" and "_"');
const timestamp = z.iso.datetime();
const coordinate = z.number();
const length = z.number().positive();

export const authorSchema = z.enum(['user', 'agent']);
export const commentStatusSchema = z.enum(['open', 'resolved']);

/** A story placed on the board. `height` absent means the frame sizes to its content. */
export const frameSchema = z.object({
  id,
  storyId: z.string().min(1),
  x: coordinate,
  y: coordinate,
  width: length,
  height: length.optional(),
});

/** Identifies one DOM node inside a rendered story, robustly enough for an agent to find it in source. */
export const elementTargetSchema = z.object({
  storyId: z.string().min(1),
  /** Component title from the story's meta, e.g. `Example/Header`. */
  title: z.string().min(1),
  /** Story file path as Storybook indexes it, e.g. `./src/stories/Header.stories.ts`. */
  importPath: z.string().min(1),
  /** CSS selector relative to the story root that matches exactly this element. */
  selector: z.string().min(1),
  /** Short outer-HTML snippet of the element (truncated by the writer). */
  html: z.string().max(2000),
  /** Visible text content, trimmed; may be empty. */
  text: z.string().max(2000),
  role: z.string().min(1).optional(),
  /** Accessible name, when one can be computed. */
  name: z.string().min(1).optional(),
});

/**
 * Pins a comment to an element in a frame. `frameId` may refer to a frame that has since been
 * removed; the target still identifies the story and element.
 */
export const elementAnchorSchema = z.object({
  type: z.literal('element'),
  frameId: id,
  target: elementTargetSchema,
});

/**
 * Pins a comment to a whole story frame, for remarks about the story rather than one element.
 * `x`/`y` (given together or not at all) place the pin relative to the frame's top-left corner;
 * without them the pin sits at the corner. Like element anchors, `frameId` may refer to a removed
 * frame; `storyId` still identifies the story.
 */
export const frameAnchorSchema = z
  .object({
    type: z.literal('frame'),
    frameId: id,
    storyId: z.string().min(1),
    x: z.number().nonnegative().optional(),
    y: z.number().nonnegative().optional(),
  })
  .superRefine((anchor, ctx) => {
    if ((anchor.x === undefined) !== (anchor.y === undefined)) {
      ctx.addIssue({
        code: 'custom',
        path: [anchor.x === undefined ? 'x' : 'y'],
        message: 'x and y must be given together',
      });
    }
  });

/** Pins a comment to a free point on the board. */
export const positionAnchorSchema = z.object({
  type: z.literal('position'),
  x: coordinate,
  y: coordinate,
});

export const anchorSchema = z.discriminatedUnion('type', [
  elementAnchorSchema,
  frameAnchorSchema,
  positionAnchorSchema,
]);

export const replySchema = z.object({
  id,
  author: authorSchema,
  body: z.string().trim().min(1),
  createdAt: timestamp,
});

/** `resolvedAt` is present exactly when `status` is `resolved`; use `resolveComment` / `reopenComment`. */
export const commentSchema = z
  .object({
    id,
    author: authorSchema,
    body: z.string().trim().min(1),
    status: commentStatusSchema,
    anchor: anchorSchema,
    createdAt: timestamp,
    resolvedAt: timestamp.optional(),
    replies: z.array(replySchema),
  })
  .superRefine((comment, ctx) => {
    if (comment.status === 'resolved' && comment.resolvedAt === undefined) {
      ctx.addIssue({ code: 'custom', path: ['resolvedAt'], message: 'a resolved comment needs resolvedAt' });
    } else if (comment.status === 'open' && comment.resolvedAt !== undefined) {
      ctx.addIssue({ code: 'custom', path: ['resolvedAt'], message: 'an open comment must not have resolvedAt' });
    }
  });

export const pointSchema = z.tuple([coordinate, coordinate]);

/** A freehand stroke: world-coordinate points, a CSS color and a line width in world pixels. */
export const strokeSchema = z.object({
  id,
  color: z.string().min(1),
  width: length,
  points: z.array(pointSchema).min(1),
});

export const canvasFileSchema = z
  .object({
    schemaVersion: z.literal(CANVAS_SCHEMA_VERSION),
    id: z.string().regex(CANVAS_ID_PATTERN, 'must be a lowercase slug such as "design-review"'),
    name: z.string().trim().min(1).max(200),
    createdAt: timestamp,
    updatedAt: timestamp,
    frames: z.array(frameSchema),
    comments: z.array(commentSchema),
    strokes: z.array(strokeSchema),
  })
  .superRefine((canvas, ctx) => {
    const seen = new Map<string, string>();
    const check = (itemId: string, path: (string | number)[]) => {
      const first = seen.get(itemId);
      if (first) {
        ctx.addIssue({ code: 'custom', path, message: `duplicate id "${itemId}" (first used at ${first})` });
      } else {
        seen.set(itemId, formatPath(path));
      }
    };
    canvas.frames.forEach((frame, i) => check(frame.id, ['frames', i, 'id']));
    canvas.comments.forEach((comment, i) => {
      check(comment.id, ['comments', i, 'id']);
      comment.replies.forEach((reply, j) => check(reply.id, ['comments', i, 'replies', j, 'id']));
    });
    canvas.strokes.forEach((stroke, i) => check(stroke.id, ['strokes', i, 'id']));
  });

export type Author = z.infer<typeof authorSchema>;
export type CommentStatus = z.infer<typeof commentStatusSchema>;
export type Frame = z.infer<typeof frameSchema>;
export type ElementTarget = z.infer<typeof elementTargetSchema>;
export type ElementAnchor = z.infer<typeof elementAnchorSchema>;
export type FrameAnchor = z.infer<typeof frameAnchorSchema>;
export type PositionAnchor = z.infer<typeof positionAnchorSchema>;
export type Anchor = z.infer<typeof anchorSchema>;
export type Reply = z.infer<typeof replySchema>;
export type Comment = z.infer<typeof commentSchema>;
export type Point = z.infer<typeof pointSchema>;
export type Stroke = z.infer<typeof strokeSchema>;
export type CanvasFile = z.infer<typeof canvasFileSchema>;

export type CanvasValidationResult = { ok: true; canvas: CanvasFile } | { ok: false; errors: string[] };

/**
 * Validates an already-parsed value. On success, `canvas` is a clean copy: unknown keys are dropped
 * and keys follow the schema order.
 */
export function validateCanvasFile(value: unknown): CanvasValidationResult {
  if (isRecord(value) && 'schemaVersion' in value && value.schemaVersion !== CANVAS_SCHEMA_VERSION) {
    return {
      ok: false,
      errors: [
        `schemaVersion: unsupported version ${JSON.stringify(value.schemaVersion)}; this addon reads version ${CANVAS_SCHEMA_VERSION}`,
      ],
    };
  }
  const result = canvasFileSchema.safeParse(value);
  if (result.success) {
    return { ok: true, canvas: result.data };
  }
  return {
    ok: false,
    errors: result.error.issues.map((issue) => `${formatPath(issue.path) || '(root)'}: ${issue.message}`),
  };
}

/** Parses and validates the text of a canvas file. */
export function parseCanvasFile(text: string): CanvasValidationResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { ok: false, errors: [`invalid JSON: ${(error as Error).message}`] };
  }
  return validateCanvasFile(value);
}

/**
 * Serializes a canvas for writing to disk: validated, keys in schema order, two-space indent,
 * one line per scalar field, and number arrays (stroke points) kept on a single line so diffs stay
 * readable. Ends with a newline. Throws if the canvas is invalid.
 */
export function serializeCanvasFile(canvas: CanvasFile): string {
  const result = validateCanvasFile(canvas);
  if (!result.ok) {
    throw new Error(`Invalid canvas file:\n${result.errors.join('\n')}`);
  }
  return `${formatJson(result.canvas, '')}\n`;
}

/** Creates an empty canvas. */
export function createCanvasFile({ id, name, now = new Date() }: { id: string; name: string; now?: Date }): CanvasFile {
  const at = now.toISOString();
  const result = validateCanvasFile({
    schemaVersion: CANVAS_SCHEMA_VERSION,
    id,
    name,
    createdAt: at,
    updatedAt: at,
    frames: [],
    comments: [],
    strokes: [],
  });
  if (!result.ok) {
    throw new Error(`Invalid canvas:\n${result.errors.join('\n')}`);
  }
  return result.canvas;
}

/** Returns a resolved copy of the comment, stamped with `now`. */
export function resolveComment(comment: Comment, now: Date = new Date()): Comment {
  return { ...comment, status: 'resolved', resolvedAt: now.toISOString() };
}

/** Returns an open copy of the comment with `resolvedAt` removed. */
export function reopenComment(comment: Comment): Comment {
  const reopened: Comment = { ...comment, status: 'open' };
  delete reopened.resolvedAt;
  return reopened;
}

export function isCanvasId(value: string): boolean {
  return CANVAS_ID_PATTERN.test(value);
}

/** Turns a display name into a canvas id: "Sprint 12 review!" → "sprint-12-review". Empty if nothing usable remains. */
export function canvasIdFromName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '');
}

/** Creates an id for a frame, comment, reply or stroke, e.g. `comment-1f3a9c0b2e4d`. */
export function createId(prefix: 'frame' | 'comment' | 'reply' | 'stroke'): string {
  return `${prefix}-${globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function formatPath(path: readonly PropertyKey[]): string {
  return path.map((key, i) => (typeof key === 'number' ? `[${key}]` : `${i === 0 ? '' : '.'}${String(key)}`)).join('');
}

function isFlatNumberArray(value: unknown[]): boolean {
  return value.every((item) => typeof item === 'number');
}

function formatJson(value: unknown, indent: string): string {
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (isFlatNumberArray(value) || value.every((item) => Array.isArray(item) && isFlatNumberArray(item))) {
      return JSON.stringify(value);
    }
    const inner = indent + '  ';
    return `[\n${value.map((item) => inner + formatJson(item, inner)).join(',\n')}\n${indent}]`;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return '{}';
    const inner = indent + '  ';
    return `{\n${entries.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${formatJson(v, inner)}`).join(',\n')}\n${indent}}`;
  }
  return JSON.stringify(value);
}
