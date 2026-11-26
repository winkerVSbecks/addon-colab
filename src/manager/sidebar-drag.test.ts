import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { STORY_DRAG_TYPE } from '../board/frame-defaults';
import { DRAGGABLE_MARK, draggableStoryId, installSidebarDrag } from './sidebar-drag';

/** A stand-in for a sidebar row: only `dataset` is read. */
function row(dataset: Record<string, string>) {
  return { dataset } as unknown as Element;
}

const entries: Record<string, { type: string; tags?: string[] }> = {
  'example-button--primary': { type: 'story', tags: ['dev'] },
  'example-button--docs': { type: 'docs' },
  'colab-canvas-board--canvas': { type: 'story', tags: ['colab-canvas'] },
  'odd-canvas--story': { type: 'story', tags: ['colab-canvas'] },
};
const api = { getData: (id: string) => entries[id] };

describe('draggableStoryId', () => {
  it('accepts story rows of this Storybook', () => {
    expect(
      draggableStoryId(row({ nodetype: 'story', itemId: 'example-button--primary', refId: 'storybook_internal' }), api),
    ).toBe('example-button--primary');
    // Rows without a ref id are this Storybook's too.
    expect(draggableStoryId(row({ nodetype: 'story', itemId: 'example-button--primary' }), api)).toBe(
      'example-button--primary',
    );
  });

  it('rejects components, groups and docs entries', () => {
    expect(draggableStoryId(row({ nodetype: 'component', itemId: 'example-button' }), api)).toBeUndefined();
    expect(draggableStoryId(row({ nodetype: 'group', itemId: 'example' }), api)).toBeUndefined();
    expect(draggableStoryId(row({ nodetype: 'story', itemId: 'example-button--docs' }), api)).toBeUndefined();
  });

  it('rejects canvases, by id or by tag', () => {
    expect(draggableStoryId(row({ nodetype: 'story', itemId: 'colab-canvas-board--canvas' }), api)).toBeUndefined();
    expect(draggableStoryId(row({ nodetype: 'story', itemId: 'odd-canvas--story' }), api)).toBeUndefined();
  });

  it('rejects stories of composed Storybooks and unknown ids', () => {
    expect(
      draggableStoryId(row({ nodetype: 'story', itemId: 'example-button--primary', refId: 'design-system' }), api),
    ).toBeUndefined();
    expect(draggableStoryId(row({ nodetype: 'story', itemId: 'missing--story' }), api)).toBeUndefined();
    const throwing = {
      getData: () => {
        throw new Error('no index yet');
      },
    };
    expect(draggableStoryId(row({ nodetype: 'story', itemId: 'example-button--primary' }), throwing)).toBeUndefined();
  });
});

/**
 * A small stand-in DOM for `installSidebarDrag`: elements with a tag, attributes, a dataset and a
 * parent, and a document that records listeners. Only what the module uses is implemented.
 */
class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly dataset: Record<string, string>;
  constructor(
    readonly tag: string,
    readonly parent: FakeElement | null = null,
    options: { role?: string; dataset?: Record<string, string>; href?: string } = {},
  ) {
    this.dataset = options.dataset ?? {};
    if (options.role) this.attributes.set('role', options.role);
    if (options.href) this.attributes.set('href', options.href);
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, value);
  }
  hasAttribute(name: string) {
    return this.attributes.has(name);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  private matches(selector: string): boolean {
    if (selector === '[role="row"][data-item-id]') {
      return this.getAttribute('role') === 'row' && 'itemId' in this.dataset;
    }
    // The nested-control selector.
    const role = this.getAttribute('role');
    return (
      ['button', 'input', 'select', 'textarea'].includes(this.tag) ||
      (this.tag === 'a' && this.hasAttribute('href')) ||
      role === 'button' ||
      role === 'menuitem'
    );
  }
  closest(selector: string): FakeElement | null {
    if (this.matches(selector)) return this;
    return this.parent?.closest(selector) ?? null;
  }
  contains(other: FakeElement | null): boolean {
    for (let node = other; node; node = node.parent) if (node === this) return true;
    return false;
  }
}

type Listener = (event: Record<string, unknown>) => void;

