/**
 * Element targets for comments: which DOM node of a story a comment is about, described so that a
 * coding agent knows exactly what the user meant (`ElementTarget` in `src/canvas-file.ts`).
 *
 * The selector is relative to the story root (the element the story renders into) and must match
 * exactly one element there. It is chosen in this order, taking the first that is unique:
 * 1. a test id (`data-testid`, `data-test-id`, `data-test`, `data-cy`, `data-qa`);
 * 2. a stable `id` (not a generated one such as React's `:r1:`);
 * 3. role and accessible name when the name comes from an attribute (`aria-label`, `alt`,
 *    `placeholder`, `title`, `name`, `for`, a short `href`), with the tag or role;
 * 4. the tag with one or two stable class names (never CSS-in-JS or CSS-module hashes, never state
 *    classes such as `active`);
 * 5. the tag alone;
 * 6. any of the above for the nearest ancestor that has one, plus a short path down to the element;
 * 7. a structural path (`tag:nth-of-type(n)` steps), as short as it can be while unique, anchored
 *    at the root with `:scope >` only when it has to be.
 *
 * Role, accessible name, text and (for look-alikes in repeated rows) the row's text are stored next
 * to the selector. `resolveTarget` only accepts an element that shows it is the same one; when the
 * selector's element does not, it searches the story for the one that does, and otherwise the pin
 * falls back to its frame and is shown as detached. A wrong element is worse than a detached pin.
 *
 * Works on any DOM (the preview page, or happy-dom in tests). No React.
 */
import type { ElementTarget } from '../canvas-file';

/** Story facts for a target. */
export interface TargetStory {
  storyId: string;
  title: string;
  importPath: string;
}

export const TEST_ID_ATTRIBUTES = ['data-testid', 'data-test-id', 'data-test', 'data-cy', 'data-qa'] as const;

/** Attributes that name an element, in order of preference (they also make good selectors). */
const NAMING_ATTRIBUTES = ['aria-label', 'name', 'alt', 'placeholder', 'title', 'for'] as const;

const MAX_TEXT = 2000;
const MAX_NAME = 200;
const MAX_ATTRIBUTE_VALUE = 120;

// ---------------------------------------------------------------------------------------------
// Escaping

/** `CSS.escape`, with a fallback for environments without it. */
export function cssEscape(value: string): string {
  const css = (globalThis as { CSS?: { escape?: (value: string) => string } }).CSS;
  if (css?.escape) return css.escape(value);
  let result = '';
  for (let index = 0; index < value.length; index += 1) {
    const char = value.charAt(index);
    const code = value.charCodeAt(index);
    if (code === 0) result += '�';
    else if ((code >= 0x1 && code <= 0x1f) || code === 0x7f) result += `\\${code.toString(16)} `;
    else if (index === 0 && /[0-9]/.test(char)) result += `\\${code.toString(16)} `;
    else if (index === 1 && /[0-9]/.test(char) && value[0] === '-') result += `\\${code.toString(16)} `;
    else if (index === 0 && char === '-' && value.length === 1) result += `\\${char}`;
    else if (/[\w-]/.test(char) || code >= 0x80) result += char;
    else result += `\\${char}`;
  }
  return result;
}

/** A quoted CSS string (single quotes when the value has double quotes but no single ones). */
function quote(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/\n/g, '\\a ');
  if (escaped.includes('"') && !escaped.includes("'")) return `'${escaped}'`;
  return `"${escaped.replace(/"/g, '\\"')}"`;
}

function attributeSelector(name: string, value: string): string {
  return `[${name}=${quote(value)}]`;
}

// ---------------------------------------------------------------------------------------------
// What counts as stable

/** A word-ish token of 5+ characters that mixes letters and digits: looks like a hash. */
function hasHashToken(value: string): boolean {
  return value.split(/[-_]+/).some((token) => token.length >= 5 && /\d/.test(token) && /[a-z]/i.test(token));
}

const GENERATED_CLASS_PREFIX = /^(css|sc|jsx|emotion|styled|svelte|astro|chakra-ui|mui-[a-z]+)-/i;
const STATE_CLASS =
  /^(is-|has-)|^(active|focus|focused|focus-visible|hover|hovered|selected|open|opened|closed|disabled|checked|visible|hidden|expanded|collapsed|current|pressed|loading)$/i;

