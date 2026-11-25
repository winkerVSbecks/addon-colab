// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from 'vitest';

import { elementTargetSchema } from '../canvas-file';
import {
  accessibleName,
  describeElement,
  htmlSnippet,
  isGeneratedClass,
  isGeneratedId,
  pickTarget,
  queryUnique,
  resolveTarget,
  roleOf,
  selectorFor,
} from './element-target';

/** A story root (like the board's `[data-colab-story-root]`) holding `html`, with a twin next to it. */
function story(html: string): HTMLElement {
  document.body.innerHTML = `<div data-colab-story-root="a">${html}</div><div data-colab-story-root="b">${html}</div>`;
  return document.querySelector('[data-colab-story-root="a"]') as HTMLElement;
}

function q(root: Element, selector: string): Element {
  const element = root.querySelector(selector);
  if (!element) throw new Error(`no ${selector}`);
  return element;
}

/** The selector for `element`, checked to match exactly that element inside `root`. */
function select(root: Element, element: Element): string {
  const selector = selectorFor(element, root);
  expect(queryUnique(root, selector)).toBe(element);
  return selector;
}

// The Header story's markup as rendered (src/stories/Header.tsx, logged out).
const HEADER = `
<header>
  <div class="storybook-header">
    <div>
      <svg width="32" height="32" viewBox="0 0 32 32"><g fill="none"><path d="M10 0h12"></path><path d="M5 10"></path></g></svg>
      <h1>Acme</h1>
    </div>
    <div>
      <button type="button" class="storybook-button storybook-button--small storybook-button--secondary">Log in</button>
      <button type="button" class="storybook-button storybook-button--small storybook-button--primary">Sign up</button>
    </div>
  </div>
</header>`;

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('selectorFor: order of preference', () => {
  it('prefers a test id over an id, attributes and classes', () => {
    const root = story(`<button data-testid="save" id="save-button" aria-label="Save" class="btn">Save</button>`);
    expect(select(root, q(root, 'button'))).toBe('[data-testid="save"]');
  });

  it('accepts the other common test id attributes', () => {
    for (const attribute of ['data-test-id', 'data-test', 'data-cy', 'data-qa']) {
      const root = story(`<div><span ${attribute}="total">1</span><span>2</span></div>`);
      expect(select(root, q(root, `[${attribute}]`))).toBe(`[${attribute}="total"]`);
    }
  });

  it('uses a hand-written id, but never a generated one', () => {
    let root = story(`<div><input id="email"><input id="name"></div>`);
    expect(select(root, q(root, '#email'))).toBe('#email');
    root = story(`<div><input id=":r1:" name="email"><input id=":r2:" name="name"></div>`);
    expect(select(root, q(root, '[name="email"]'))).toBe('input[name="email"]');
    root = story(`<div><div id="radix-12"><b>x</b></div><div id="radix-13"><b>y</b></div></div>`);
    expect(select(root, q(root, '#radix-13'))).not.toContain('radix');
  });

  it('uses role and accessible name when the name is an attribute', () => {
    const root = story(
      `<div role="toolbar"><div role="button" aria-label="Bold">B</div><div role="button" aria-label="Italic">I</div></div>`,
    );
    expect(select(root, q(root, '[aria-label="Italic"]'))).toBe('[role="button"][aria-label="Italic"]');
    const images = story(`<img alt="Logo" src="a.png"><img alt="Avatar" src="b.png">`);
    expect(select(images, q(images, '[alt="Avatar"]'))).toBe('img[alt="Avatar"]');
    const fields = story(`<input placeholder="Search"><input placeholder="Filter">`);
    expect(select(fields, q(fields, '[placeholder="Filter"]'))).toBe('input[placeholder="Filter"]');
    const links = story(`<a href="/docs">Docs</a><a href="/blog">Blog</a>`);
    expect(select(links, q(links, '[href="/blog"]'))).toBe('a[href="/blog"]');
  });

  it("picks the Header story's Log in button by its stable class, not its position", () => {
    const root = story(HEADER);
    const logIn = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Log in') as Element;
    const signUp = [...root.querySelectorAll('button')].find((b) => b.textContent === 'Sign up') as Element;
    expect(select(root, logIn)).toBe('button.storybook-button--secondary');
    expect(select(root, signUp)).toBe('button.storybook-button--primary');
    expect(select(root, q(root, 'h1'))).toBe('h1');
  });

  it('never uses CSS-in-JS or CSS-module hashes when a stable alternative exists', () => {
    const root = story(`
      <div class="css-1x2y3zq card"><span class="css-9a8b7c">A</span></div>
      <div class="css-4k5l6mq card card--wide"><span class="Title_title__a1b2c">B</span></div>`);
    const wide = q(root, '.card--wide');
    expect(select(root, wide)).toBe('div.card--wide');
    const title = q(root, '.card--wide span');
    const selector = select(root, title);
    expect(selector).not.toMatch(/css-|__a1b2c/);
    expect(selector).toBe('div.card--wide span');
  });

  it('never uses state classes, which change as the user interacts', () => {
    const root = story(`<ul><li class="item active">A</li><li class="item">B</li></ul>`);
    expect(select(root, q(root, '.active'))).toBe('li:nth-of-type(1)');
  });

  it('goes through the nearest ancestor with a unique selector, then a short path', () => {
    const root = story(`
      <nav data-testid="main-nav"><a>Home</a><a>About</a></nav>
      <nav data-testid="footer-nav"><a>Home</a><a>About</a></nav>`);
    const about = root.querySelectorAll('[data-testid="footer-nav"] a')[1] as Element;
    expect(select(root, about)).toBe('[data-testid="footer-nav"] > a:nth-of-type(2)');
  });

  it('falls back to a structural path, anchored at the story root only when it has to be', () => {
    const root = story(`<ul><li>one</li><li>two</li><li>three</li></ul>`);
    expect(select(root, root.querySelectorAll('li')[2] as Element)).toBe('li:nth-of-type(3)');
    const nested = story(`<div><p>top</p></div><section><div><p>deep</p></div></section>`);
    expect(select(nested, q(nested, ':scope > div > p'))).toBe(':scope > div > p');
  });

  it('is unique within its own story root even when another story has the same markup', () => {
    const root = story(HEADER);
    const twin = document.querySelector('[data-colab-story-root="b"]') as Element;
    const selector = select(root, q(root, 'h1'));
    expect(document.querySelectorAll(selector).length).toBe(2);
    expect(queryUnique(twin, selector)).toBe(q(twin, 'h1'));
  });

  it('escapes ids, attribute values and class names', () => {
    const root = story(
      `<div><span id="price.total">1</span><span aria-label='Say "hi"' role="note">2</span><i class="icon:big">3</i><i>4</i></div>`,
    );
    expect(select(root, root.querySelector('span') as Element)).toBe('#price\\.total');
    expect(select(root, q(root, '[role="note"]'))).toBe(`[role="note"][aria-label='Say "hi"']`);
    // `icon:big` is a valid but fragile class (Tailwind-style): left out.
    expect(select(root, root.querySelectorAll('i')[0] as Element)).toBe('i:nth-of-type(1)');
  });

  it('matches exactly the element for every element of a larger story', () => {
    const items = Array.from(
      { length: 6 },
      (_, i) =>
        `<li class="row ${i % 2 ? 'odd' : 'even'}"><span>Item</span><button class="css-abc123">Edit</button></li>`,
    ).join('');
    const root = story(`
      ${HEADER}
      <main><section aria-label="List"><ul>${items}</ul></section>
      <form><label for="q">Query</label><input id="q"><label>Agree <input type="checkbox"></label><button type="submit">Go</button></form>
      <table><tr><td>a</td><td>b</td></tr><tr><td>c</td><td>d</td></tr></table></main>`);
    const all = [...root.querySelectorAll('*')];
    expect(all.length).toBeGreaterThan(40);
    for (const element of all) select(root, element);
  });

  it('refuses the story root itself or elements outside it', () => {
    const root = story(`<p>x</p>`);
    expect(() => selectorFor(root, root)).toThrow();
    const twin = document.querySelector('[data-colab-story-root="b"] p') as Element;
    expect(() => selectorFor(twin, root)).toThrow();
  });
});

