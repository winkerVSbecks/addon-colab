/**
 * Connects a canvas store to Storybook's server channel: answers `CANVAS_REQUEST`s and broadcasts
 * `CANVAS_CHANGED` for every change the store sees. Node only. Payloads are encoded JSON strings
 * (see `encodeCanvasMessage` in `../channel`).
 */
import {
  CANVAS_CHANGED,
  CANVAS_OPERATIONS,
  CANVAS_REQUEST,
  CANVAS_RESPONSE,
  type CanvasChangedMessage,
  type CanvasOperation,
  type CanvasRequest,
  type CanvasRequestBody,
  type CanvasResponse,
  type CanvasResponseBody,
  type ChannelLike,
  decodeCanvasMessage,
  encodeCanvasMessage,
} from '../channel';
import { type CanvasStore, CanvasStoreError } from './canvas-store';

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Registers the handlers; returns a function that removes them. */
export function registerCanvasChannel(channel: ChannelLike, store: CanvasStore): () => void {
  const onRequest = async (request: CanvasRequest) => {
    const id = request?.id;
    if (typeof id !== 'string') return;
    const respond = (body: CanvasResponseBody) => {
      const response: CanvasResponse = { id, payload: encodeCanvasMessage(body) };
      channel.emit(CANVAS_RESPONSE, response);
    };
    const body = decodeCanvasMessage<Partial<CanvasRequestBody>>(request.payload);
    if (!isPlainObject(body)) {
      respond({ success: false, error: 'Malformed canvas request', code: 'INVALID_INPUT' });
      return;
    }
    const { op, args } = body;
    if (!CANVAS_OPERATIONS.includes(op as CanvasOperation)) {
      respond({ success: false, error: `Unknown canvas operation "${String(op)}"`, code: 'UNKNOWN_OPERATION' });
      return;
    }
    const operation = op as CanvasOperation;
    if (operation !== 'list' && !isPlainObject(args)) {
      respond({
        success: false,
        error: `Invalid arguments for "${operation}": expected an object`,
        code: 'INVALID_INPUT',
        errors: [
          `args: expected an object, received ${args === null ? 'null' : Array.isArray(args) ? 'an array' : typeof args}`,
        ],
      });
      return;
    }
    try {
      const method = store[operation] as (args: unknown) => Promise<unknown>;
      const result = await method(args);
      respond({ success: true, result } as CanvasResponseBody);
    } catch (error) {
      if (error instanceof CanvasStoreError) {
        respond({ success: false, error: error.message, code: error.code, errors: error.errors });
      } else {
        console.error(`[addon-colab] canvas operation "${operation}" failed`, error);
        respond({ success: false, error: (error as Error)?.message ?? String(error), code: 'INTERNAL' });
      }
    }
  };

  channel.on(CANVAS_REQUEST, onRequest);
  const unsubscribe = store.subscribe((event) => {
    const message: CanvasChangedMessage = encodeCanvasMessage(event);
    channel.emit(CANVAS_CHANGED, message);
  });
  return () => {
    channel.off(CANVAS_REQUEST, onRequest);
    unsubscribe();
  };
}