/** Whether a class name is generated (CSS-in-JS, CSS modules) or a passing state, so a bad selector. */
export function isGeneratedClass(name: string): boolean {
  if (!/^-?[_a-zA-Z][\w-]*$/.test(name)) return true; // Tailwind `md:px-4`, `w-[3px]`: valid but fragile.
  if (GENERATED_CLASS_PREFIX.test(name)) return true;
  if (/__[a-z0-9]{4,}$/i.test(name) && hasHashToken(name.split('__').pop() ?? '')) return true; // Button_root__a1b2c
  if (/^_[a-z0-9]{5,}/i.test(name)) return true; // _a1b2c_ (Vite CSS modules)
  if (hasHashToken(name)) return true;
  return STATE_CLASS.test(name);
}

const GENERATED_ID = /^(:r|«r|radix-|react-aria|headlessui-|mui-|downshift-|rc-|tippy-|popper-|ember\d|ext-gen)/i;

/** Whether an id is generated (React `useId`, UI libraries) rather than written by hand. */
export function isGeneratedId(id: string): boolean {
  if (!id.trim()) return true;
  if (GENERATED_ID.test(id)) return true;
  if (/^[\d-]+$/.test(id)) return true;
  if (/\d{3,}/.test(id)) return true;
  return hasHashToken(id);
}

// ---------------------------------------------------------------------------------------------
// Role and accessible name (a practical subset of the ARIA rules)

function inputRole(input: Element): string | undefined {
  const type = (input.getAttribute('type') ?? 'text').toLowerCase();
  switch (type) {
    case 'button':
    case 'submit':
    case 'reset':
    case 'image':
      return 'button';
    case 'checkbox':
      return 'checkbox';
    case 'radio':
      return 'radio';
    case 'range':
      return 'slider';
    case 'number':
      return 'spinbutton';
    case 'search':
      return 'searchbox';
    case 'hidden':
      return undefined;
    default:
      return input.hasAttribute('list') ? 'combobox' : 'textbox';
  }
}

/** The element's explicit role, or the implicit role of its tag. */
export function roleOf(element: Element): string | undefined {
  const explicit = element.getAttribute('role')?.trim().split(/\s+/)[0];
  if (explicit) return explicit;
  const tag = element.tagName.toLowerCase();
  switch (tag) {
    case 'button':
      return 'button';
    case 'a':
    case 'area':
      return element.hasAttribute('href') ? 'link' : undefined;
    case 'input':
      return inputRole(element);
    case 'textarea':
      return 'textbox';
    case 'select':
      return element.hasAttribute('multiple') || Number(element.getAttribute('size')) > 1 ? 'listbox' : 'combobox';
    case 'option':
      return 'option';
    case 'img':
      return element.getAttribute('alt') === '' ? 'presentation' : 'img';
    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6':
      return 'heading';
    case 'nav':
      return 'navigation';
    case 'main':
      return 'main';
    case 'header':
      return element.closest('article, aside, main, nav, section') ? undefined : 'banner';
    case 'footer':
      return element.closest('article, aside, main, nav, section') ? undefined : 'contentinfo';
    case 'aside':
      return 'complementary';
    case 'form':
      return 'form';
    case 'ul':
    case 'ol':
      return 'list';
    case 'li':
      return 'listitem';
    case 'table':
      return 'table';
    case 'tr':
      return 'row';
    case 'td':
      return 'cell';
    case 'th':
      return 'columnheader';
    case 'dialog':
      return 'dialog';
    case 'progress':
      return 'progressbar';
    case 'hr':
      return 'separator';
    case 'article':
      return 'article';
    case 'section':
      return element.hasAttribute('aria-label') || element.hasAttribute('aria-labelledby') ? 'region' : undefined;
    case 'p':
      return 'paragraph';
    default:
      return undefined;
  }
}