describe('generated names', () => {
  it.each([
    'css-1x2y3z',
    'sc-bdVaJa',
    'jsx-123456',
    'emotion-0',
    'Button_root__a1b2c',
    '_a1b2c_3',
    'svelte-xyz123',
    'btn-a8f3k2',
    'md:px-4',
    'w-[3px]',
    'active',
    'is-open',
  ])('class %s is generated or a state', (name) => expect(isGeneratedClass(name)).toBe(true));
  it.each(['storybook-button', 'storybook-button--primary', 'card', 'px-4', 'h-10', 'col-12', 'Header', 'nav__item'])(
    'class %s is stable',
    (name) => expect(isGeneratedClass(name)).toBe(false),
  );
  it.each([
    ':r1:',
    '«r2»',
    'radix-:r3:',
    'react-aria123-4',
    'headlessui-menu-button-1',
    'mui-42',
    '12345',
    'field-9f8e7d6',
    'item-2024',
  ])('id %s is generated', (id) => expect(isGeneratedId(id)).toBe(true));
  it.each(['email', 'main-nav', 'price.total', 'step-2'])('id %s is stable', (id) =>
    expect(isGeneratedId(id)).toBe(false),
  );
});

describe('role and accessible name', () => {
  it('reads implicit roles', () => {
    const root = story(
      `<button>a</button><a href="/x">b</a><a>c</a><input><input type="checkbox"><h2>d</h2><nav></nav><img alt="e"><img alt="">`,
    );
    const roles = [...root.children].map((element) => roleOf(element) ?? null);
    expect(roles).toEqual([
      'button',
      'link',
      null,
      'textbox',
      'checkbox',
      'heading',
      'navigation',
      'img',
      'presentation',
    ]);
    expect(roleOf(q(story(`<div role="tab button">x</div>`), 'div'))).toBe('tab');
  });

  it('names from content, labels, aria and images', () => {
    const root = story(`
      <button> Log
        in </button>
      <label for="mail">E-mail</label><input id="mail">
      <label>Remember me <input type="checkbox" class="remember"></label>
      <span id="t">Total</span><output aria-labelledby="t">3</output>
      <button class="icon"><svg aria-label="Close"></svg></button>
      <input placeholder="Search" class="search">
      <div>Plain</div>`);
    expect(accessibleName(q(root, 'button'))).toBe('Log in');
    expect(accessibleName(q(root, '#mail'))).toBe('E-mail');
    expect(accessibleName(q(root, '.remember'))).toBe('Remember me');
    expect(accessibleName(q(root, 'output'))).toBe('Total');
    expect(accessibleName(q(root, '.icon'))).toBe('Close');
    expect(accessibleName(q(root, '.search'))).toBe('Search');
    expect(accessibleName(q(root, 'div'))).toBeUndefined();
  });
});

