# Colab Canvas for Storybook

Colab Canvas (`storybook-addon-colab`) adds canvases to Storybook. A canvas is a board where you lay out live stories side by side, pin comments to specific elements inside them, and draw on top. A coding agent connected over MCP can read those comments, with enough detail to find the exact element in your code, reply to them and add its own.

Each canvas is a JSON file in your repository, so canvases can be committed, reviewed and shared like any other file.

## A short walkthrough

1. **Create a canvas.** Click **Canvases** in Storybook's toolbar and choose **New canvas…**. The canvas appears in the sidebar under **Canvases** and opens.
2. **Add stories.** Drag a story from the sidebar onto the board. It lands where you drop it and stays live: you can click its buttons and type in its inputs. You can also open a story and use **Add to canvas** in the toolbar. Drag a story's title to move it, drag its right or bottom edge to resize it, and use the ✕ next to the title to remove it.
3. **Comment.** Switch to comment mode (the comment button in the board's toolbar, or press <kbd>C</kbd>). Hovering highlights the element under the pointer. Click to pin a comment to it, type, and press <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>Enter</kbd>. Click a story's empty area to comment on the whole story, or the empty board to comment on a spot.
4. **Draw.** Switch to draw mode (the pencil, or <kbd>D</kbd>) and sketch over the stories: circle a problem, cross something out. Pick a colour and width, or switch to the eraser.
5. **Connect an agent** (see [Connect a coding agent](#connect-a-coding-agent)) and ask it something like "fix the open comments on the design-review canvas".
6. **The agent replies and changes code.** It lists the open comments, finds each element from its story file, selector, HTML and text, edits the component, replies to say what it changed and resolves the comment. Its replies appear on the open canvas within a second or two, and the story re-renders with the change through Storybook's hot reload.

## Requirements

- **Chrome 157 or later.** The board is drawn with [HTML-in-Canvas](https://github.com/WICG/html-in-canvas) (`<canvas content="drawable">` and `drawElementImage()`), which only Chrome 157+ supports. In other browsers a canvas page shows a "Canvases need Chrome 157 or later" message instead of the board; the rest of Storybook works as usual. There is no fallback renderer.
- **Storybook 11** (built and tested against `11.0.0-rc.0`).
- **React with Vite** (`@storybook/react-vite`). Other frameworks and builders are untested.
- **The dev server** (`storybook dev`). Canvases are stored and served by the dev server, so a static build (`storybook build`) has no canvases and no MCP endpoint.
- **Node 22.12 or later** (required by Storybook 11).

## Install

The addon is not published to npm yet. Build it from this repository and install it from the local folder:

```sh
git clone https://github.com/winkervsbecks/addon-colab
cd addon-colab
pnpm install
pnpm build

# in your Storybook project
pnpm add -D /path/to/addon-colab
```

Then register it in `.storybook/main.ts`:

```ts
import { defineMain } from '@storybook/react-vite/node';

export default defineMain({
  framework: '@storybook/react-vite',
  stories: ['../src/**/*.stories.@(js|jsx|ts|tsx)'],
  addons: ['storybook-addon-colab'],
});
```

### Options

Canvas files live in `<config dir>/canvases`, usually `.storybook/canvases/`. To keep them elsewhere, pass `canvasDir`; a relative path resolves against the directory you run Storybook from:

```ts
addons: [{ name: 'storybook-addon-colab', options: { canvasDir: 'design/canvases' } }],
```

The folder is created when the dev server starts. You don't need to add it to `stories`: the addon does that itself, in the dev server only.

## Connect a coding agent

While `storybook dev` is running, the addon serves an MCP endpoint (streamable HTTP) at `/colab/mcp` on the same address and port as Storybook, for example `http://localhost:6006/colab/mcp`. Use the port your Storybook runs on.

**Claude Code:**

```sh
claude mcp add --transport http storybook-colab http://localhost:6006/colab/mcp
```

**Claude Code project config (`.mcp.json`)**, and other clients that use the same `mcpServers` shape:

```json
{
  "mcpServers": {
    "storybook-colab": {
      "type": "http",
      "url": "http://localhost:6006/colab/mcp"
    }
  }
}
```

**VS Code (`.vscode/mcp.json`):**

```json
{
  "servers": {
    "storybook-colab": {
      "type": "http",
      "url": "http://localhost:6006/colab/mcp"
    }
  }
}
```

**Cursor (`.cursor/mcp.json`):**

```json
{
  "mcpServers": {
    "storybook-colab": {
      "url": "http://localhost:6006/colab/mcp"
    }
  }
}
```

The path is different from `@storybook/addon-mcp`'s `/mcp`, so both addons can be installed together. The agent only reads comments when you ask it to; nothing is pushed to it.

### Tools

| Tool                      | What it does                                                                                                                                                                                                                                                                              |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `list_canvases`           | Every canvas with its id, name, frame count and open/total comment counts. Files in the canvas folder that are not valid canvases are listed under `invalid`, with the reasons.                                                                                                           |
| `get_canvas`              | One canvas: its frames (story id, story file, position, size), every comment with its location and replies, and its strokes, summarised by bounds and by which frames each one is `within`, `crosses`, `surrounds` or is `near`. Raw stroke points only with `includeStrokePoints: true`. |
| `list_canvas_comments`    | Comments, oldest first, on one canvas or all of them, optionally filtered by `status` (`open`/`resolved`) and `author` (`user`/`agent`).                                                                                                                                                  |
| `add_canvas_comment`      | Adds an open comment written by the agent, pinned to an element (`frameId` + `target`, usually copied from another comment), a whole frame (`frameId`, optional `x`/`y` offset), a board position (`x`, `y`), or the same place as an existing comment (`{ type: "sameAs", commentId }`). |
| `reply_to_canvas_comment` | Adds a reply written by the agent. Does not change the comment's status.                                                                                                                                                                                                                  |
| `resolve_canvas_comment`  | Marks a comment resolved. Resolving an already resolved comment changes nothing and keeps its original `resolvedAt`.                                                                                                                                                                      |
| `reopen_canvas_comment`   | Marks a resolved comment open again.                                                                                                                                                                                                                                                      |

Everything the agent writes is marked `author: "agent"` and shows on an open canvas without a reload. Coordinates are board pixels at zoom 1. Errors come back as text starting with a code, such as `NOT_FOUND:` or `INVALID_INPUT:`.

### What a comment's location contains

Every comment returned by the tools has a `location`. For a comment on an element:

```json
{
  "type": "element",
  "frameId": "frame-header01",
  "frameOnCanvas": true,
  "storyId": "example-header--logged-out",
  "title": "Example/Header",
  "storyFile": "./src/stories/Header.stories.ts",
  "selector": "button.storybook-button--secondary",
  "role": "button",
  "name": "Log in",
  "text": "Log in",
  "html": "<button type=\"button\" class=\"storybook-button storybook-button--small storybook-button--secondary\">Log in</button>"
}
```

- `storyFile` is the story's import path; `selector` is a CSS selector relative to the story's root element.
- `html` and `text` are the element's markup and text when it was pinned, each cut to 2000 characters.
- `role` and `name` are the element's accessible role and name, when it has them.
- `context` is added when the story has several elements that look the same (each row's "Delete"): it is the text of the nearest ancestor that tells this one apart, such as its row.
- `frameOnCanvas` is `false` when the story's frame has since been removed from the canvas; the comment still names the story.

A comment on a whole story has `type: "frame"`, `frameId`, `frameOnCanvas`, `storyId`, `title`, `storyFile` and, if it was pinned at a spot, `offset: { x, y }` from the frame's top-left corner. A comment on the board has `type: "position"`, `x`, `y` and `insideFrames` (the frames that point lies in).

The location describes the element as it was when the comment was pinned. It does not say whether the pin is currently attached on the board (see [How comment pins find their element](#how-comment-pins-find-their-element-and-when-they-dont)).

### Security

The endpoint has no authentication, like the rest of Storybook's dev server. Anything that can reach the dev server can read and write your canvases through it.

- With the default host, Storybook listens on your machine only. The endpoint also refuses browser requests whose `Origin` is not an allowed host, so a web page on another site can't call it through your browser.
- **If you run Storybook with `--host 0.0.0.0` and no `core.allowedHosts`, Storybook accepts every host name.** Then anyone on your network can read and write canvases, and so can a web page using DNS rebinding, because the Origin check accepts every host too. If you need `--host 0.0.0.0`, list the host names you use:

  ```ts
  export default defineMain({
    // …
    core: { allowedHosts: ['my-laptop.local'] },
  });
  ```

  `allowedHosts: true` turns the check off entirely; avoid it.

## Using a canvas

- **Canvases** in the toolbar lists your canvases and creates, renames and deletes them. Each canvas is also a sidebar entry under **Canvases**; its URL stays the same when you rename it.
- **Add to canvas** in the toolbar, shown while a story is open, adds that story to a canvas you pick, to the right of its other stories.
- **Pan** with the trackpad or mouse wheel, by dragging the empty background, with the middle mouse button, or by holding <kbd>Space</kbd> and dragging. **Zoom** (10% to 400%) by pinching, with <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+wheel, or with the zoom buttons in the board's toolbar. **Zoom to fit** frames every story and comment. Storybook's own toolbar zoom is hidden on canvas pages.
- **Select** a story by clicking its title or anything inside it; the selected story comes to the front. Its title bar has **Open story** and **Remove from canvas**.
- A story's frame is as tall as its content, and at least as tall as you resized it to. Frames are at least 120 × 40 pixels.
- **Comments:** the **Comments** button opens the list of open comments (and resolved ones, with **Resolved**). Click a pin or a list row to open its thread, where you can reply, resolve or reopen, and delete.
- **Drawing:** pen or eraser (the eraser removes whole strokes), six colours (one follows the light or dark theme) and three widths. **Clear drawing** removes every stroke after a confirmation.
- The layout is saved to the canvas file as you work. Where you panned and zoomed is remembered per canvas in your browser, not in the file.

### Keyboard shortcuts

On a canvas page:

| Keys                                                                                 | Where                                           | What                                                                                      |
| ------------------------------------------------------------------------------------ | ----------------------------------------------- | ----------------------------------------------------------------------------------------- |
| <kbd>V</kbd> / <kbd>C</kbd> / <kbd>D</kbd>                                           | focus on the board (click its empty background) | Select-and-interact mode / comment mode / draw mode                                       |
| <kbd>Esc</kbd>                                                                       | anywhere on the board                           | Leave comment or draw mode; otherwise clear the selection. Closes an open comment thread. |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>Z</kbd>                                            | not in a text field or a story                  | Undo                                                                                      |
| <kbd>⇧</kbd>+<kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>Z</kbd>, <kbd>Ctrl</kbd>+<kbd>Y</kbd> | not in a text field or a story                  | Redo                                                                                      |
| <kbd>Space</kbd> + drag                                                              | focus on the board                              | Pan                                                                                       |
| Arrow keys (<kbd>⇧</kbd> for 10 px)                                                  | focus on a story's title                        | Move the story                                                                            |
| <kbd>Delete</kbd> / <kbd>Backspace</kbd>                                             | focus on a story's title                        | Remove the story from the canvas                                                          |
| <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+<kbd>Enter</kbd>                                        | in a comment or reply box                       | Post it                                                                                   |
| Hold <kbd>Alt</kbd>/<kbd>⌥</kbd>                                                     | comment mode                                    | Target the exact element under the pointer, not the button or link around it              |

Keys pressed inside a story belong to the story: <kbd>Backspace</kbd> in a story's input never removes the frame.

Undo covers removing stories, deleting comments, and drawing, erasing and clearing strokes. Adding a comment and moving or resizing a story are not undoable.

## Canvas file format

One JSON file per canvas, named after its id: `.storybook/canvases/design-review.json`. The addon writes these files itself; you can also edit them by hand while nothing is being changed on the board, and an open canvas picks up the edit.

```json
{
  "schemaVersion": 1,
  "id": "design-review",
  "name": "Design review",
  "createdAt": "2026-11-25T15:00:00.000Z",
  "updatedAt": "2026-11-25T15:30:00.000Z",
  "frames": [
    { "id": "frame-header01", "storyId": "example-header--logged-out", "x": 0, "y": 0, "width": 800 },
    { "id": "frame-button01", "storyId": "example-button--primary", "x": 0, "y": 160, "width": 240, "height": 80 }
  ],
  "comments": [
    {
      "id": "comment-login01",
      "author": "user",
      "body": "Make the Log in button secondary.",
      "status": "open",
      "anchor": {
        "type": "element",
        "frameId": "frame-header01",
        "target": {
          "storyId": "example-header--logged-out",
          "title": "Example/Header",
          "importPath": "./src/stories/Header.stories.ts",
          "selector": "header > div > div:nth-of-type(2) > button:nth-of-type(1)",
          "html": "<button type=\"button\" class=\"storybook-button storybook-button--small storybook-button--secondary\">Log in</button>",
          "text": "Log in",
          "role": "button",
          "name": "Log in"
        }
      },
      "createdAt": "2026-11-25T15:10:00.000Z",
      "replies": [
        {
          "id": "reply-agent01",
          "author": "agent",
          "body": "Done: Header now passes primary={false} to the Log in button.",
          "createdAt": "2026-11-25T15:20:00.000Z"
        }
      ]
    }
  ],
  "strokes": [
    {
      "id": "stroke-circle01",
      "color": "#ff4785",
      "width": 3,
      "points": [
        [-10, 150],
        [250, 150],
        [250, 250],
        [-10, 250]
      ]
    }
  ]
}
```

- `id` is a lowercase slug (letters, digits, single dashes) and must match the file name. Timestamps are ISO strings in UTC. Coordinates are board pixels at zoom 1. Ids are unique across frames, comments, replies and strokes.
- **Frames** are `{ id, storyId, x, y, width, height? }`. Without `height` the frame takes its content's height. Their order in the file is the stacking order: the last one is on top.
- **Comments** are `{ id, author: "user" | "agent", body, status: "open" | "resolved", anchor, createdAt, resolvedAt?, replies }`. `resolvedAt` is present exactly when `status` is `"resolved"`. **Replies** are `{ id, author, body, createdAt }`.
- **Anchors** are one of:
  - `{ "type": "element", frameId, target }`: an element inside a story.
  - `{ "type": "frame", frameId, storyId, x?, y? }`: a whole story; `x` and `y` (both or neither) are an offset from the frame's top-left corner.
  - `{ "type": "position", x, y }`: a point on the board.

  A `frameId` can point to a frame that has since been removed; the target or `storyId` still names the story.

- **Element targets** are `{ storyId, title, importPath, selector, html, text }` plus these optional fields:
  - `role`, `name`: the element's accessible role and name.
  - `context` (up to 300 characters): text of the nearest ancestor that tells the element apart from look-alikes, such as its row.
  - `lookAlikes` (2 or more): how many look-alikes the story had when the comment was pinned. It helps the board re-find the element; it is not included in the MCP output.

  Files written before `context` and `lookAlikes` existed load unchanged.

- **Strokes** are `{ id, color, width, points: [[x, y], …] }`, with at most 300 points per stroke drawn on the board. The colour `"currentColor"` follows the theme's text colour.
- A file with another `schemaVersion`, or one that doesn't validate, is shown as a broken canvas that you can delete; the addon never overwrites it. Unknown keys are dropped on the next write.

## How comment pins find their element, and when they don't

Stories re-render, so a pin has to find its element again each time. A pin stays attached only when there is evidence that it is the same element: the same role and accessible name, or else the same tag and text, and, for elements that have look-alikes in the story, the same row or ancestor text. A stable `data-testid` or hand-written `id` also counts. Otherwise the pin detaches: it moves to its story's top-left corner and is drawn with a dashed outline. It usually re-attaches by itself when the element comes back.

**For reliable pins, give important elements a stable `data-testid` or `id`.**

A pin can attach to the wrong element when:

- Rows use index-based test ids or ids (``data-testid={`delete-${i}`}``). After a row above is removed, the pin follows the id to a different row. Use ids based on the data instead.
- Numbered repeated groups ("Passenger 1", "Passenger 2", "Passenger 3") renumber after one is removed: pins on the groups below shift by one group.
- A unique element is replaced by another with the same role and name elsewhere: the next tab's "Save", the next wizard step's "Next", another row's open-menu "Delete", or a dialog's "Close" after a banner's "Close" is dismissed. The pin follows it.
- Identical look-alikes have nothing to tell them apart, and one is removed while another is added in the same render.
- The pinned element goes away and a look-alike takes over its exact class.
- Another row's text becomes exactly the pinned row's text.
- The comment was saved before look-alike tracking existed: it is treated as unique.

A pin detaches (and usually re-attaches by itself) when:

- The element's text or accessible name changes and it has no test id or hand-written id. That includes an agent renaming it because a comment asked for it. There is no action to re-pin a comment; its thread still shows the original target.
- Text elsewhere in the pinned element's row or card changes for a while: a count, an expanded section, or the row's own open menu.

Also:

- After a CSS-only hot reload a pin can sit a few pixels off its element until the next pan or zoom.
- The MCP output does not tell the agent whether a pin is currently detached.

## Known limitations

- **One page for every story.** All stories on a canvas render in one page (like a docs page), so a story or decorator that adds global CSS affects every other story on the canvas and the board's own UI. Story rules with `!important` on `*`, or rules scoped to an id such as `#storybook-root *`, can still break the board's controls (comment-thread buttons, list rows, toolbar icons). A rule like `div { transform: … !important }` shifts stories relative to the drawings.
- A story that uses `100vh` sizes to the preview's height, not to its frame.
- Elements inside a shadow root, an iframe or a portal can't be commented on individually; comment on the story instead.
- Commenting needs a pointer. There is no keyboard-only way to pin a comment.
- Only removing stories, deleting comments and drawing can be undone. Adding a comment and moving or resizing a story can't.
- Tab order of story titles follows the order stories were added, not their position on the board.
- A change made elsewhere (another tab, a hand edit, the agent) to a story's position or size while you are dragging or resizing that story is overwritten when you let go: the last writer wins.
- Right after you create a new canvas, the first change to a story file can reload the whole board once, which resets the stories' state.
- Removing a story leaves about 130 event listeners held by Storybook's own preview caches (not the addon's code). Storybook's cache may bound this; it only matters after adding and removing many stories in one session.
- Thin amber and green strokes look slightly heavier than other colours because of their dark outline, and where two strokes cross, the top stroke's outline cuts a small gap in the one below.
- When there are no canvases yet, Storybook prints `No story files found for the specified pattern: …/canvases/*.json` at startup. It is harmless; Storybook gives addons no way to silence it.
- Storybook's toolbar zoom is reset to 100% when you open a canvas and is not restored when you go back to a story: Storybook 11 keeps that zoom level private, with no API to read or set it.
- Only one Storybook dev server should use a canvas folder at a time. Two servers writing the same files can lose each other's writes.
- Real-time multi-user editing, accounts and permissions are out of scope. So are shapes, arrows, text boxes, image export and sending images of the canvas to the agent.

## Development

```sh
pnpm install
pnpm build            # build the addon with tsup (the example Storybook loads dist/)
pnpm storybook        # the example stories with the addon, on port 6006
pnpm test             # unit tests (Vitest)
pnpm lint && pnpm typecheck
pnpm check:browser    # browser checks in the installed Chrome (see below)
```

`pnpm check:browser` runs `scripts/check-board-*.mjs`. They need Google Chrome 157+ installed (set `CHROME` to its executable if it is not in `/Applications`): Playwright's bundled Chromium has no HTML-in-Canvas. The command starts its own Storybook on port 6190 (set `PORT` to change it) from `scripts/check-storybook`, with canvases in a temporary `.sb-checks/` folder that is deleted afterwards, so it never touches `.storybook/canvases`. Pass words to run some of the checks only: `pnpm check:browser draw comments`.

## License

MIT
