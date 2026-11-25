/**
 * Connects a canvas store to Storybook's server channel: answers `CANVAS_REQUEST`s and broadcasts
 * `CANVAS_CHANGED` for every change the store sees. Node only.
 */
import {
  CANVAS_CHANGED,
  CANVAS_OPERATIONS,
  CANVAS_REQUEST,
  CANVAS_RESPONSE,
  type CanvasOperation,
  type CanvasRequest,
  type CanvasResponse,
  type ChannelLike,
} from '../channel';
import { type CanvasStore, CanvasStoreError } from './canvas-store';

/** Registers the handlers; returns a function that removes them. */
export function registerCanvasChannel(channel: ChannelLike, store: CanvasStore): () => void {
  const onRequest = async (request: CanvasRequest) => {
    const id = request?.id;
    if (typeof id !== 'string') return;
    const respond = (response: CanvasResponse) => channel.emit(CANVAS_RESPONSE, response);
    const op = request.payload?.op;
    if (!CANVAS_OPERATIONS.includes(op as CanvasOperation)) {
      respond({
        id,
        success: false,
        error: `Unknown canvas operation "${String(op)}"`,
        payload: { code: 'UNKNOWN_OPERATION' },
      });
      return;
    }
    try {
      const method = store[op] as (args: unknown) => Promise<unknown>;
      const payload = await method(request.payload.args);
      respond({ id, success: true, error: null, payload } as CanvasResponse);
    } catch (error) {
      if (error instanceof CanvasStoreError) {
        respond({ id, success: false, error: error.message, payload: { code: error.code, errors: error.errors } });
      } else {
        console.error(`[addon-colab] canvas operation "${op}" failed`, error);
        respond({
          id,
          success: false,
          error: (error as Error)?.message ?? String(error),
          payload: { code: 'INTERNAL' },
        });
      }
    }
  };

  channel.on(CANVAS_REQUEST, onRequest);
  const unsubscribe = store.subscribe((event) => channel.emit(CANVAS_CHANGED, event));
  return () => {
    channel.off(CANVAS_REQUEST, onRequest);
    unsubscribe();
  };
}