describe('pickTarget', () => {
  it('means the button when the press is on its label or icon', () => {
    const root = story(`<button><svg><path d="M0"></path></svg><span>Save</span></button><a href="/"><b>Home</b></a>`);
    expect(pickTarget(q(root, 'path'), root)).toBe(q(root, 'button'));
    expect(pickTarget(q(root, 'span'), root)).toBe(q(root, 'button'));
    expect(pickTarget(q(root, 'b'), root)).toBe(q(root, 'a'));
    expect(pickTarget(q(root, 'path'), root, { exact: true })).toBe(q(root, 'path'));
  });

  it('means the whole icon for a press inside a free-standing svg', () => {
    const root = story(HEADER);
    expect(pickTarget(q(root, 'path'), root)).toBe(q(root, 'svg'));
  });

  it('is nothing for the story root itself', () => {
    const root = story(`<p>x</p>`);
    expect(pickTarget(root, root)).toBeNull();
  });
});

describe('describeElement', () => {
  it('fills a valid ElementTarget for the Log in button', () => {
    const root = story(HEADER);
    const target = describeElement(q(root, '.storybook-button--secondary'), root, {
      storyId: 'example-header--logged-out',
      title: 'Example/Header',
      importPath: './src/stories/Header.stories.ts',
    });
    expect(target).toEqual({
      storyId: 'example-header--logged-out',
      title: 'Example/Header',
      importPath: './src/stories/Header.stories.ts',
      selector: 'button.storybook-button--secondary',
      html: '<button type="button" class="storybook-button storybook-button--small storybook-button--secondary">Log in</button>',
      text: 'Log in',
      role: 'button',
      name: 'Log in',
    });
    expect(elementTargetSchema.safeParse(target).success).toBe(true);
  });

  it('keeps html and text within the 2000-character limit', () => {
    const long = 'x'.repeat(5000);
    const root = story(`<section class="big"><p>${long}</p></section>`);
    const target = describeElement(q(root, 'section'), root, { storyId: 's', title: 't', importPath: './a.ts' });
    expect(target.html.length).toBeLessThanOrEqual(2000);
    expect(target.html.startsWith('<section class="big">')).toBe(true);
    expect(target.html.endsWith('</section>')).toBe(true);
    expect(target.text.length).toBeLessThanOrEqual(2000);
    expect(elementTargetSchema.safeParse(target).success).toBe(true);
    expect(htmlSnippet(q(root, 'p'), 50).length).toBeLessThanOrEqual(50);
  });
});