/** Roles whose accessible name comes from their content. */
const NAME_FROM_CONTENT = new Set([
  'button',
  'link',
  'heading',
  'menuitem',
  'menuitemcheckbox',
  'menuitemradio',
  'tab',
  'option',
  'checkbox',
  'radio',
  'switch',
  'treeitem',
  'cell',
  'columnheader',
  'rowheader',
  'tooltip',
]);

/** Text content with whitespace collapsed. */
export function collapsedText(element: Element | null | undefined): string {
  return (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function labelFor(element: Element): string | undefined {
  const doc = element.ownerDocument;
  const id = element.getAttribute('id');
  if (id) {
    const label = doc.querySelector(`label[for=${quote(id)}]`);
    if (label) return collapsedText(label) || undefined;
  }
  const wrapping = element.closest('label');
  if (wrapping) return collapsedText(wrapping) || undefined;
  return undefined;
}

/** The accessible name, when one can be worked out (aria-labelledby, aria-label, labels, alt, title, content). */
export function accessibleName(element: Element): string | undefined {
  const name = (() => {
    const labelledBy = element.getAttribute('aria-labelledby');
    if (labelledBy) {
      const text = labelledBy
        .split(/\s+/)
        .map((id) => collapsedText(element.ownerDocument.getElementById(id)))
        .filter(Boolean)
        .join(' ');
      if (text) return text;
    }
    const ariaLabel = element.getAttribute('aria-label')?.trim();
    if (ariaLabel) return ariaLabel;
    const tag = element.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') {
      const type = (element.getAttribute('type') ?? '').toLowerCase();
      if (tag === 'input' && ['button', 'submit', 'reset'].includes(type)) {
        return (
          element.getAttribute('value')?.trim() || (type === 'submit' ? 'Submit' : type === 'reset' ? 'Reset' : '')
        );
      }
      if (tag === 'input' && type === 'image') return element.getAttribute('alt')?.trim();
      return labelFor(element) ?? element.getAttribute('placeholder')?.trim() ?? element.getAttribute('title')?.trim();
    }
    if (tag === 'img' || tag === 'area')
      return element.getAttribute('alt')?.trim() || element.getAttribute('title')?.trim();
    const role = roleOf(element);
    if (role && NAME_FROM_CONTENT.has(role)) {
      const text = collapsedText(element);
      if (text) return text;
      // An icon-only button: the name of an image or svg inside it.
      const image = element.querySelector('img[alt], svg[aria-label], [role="img"][aria-label]');
      const fromImage = image?.getAttribute('alt') ?? image?.getAttribute('aria-label');
      if (fromImage?.trim()) return fromImage.trim();
    }
    if (tag === 'svg') return collapsedText(element.querySelector(':scope > title')) || undefined;
    return element.getAttribute('title')?.trim();
  })();
  return name ? clip(name, MAX_NAME) : undefined;
}

// ---------------------------------------------------------------------------------------------
// Selectors

function matchesExactly(root: Element, selector: string, element: Element): boolean {
  try {
    const matches = root.querySelectorAll(selector);
    return matches.length === 1 && matches[0] === element;
  } catch {
    return false;
  }
}

/** The one element `selector` matches inside `root`, or null when it matches none, several, or is invalid. */
export function queryUnique(root: Element, selector: string): Element | null {
  try {
    const matches = root.querySelectorAll(selector);
    return matches.length === 1 ? (matches[0] ?? null) : null;
  } catch {
    return null;
  }
}

function tagOf(element: Element): string {
  const tag = element.tagName.toLowerCase();
  // SVG and custom elements are fine as type selectors; escape anything odd.
  return /^[a-z][a-z0-9-]*$/.test(tag) ? tag : cssEscape(tag);
}

function stableClasses(element: Element): string[] {
  const value = element.getAttribute('class');
  if (!value) return [];
  return value
    .split(/\s+/)
    .filter(Boolean)
    .filter((name) => !isGeneratedClass(name));
}

/**
 * Selectors for the element on its own, best first. Not checked for uniqueness. The last one is
 * always the bare tag.
 */
export function ownSelectors(element: Element): string[] {
  const tag = tagOf(element);
  const candidates: string[] = [];
  for (const name of TEST_ID_ATTRIBUTES) {
    const value = element.getAttribute(name);
    if (value) candidates.push(attributeSelector(name, value));
  }
  const id = element.getAttribute('id');
  if (id && !isGeneratedId(id)) candidates.push(`#${cssEscape(id)}`);

  const role = element.getAttribute('role')?.trim();
  for (const name of NAMING_ATTRIBUTES) {
    const value = element.getAttribute(name);
    if (!value || value.length > MAX_ATTRIBUTE_VALUE) continue;
    if (name === 'for' && isGeneratedId(value)) continue;
    if (name === 'aria-label' && role)
      candidates.push(`${attributeSelector('role', role)}${attributeSelector(name, value)}`);
    candidates.push(`${tag}${attributeSelector(name, value)}`);
  }
  const href = element.getAttribute('href');
  if (href && href.length <= MAX_ATTRIBUTE_VALUE && !href.startsWith('javascript:')) {
    candidates.push(`${tag}${attributeSelector('href', href)}`);
  }
  if (role) candidates.push(`${tag}${attributeSelector('role', role)}`);
  const type = element.getAttribute('type');
  if (tag === 'input' && type) candidates.push(`${tag}${attributeSelector('type', type)}`);

  const classes = stableClasses(element);
  // Most specific first: later classes tend to be modifiers (`button--primary`).
  const ordered = [...classes].reverse();
  for (const name of ordered) candidates.push(`${tag}.${cssEscape(name)}`);
  for (let i = 0; i < ordered.length; i += 1) {
    for (let j = i + 1; j < ordered.length; j += 1) {
      candidates.push(`${tag}.${cssEscape(ordered[i] ?? '')}.${cssEscape(ordered[j] ?? '')}`);
    }
  }
  candidates.push(tag);
  return [...new Set(candidates)];
}

/** One structural step: the tag, with `:nth-of-type` when siblings share it. */
function structuralStep(element: Element): string {
  const tag = tagOf(element);
  const parent = element.parentElement;
  if (!parent) return tag;
  const same = [...parent.children].filter((child) => child.tagName === element.tagName);
  if (same.length === 1) return tag;
  return `${tag}:nth-of-type(${same.indexOf(element) + 1})`;
}

/** The best own selector that is unique within `root`, or undefined. */
function uniqueOwnSelector(element: Element, root: Element): string | undefined {
  return ownSelectors(element).find((selector) => matchesExactly(root, selector, element));
}

/**
 * A CSS selector, relative to `root`, that matches exactly `element` (see the module comment for
 * the order of preference). `element` must be inside `root` and not `root` itself.
 */
export function selectorFor(element: Element, root: Element): string {
  if (element === root || !root.contains(element)) throw new Error('The element is not inside the story root');

  const own = uniqueOwnSelector(element, root);
  if (own) return own;

  // An ancestor with a unique selector, then the element's own selectors or a path below it.
  const ownCandidates = ownSelectors(element);
  const pathFromAncestor: string[] = [];
  let child: Element = element;
  for (let ancestor = element.parentElement; ancestor && ancestor !== root; ancestor = ancestor.parentElement) {
    pathFromAncestor.unshift(structuralStep(child));
    child = ancestor;
    // A bare tag is no better an anchor than the structural path below.
    const anchor = uniqueOwnSelector(ancestor, root);
    if (!anchor || anchor === tagOf(ancestor)) continue;
    for (const candidate of ownCandidates) {
      const selector = `${anchor} ${candidate}`;
      if (matchesExactly(root, selector, element)) return selector;
    }
    const selector = `${anchor} > ${pathFromAncestor.join(' > ')}`;
    if (matchesExactly(root, selector, element)) return selector;
    break;
  }

  // A structural path, as short as possible.
  const steps: string[] = [];
  for (let node: Element | null = element; node && node !== root; node = node.parentElement) {
    steps.unshift(structuralStep(node));
    const selector = steps.join(' > ');
    if (matchesExactly(root, selector, element)) return selector;
  }
  return `:scope > ${steps.join(' > ')}`;
}

// ---------------------------------------------------------------------------------------------
// Picking the element the user means

const INTERACTIVE =
  'button, a[href], input, select, textarea, label, summary, [role="button"], [role="link"], [role="menuitem"], [role="tab"], [role="checkbox"], [role="radio"], [role="switch"], [role="option"]';

/**
 * The element a press on `hit` is about: the element itself, except that a press on the inside of
 * an icon (an svg's paths) means the svg, and a press on a non-interactive part of a button or link
 * (its label `<span>`, its icon) means the button or link. With `exact`, the hit element itself.
 * Returns null when the press is on the story root itself (or outside it).
 */
export function pickTarget(hit: Element, root: Element, { exact = false } = {}): Element | null {
  if (hit === root || !root.contains(hit)) return null;
  if (exact) return hit;
  let element: Element = hit;
  // Inside an svg: the outermost svg (still inside the root).
  const svg = element.closest('svg');
  if (svg && root.contains(svg) && svg !== root) {
    let outer: Element = svg;
    for (let up = svg.parentElement?.closest('svg'); up && root.contains(up); up = up.parentElement?.closest('svg')) {
      outer = up;
    }
    element = outer;
  }
  const interactive = element.closest(INTERACTIVE);
  if (interactive && interactive !== root && root.contains(interactive) && !element.matches(INTERACTIVE)) {
    return interactive;
  }
  return element;
}

// ---------------------------------------------------------------------------------------------
// Snippets

/** A short HTML snippet of the element: its outer HTML, cut down to fit the contract's 2000 chars. */
export function htmlSnippet(element: Element, max = MAX_TEXT): string {
  const html = element.outerHTML;
  if (html.length <= max) return html;
  const tag = element.tagName.toLowerCase();
  const open = html.slice(0, html.indexOf('>') + 1);
  const close = `</${tag}>`;
  if (open.length + close.length + 1 >= max) return `${open.slice(0, max - 2)}…>`.slice(0, max);
  const room = max - open.length - close.length - 1;
  return `${open}${element.innerHTML.slice(0, room)}…${close}`;
}

// ---------------------------------------------------------------------------------------------
// Identity: is this the same element?

/** What a target stores about an element's identity (the rest of `ElementTarget` is about its story). */
export type TargetIdentity = Pick<ElementTarget, 'selector' | 'html' | 'text' | 'role' | 'name' | 'context'>;

const MAX_CONTEXT = 300;

/** The tag of an HTML snippet's root element (`<button class…>` → `button`). */
function snippetTag(html: string): string | undefined {
  return /^<([a-zA-Z][\w:-]*)/.exec(html)?.[1]?.toLowerCase();
}

/** The opening tag of an HTML snippet. */
function openingTag(html: string): string {
  const end = html.indexOf('>');
  return end === -1 ? html : html.slice(0, end + 1);
}

/**
 * Whether `element` has the stored identity: the same role, and the same accessible name; without
 * a name, the same tag and text; without text either, the same opening tag. The repeat context is
 * not part of this (see `repeatContext`).
 */
export function hasIdentity(element: Element, target: Omit<TargetIdentity, 'selector'>): boolean {
  if (target.role && roleOf(element) !== target.role) return false;
  if (target.name) return accessibleName(element) === target.name;
  const tag = snippetTag(target.html);
  if (tag && element.tagName.toLowerCase() !== tag) return false;
  if (target.text) return clip(collapsedText(element), MAX_TEXT) === target.text;
  return openingTag(element.outerHTML) === openingTag(target.html);
}

/** Text content with a space between text nodes (`<span>Row C</span><button>Delete</button>` → `Row C Delete`). */
function spacedText(element: Element): string {
  const parts: string[] = [];
  const walker = element.ownerDocument.createTreeWalker(element, 4 /* NodeFilter.SHOW_TEXT */);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) parts.push(node.nodeValue ?? '');
  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Text that tells an element in a repeated row or list item apart from its look-alikes (the
 * "Delete" button of each row): the text of the nearest ancestor that has a sibling with the same
 * tag (the row, list item or card) and says more than the element itself.
 */
export function repeatContext(element: Element, root: Element): string | undefined {
  const own = spacedText(element);
  for (let ancestor = element.parentElement; ancestor && ancestor !== root; ancestor = ancestor.parentElement) {
    const parent = ancestor.parentElement;
    if (!parent) break;
    const repeated = [...parent.children].some((child) => child !== ancestor && child.tagName === ancestor.tagName);
    if (!repeated) continue;
    const text = spacedText(ancestor);
    if (text && text !== own) return clip(text, MAX_CONTEXT);
  }
  return undefined;
}

function elementsWithIdentity(root: Element, target: Omit<TargetIdentity, 'selector'>): Element[] {
  return [...root.querySelectorAll('*')].filter((element) => hasIdentity(element, target));
}

const TEST_ID_SELECTOR = new RegExp(
  `^\\[(?:${TEST_ID_ATTRIBUTES.join('|')})=(?:"(?:[^"\\\\]|\\\\.)*"|'(?:[^'\\\\]|\\\\.)*')\\]$`,
);
const ID_SELECTOR = /^#(?:[\w\u0080-\uffff-]|\\[0-9a-f]{1,6} ?|\\.)+$/i;

/** Whether a selector is a test id or a hand-written id on its own: it names one element on purpose. */
export function isIdentitySelector(selector: string): boolean {
  return TEST_ID_SELECTOR.test(selector) || ID_SELECTOR.test(selector);
}

// ---------------------------------------------------------------------------------------------
// Describing and finding again

/**
 * Everything a comment stores about an element (`ElementTarget`). When other elements in the story
 * look the same (same role, name or text, like each row's "Delete"), `context` holds the text of
 * its row so it can be told apart later.
 */
export function describeElement(element: Element, root: Element, story: TargetStory): ElementTarget {
  const target: ElementTarget = {
    storyId: story.storyId,
    title: story.title,
    importPath: story.importPath,
    selector: selectorFor(element, root),
    html: htmlSnippet(element),
    text: clip(collapsedText(element), MAX_TEXT),
  };
  const role = roleOf(element);
  if (role) target.role = role;
  const name = accessibleName(element);
  if (name) target.name = name;
  if (elementsWithIdentity(root, target).length > 1) {
    const context = repeatContext(element, root);
    if (context) target.context = context;
  }
  return target;
}

export type ResolvedTarget =
  | { kind: 'found'; element: Element; by: 'selector' | 'id' | 'search' }
  | { kind: 'detached' };

/**
 * Finds a target's element in the story root again. A wrong element is worse than none, so the
 * element must show it is the same one:
 * - it has the stored identity (`hasIdentity`: role and name, else tag and text);
 * - when other elements share that identity, it is in the stored row (`context`); without a stored
 *   context, the selector's position is all there is to go on.
 *
 * Order:
 * 1. the selector's element, when it passes those checks;
 * 2. a test-id or hand-written-id selector's element even when its name or text changed (the
 *    author named that element, so a renamed button is still the one the comment is about);
 * 3. the one element in the story that passes the checks (the markup changed, or a list was
 *    reordered and the selector's position now holds a different row), when the target has a
 *    name or text to look for;
 * otherwise detached: the pin falls back to its frame. So a class or structural selector does not
 * follow a rename ("Log in" edited to "Sign in" detaches), and "Log in" never moves onto the
 * "Log out" button that replaced it.
 */
export function resolveTarget(root: Element, target: TargetIdentity): ResolvedTarget {
  const bySelector = queryUnique(root, target.selector);
  const lookAlikes = elementsWithIdentity(root, target);
  const inRow = (element: Element) =>
    target.context === undefined || lookAlikes.length <= 1 || repeatContext(element, root) === target.context;

  if (bySelector && lookAlikes.includes(bySelector) && inRow(bySelector)) {
    return { kind: 'found', element: bySelector, by: 'selector' };
  }
  if (bySelector && isIdentitySelector(target.selector)) return { kind: 'found', element: bySelector, by: 'id' };

  // With neither a name nor text, look-alikes elsewhere are no evidence: only the selector's position counts.
  if (!target.name && !target.text) return { kind: 'detached' };
  const candidates = target.context === undefined ? lookAlikes : lookAlikes.filter(inRow);
  const [only] = candidates;
  if (only && candidates.length === 1) return { kind: 'found', element: only, by: 'search' };
  return { kind: 'detached' };
}
