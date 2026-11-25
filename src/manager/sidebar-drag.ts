/**
 * Makes story rows in Storybook's sidebar draggable onto a canvas, without taking over
 * `sidebar.renderLabel` (a single slot that projects use for their own labels).
 *
 * Storybook 11's sidebar is a react-aria tree whose rows select (and so navigate) on pointerdown.
 * A drag that starts on a row would navigate away from the canvas before the drop. So, for a
 * primary mouse press on a story row, this module:
 * - marks the row `draggable` (the whole row is the handle, not just its label);
 * - stops the press from reaching the tree (as Storybook's own row buttons do with `stopRowPress`);
 * - navigates on click instead, with `api.selectStory`, when no drag happened.
 * Keyboard navigation (arrows, Enter) and touch are untouched: they never reach these handlers.
 *
 * Everything is event delegation on the manager document, so it works with any `renderLabel`,
 * with rows that appear later (expanding a component, filtering, search) and with collapsed
 * components (a component row is not a story, so it keeps expanding on click).
 */
import { STORY_DRAG_TYPE } from '../board/frame-defaults';
import { isCanvasEntry, isCanvasStoryId } from '../canvas-entry';

/** What this module needs from the manager API. */
export interface SidebarDragApi {
  selectStory: (storyId: string) => void;
  getData: (storyId: string) => { type?: string; tags?: string[] } | undefined;
}

const ROW_SELECTOR = '[role="row"][data-item-id]';
/** Storybook's own composition ref id; stories from other (composed) Storybooks cannot be drawn here. */
const INTERNAL_REF = 'storybook_internal';
/** Controls inside a row that handle their own presses (context menu, status buttons). */
const NESTED_CONTROL = 'button, a[href], input, select, textarea, [role="button"], [role="menuitem"]';
export const DRAGGABLE_MARK = 'data-colab-draggable';

/** The story id a row can be dragged as, or `undefined` if it is not a draggable story. */
export function draggableStoryId(row: Element, api: Pick<SidebarDragApi, 'getData'>): string | undefined {
  const html = row as HTMLElement;
  if (html.dataset.nodetype !== 'story') return undefined;
  if ((html.dataset.refId ?? INTERNAL_REF) !== INTERNAL_REF) return undefined;
  const id = html.dataset.itemId;
  if (!id || isCanvasStoryId(id)) return undefined;
  let entry: ReturnType<SidebarDragApi['getData']>;
  try {
    entry = api.getData(id);
  } catch {
    return undefined;
  }
  if (!entry || entry.type !== 'story' || isCanvasEntry(entry)) return undefined;
  return id;
}

function rowOf(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? (target.closest(ROW_SELECTOR) as HTMLElement | null) : null;
}

/** Whether the press started on a control inside the row (not the row itself). */
function onNestedControl(target: EventTarget | null, row: Element): boolean {
  if (!(target instanceof Element)) return false;
  const control = target.closest(NESTED_CONTROL);
  return !!control && control !== row && row.contains(control);
}

/** Installs the drag behaviour on a manager document. Returns a function that removes it. */
export function installSidebarDrag(api: SidebarDragApi, doc: Document = document): () => void {
  /** The row of the current primary mouse press, until click or drag end. */
  let pressed: { row: HTMLElement; storyId: string } | undefined;
  let dragging = false;

  const mark = (row: HTMLElement) => {
    const storyId = draggableStoryId(row, api);
    if (storyId) {
      if (row.getAttribute('draggable') !== 'true') row.setAttribute('draggable', 'true');
      row.setAttribute(DRAGGABLE_MARK, '');
    } else if (row.hasAttribute(DRAGGABLE_MARK)) {
      row.removeAttribute('draggable');
      row.removeAttribute(DRAGGABLE_MARK);
    }
    return storyId;
  };

  // Mark rows as they appear, so the browser shows them as draggable and a drag can start from the
  // first press. Batched to one scan per frame; the sidebar re-renders often.
  let scheduled = 0;
  const scan = () => {
    scheduled = 0;
    doc.querySelectorAll<HTMLElement>(`${ROW_SELECTOR}[data-nodetype="story"]`).forEach(mark);
  };
  const observer = new MutationObserver(() => {
    if (!scheduled) scheduled = requestAnimationFrame(scan);
  });
  observer.observe(doc.body, { childList: true, subtree: true });
  scan();

  const onPress = (event: PointerEvent | MouseEvent) => {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
    if ('pointerType' in event && event.pointerType && event.pointerType !== 'mouse') return;
    const row = rowOf(event.target);
    if (!row || onNestedControl(event.target, row)) return;
    const storyId = mark(row);
    if (!storyId) return;
    // Keep react-aria from selecting the row on press; it would navigate before a drag can start.
    event.stopPropagation();
    if (event.type === 'pointerdown') {
      pressed = { row, storyId };
      dragging = false;
    }
  };

  const onClick = (event: MouseEvent) => {
    const press = pressed;
    pressed = undefined;
    if (!press || dragging || event.button !== 0) return;
    const row = rowOf(event.target);
    if (row !== press.row || onNestedControl(event.target, row)) return;
    api.selectStory(press.storyId);
  };

  const onDragStart = (event: DragEvent) => {
    const row = rowOf(event.target);
    if (!row || !event.dataTransfer) return;
    const storyId = draggableStoryId(row, api);
    if (!storyId) return;
    dragging = true;
    event.dataTransfer.setData(STORY_DRAG_TYPE, storyId);
    event.dataTransfer.setData('text/plain', storyId);
    event.dataTransfer.effectAllowed = 'copy';
  };

  const onDragEnd = () => {
    dragging = false;
    pressed = undefined;
  };

  doc.addEventListener('pointerdown', onPress, true);
  doc.addEventListener('mousedown', onPress, true);
  doc.addEventListener('click', onClick, true);
  doc.addEventListener('dragstart', onDragStart, true);
  doc.addEventListener('dragend', onDragEnd, true);

  return () => {
    observer.disconnect();
    if (scheduled) cancelAnimationFrame(scheduled);
    doc.removeEventListener('pointerdown', onPress, true);
    doc.removeEventListener('mousedown', onPress, true);
    doc.removeEventListener('click', onClick, true);
    doc.removeEventListener('dragstart', onDragStart, true);
    doc.removeEventListener('dragend', onDragEnd, true);
    doc.querySelectorAll<HTMLElement>(`[${DRAGGABLE_MARK}]`).forEach((row) => {
      row.removeAttribute('draggable');
      row.removeAttribute(DRAGGABLE_MARK);
    });
  };
}