const STORY = { storyId: 's', title: 't', importPath: './a.ts' };

/** Pins `element` the way comment mode does, so tests resolve what a real comment stores. */
function pin(root: Element, element: Element) {
  return describeElement(element, root, STORY);
}

/** The Page story's header buttons, logged out or in (src/stories/Header.tsx). */
function headerButtons(user: boolean) {
  return user
    ? `<div><span class="welcome">Welcome, <b>Jane Doe</b>!</span><button type="button" class="storybook-button storybook-button--small storybook-button--secondary">Log out</button></div>`
    : `<div><button type="button" class="storybook-button storybook-button--small storybook-button--secondary">Log in</button><button type="button" class="storybook-button storybook-button--small storybook-button--primary">Sign up</button></div>`;
}

const rows = (names: string[]) =>
  `<ul class="rows">${names.map((name) => `<li><span>${name}</span><button>Delete</button></li>`).join('')}</ul>`;

describe('resolveTarget', () => {
  it('finds the element by selector', () => {
    const root = story(HEADER);
    const login = q(root, '.storybook-button--secondary');
    expect(resolveTarget(root, pin(root, login))).toEqual({ kind: 'found', element: login, by: 'selector' });
  });

  it('finds it by role and name after a re-render changed its classes', () => {
    const root = story(HEADER);
    const target = pin(root, q(root, '.storybook-button--secondary'));
    q(root, '.storybook-button--secondary').className = 'storybook-button storybook-button--large';
    const result = resolveTarget(root, target);
    expect(result.kind === 'found' && result.by).toBe('search');
    expect(result.kind === 'found' && result.element.textContent).toBe('Log in');
  });

  it('detaches "Log in" after logging in, instead of moving onto "Log out", and comes back after logging out', () => {
    const root = story(headerButtons(false));
    const target = pin(root, q(root, '.storybook-button--secondary'));
    expect(target.selector).toBe('button.storybook-button--secondary');
    root.innerHTML = headerButtons(true);
    expect(queryUnique(root, target.selector)?.textContent).toBe('Log out');
    expect(resolveTarget(root, target)).toEqual({ kind: 'detached' });
    root.innerHTML = headerButtons(false);
    expect(resolveTarget(root, target)).toMatchObject({ kind: 'found', by: 'selector' });
  });

  it('detaches a class-selected button whose text was edited (a rename is not proof it is the same button)', () => {
    const root = story(`<button class="cta">Log in</button>`);
    const target = pin(root, q(root, 'button'));
    q(root, 'button').textContent = 'Sign in';
    expect(resolveTarget(root, target)).toEqual({ kind: 'detached' });
  });

  it('follows a rename when the selector is a test id or a hand-written id', () => {
    const root = story(`<button data-testid="login" class="cta">Log in</button><a id="help" href="/h">Help</a>`);
    const byTestId = pin(root, q(root, 'button'));
    const byId = pin(root, q(root, 'a'));
    expect(byTestId.selector).toBe('[data-testid="login"]');
    expect(byId.selector).toBe('#help');
    q(root, 'button').textContent = 'Sign in';
    q(root, 'a').textContent = 'Support';
    expect(resolveTarget(root, byTestId)).toEqual({ kind: 'found', element: q(root, 'button'), by: 'id' });
    expect(resolveTarget(root, byId)).toEqual({ kind: 'found', element: q(root, 'a'), by: 'id' });
  });

  it('follows a row by its text when a row is prepended (structural selector, no role or name)', () => {
    const root = story(rows(['Row A', 'Row B', 'Row C']));
    const target = pin(root, q(root, 'li:nth-of-type(3) > span'));
    expect(target.selector).toContain('nth-of-type(3)');
    q(root, 'ul').insertAdjacentHTML('afterbegin', '<li><span>Row 0</span><button>Delete</button></li>');
    const result = resolveTarget(root, target);
    expect(result.kind === 'found' && result.element.textContent).toBe('Row C');
  });

  it("stores the row's text for a button every row has, and follows that row when one is prepended", () => {
    const root = story(rows(['Row A', 'Row B', 'Row C']));
    const target = pin(root, q(root, 'li:nth-of-type(3) > button'));
    expect(target.name).toBe('Delete');
    expect(target.context).toBe('Row C Delete');
    expect(elementTargetSchema.safeParse(target).success).toBe(true);
    q(root, 'ul').insertAdjacentHTML('afterbegin', '<li><span>Row 0</span><button>Delete</button></li>');
    const result = resolveTarget(root, target);
    expect(result.kind).toBe('found');
    expect(result.kind === 'found' && result.element.parentElement?.textContent).toBe('Row CDelete');
  });

  it('follows a keyed reorder and detaches when the row is removed', () => {
    const root = story(rows(['Row A', 'Row B', 'Row C']));
    const span = pin(root, q(root, 'li:nth-of-type(1) > span'));
    const button = pin(root, q(root, 'li:nth-of-type(1) > button'));
    const ul = q(root, 'ul');
    ul.append(ul.firstElementChild as Element); // B, C, A
    for (const target of [span, button]) {
      const result = resolveTarget(root, target);
      expect(result.kind === 'found' && result.element.closest('li')?.querySelector('span')?.textContent).toBe('Row A');
    }
    ul.lastElementChild?.remove();
    expect(resolveTarget(root, span)).toEqual({ kind: 'detached' });
    expect(resolveTarget(root, button)).toEqual({ kind: 'detached' });
  });

  it('does not store context for an element that is unique', () => {
    const root = story(HEADER);
    expect(pin(root, q(root, '.storybook-button--secondary')).context).toBeUndefined();
  });

  it('is detached when the element is gone or look-alikes leave no way to tell which', () => {
    const root = story(`<button>Go</button><button>Go</button>`);
    const base = { html: '<button>Go</button>', text: 'Go', role: 'button', name: 'Go' };
    expect(resolveTarget(root, { ...base, selector: '#missing' })).toEqual({ kind: 'detached' });
    expect(resolveTarget(root, { ...base, selector: 'button' })).toEqual({ kind: 'detached' });
    expect(resolveTarget(root, { selector: '#missing', html: '<i></i>', text: '' })).toEqual({ kind: 'detached' });
    expect(resolveTarget(root, { selector: '[[invalid', html: '<i></i>', text: '' })).toEqual({ kind: 'detached' });
  });

  it('checks the opening tag of an element with no name and no text', () => {
    const root = story(`<div class="a"><i class="dot"></i></div><div class="b"><i class="dot"></i></div>`);
    const target = pin(root, q(root, '.b > i'));
    expect(resolveTarget(root, target).kind).toBe('found');
    q(root, '.b > i').className = 'square';
    expect(resolveTarget(root, target)).toEqual({ kind: 'detached' });
  });
});