function fakeDocument(rows: FakeElement[]) {
  const listeners = new Map<string, Set<Listener>>();
  return {
    rows,
    listeners,
    body: {},
    addEventListener: (type: string, listener: Listener, capture: boolean) => {
      expect(capture).toBe(true);
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener: (type: string, listener: Listener) => listeners.get(type)?.delete(listener),
    querySelectorAll: (selector: string) =>
      selector === `[${DRAGGABLE_MARK}]`
        ? rows.filter((row) => row.hasAttribute(DRAGGABLE_MARK))
        : rows.filter((row) => row.dataset.nodetype === 'story'),
  };
}

describe('installSidebarDrag', () => {
  const storyRow = () =>
    new FakeElement('div', null, { role: 'row', dataset: { nodetype: 'story', itemId: 'example-button--primary' } });
  const otherRow = () =>
    new FakeElement('div', null, { role: 'row', dataset: { nodetype: 'story', itemId: 'example-button--docs' } });
  const componentRow = () =>
    new FakeElement('div', null, { role: 'row', dataset: { nodetype: 'component', itemId: 'example-button' } });

  let observers: { callback: () => void; disconnected: boolean }[];
  let frames: Map<number, () => void>;
  let cancelled: number[];

  beforeEach(() => {
    observers = [];
    frames = new Map();
    cancelled = [];
    vi.stubGlobal('Element', FakeElement);
    vi.stubGlobal(
      'MutationObserver',
      class {
        private readonly record: { callback: () => void; disconnected: boolean };
        constructor(callback: () => void) {
          this.record = { callback, disconnected: false };
          observers.push(this.record);
        }
        observe() {}
        disconnect() {
          this.record.disconnected = true;
        }
      },
    );
    let nextFrame = 0;
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {
      nextFrame += 1;
      frames.set(nextFrame, callback);
      return nextFrame;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      cancelled.push(id);
      frames.delete(id);
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  function install(rows: FakeElement[]) {
    const doc = fakeDocument(rows);
    const selectStory = vi.fn();
    const uninstall = installSidebarDrag({ selectStory, getData: (id) => entries[id] }, doc as unknown as Document);
    const fire = (type: string, target: FakeElement | null, init: Record<string, unknown> = {}) => {
      const event = { type, target, button: 0, stopPropagation: vi.fn(), ...init };
      doc.listeners.get(type)?.forEach((listener) => listener(event));
      return event as typeof event & { stopPropagation: ReturnType<typeof vi.fn> };
    };
    const press = (target: FakeElement, init: Record<string, unknown> = {}) => [
      fire('pointerdown', target, { pointerType: 'mouse', ...init }),
      fire('mousedown', target, init),
    ];
    const dataTransfer = () => {
      const data = new Map<string, string>();
      return { data, effectAllowed: '', setData: (type: string, value: string) => data.set(type, value) };
    };
    return { doc, selectStory, uninstall, fire, press, dataTransfer };
  }

  it('marks story rows draggable, also rows that appear later, and not other rows', () => {
    const story = storyRow();
    const docs = otherRow();
    const { doc } = install([story, docs, componentRow()]);
    expect(story.getAttribute('draggable')).toBe('true');
    expect(story.hasAttribute(DRAGGABLE_MARK)).toBe(true);
    expect(docs.hasAttribute('draggable')).toBe(false);

    // The sidebar re-renders: several mutations make one scan on the next frame.
    const late = new FakeElement('div', null, {
      role: 'row',
      dataset: { nodetype: 'story', itemId: 'example-button--primary' },
    });
    doc.rows.push(late);
    observers[0]!.callback();
    observers[0]!.callback();
    expect(frames.size).toBe(1);
    [...frames.values()][0]!();
    expect(late.getAttribute('draggable')).toBe('true');
  });

  it('press then click on a story row navigates once, and keeps the press from the tree', () => {
    const row = storyRow();
    const label = new FakeElement('span', row);
    const { press, fire, selectStory } = install([row]);
    const [pointerdown, mousedown] = press(label);
    expect(pointerdown!.stopPropagation).toHaveBeenCalled();
    expect(mousedown!.stopPropagation).toHaveBeenCalled();
    expect(selectStory).not.toHaveBeenCalled();
    fire('click', label);
    expect(selectStory).toHaveBeenCalledTimes(1);
    expect(selectStory).toHaveBeenCalledWith('example-button--primary');
    // A second click without a new press (a synthetic or keyboard click) is left to Storybook.
    fire('click', label);
    expect(selectStory).toHaveBeenCalledTimes(1);
  });

  it('press then drag carries the story id and does not navigate', () => {
    const row = storyRow();
    const { press, fire, selectStory, dataTransfer } = install([row]);
    press(row);
    const transfer = dataTransfer();
    fire('dragstart', row, { dataTransfer: transfer });
    expect(transfer.data.get(STORY_DRAG_TYPE)).toBe('example-button--primary');
    expect(transfer.data.get('text/plain')).toBe('example-button--primary');
    expect(transfer.effectAllowed).toBe('copy');
    // Some browsers send a click after a cancelled drag; it must not navigate.
    fire('click', row);
    fire('dragend', row);
    expect(selectStory).not.toHaveBeenCalled();

    // The drag is over: the next press and click navigate again.
    press(row);
    fire('click', row);
    expect(selectStory).toHaveBeenCalledTimes(1);
  });

  it('a press released on another row does not navigate', () => {
    const first = storyRow();
    const second = new FakeElement('div', null, {
      role: 'row',
      dataset: { nodetype: 'story', itemId: 'example-button--primary' },
    });
    const { press, fire, selectStory } = install([first, second]);
    press(first);
    fire('click', second);
    expect(selectStory).not.toHaveBeenCalled();
  });

  it('leaves alone: other buttons, modifier presses, touch, nested controls and non-story rows', () => {
    const row = storyRow();
    const menuButton = new FakeElement('button', row);
    const component = componentRow();
    const { press, fire, selectStory } = install([row, component]);

    const cases: [FakeElement, Record<string, unknown>][] = [
      [row, { button: 1 }],
      [row, { metaKey: true }],
      [row, { ctrlKey: true }],
      [row, { shiftKey: true }],
      [row, { altKey: true }],
      [row, { pointerType: 'touch' }],
      [menuButton, {}],
      [component, {}],
    ];
    for (const [target, init] of cases) {
      const [pointerdown] = press(target, init);
      expect(pointerdown!.stopPropagation, JSON.stringify(init)).not.toHaveBeenCalled();
      fire('click', target, init);
    }
    expect(selectStory).not.toHaveBeenCalled();

    // A press on the row followed by a click on its menu button is the button's click.
    press(row);
    fire('click', menuButton);
    expect(selectStory).not.toHaveBeenCalled();
  });

  it('does not start a drag for rows that are not stories, or without a data transfer', () => {
    const component = componentRow();
    const row = storyRow();
    const { fire, dataTransfer } = install([row, component]);
    const transfer = dataTransfer();
    fire('dragstart', component, { dataTransfer: transfer });
    expect(transfer.data.size).toBe(0);
    expect(() => fire('dragstart', row, { dataTransfer: null })).not.toThrow();
    expect(() => fire('dragstart', null)).not.toThrow();
  });

  it('uninstall removes every listener, the observer, a pending scan and the row marks', () => {
    const row = storyRow();
    const { doc, uninstall, press, fire, selectStory } = install([row]);
    expect([...doc.listeners.keys()].sort()).toEqual(['click', 'dragend', 'dragstart', 'mousedown', 'pointerdown']);
    observers[0]!.callback();
    expect(frames.size).toBe(1);

    uninstall();
    expect([...doc.listeners.values()].every((set) => set.size === 0)).toBe(true);
    expect(observers[0]!.disconnected).toBe(true);
    expect(cancelled).toHaveLength(1);
    expect(frames.size).toBe(0);
    expect(row.hasAttribute('draggable')).toBe(false);
    expect(row.hasAttribute(DRAGGABLE_MARK)).toBe(false);

    const [pointerdown] = press(row);
    fire('click', row);
    expect(pointerdown!.stopPropagation).not.toHaveBeenCalled();
    expect(selectStory).not.toHaveBeenCalled();
  });
});
