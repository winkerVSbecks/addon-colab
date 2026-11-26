# <img src="https://raw.githubusercontent.com/winkerVSbecks/addon-colab/main/assets/icon.svg" alt="Colab Canvas icon" width="96" height="96" align="center"> Colab Canvas for Storybook

[![Storybook](https://cdn.jsdelivr.net/gh/storybookjs/brand@main/badge/badge-storybook.svg)](https://main--6b084d0ac639954a18641c7a.chromatic.com)

Colab Canvas (`storybook-addon-colab`) adds canvases to Storybook. A canvas is a board where you lay out live stories side by side, pin comments to specific elements inside them, and draw on top. A coding agent connected over MCP can read those comments, with enough detail to find the exact element in your code, reply to them and add its own.

Each canvas is a JSON file in your repository, so canvases can be committed, reviewed and shared like any other file.

## A short walkthrough

1. **Create a canvas.** Click **Canvases** in Storybook's toolbar and choose **New canvas…**. The canvas appears in the sidebar under **Canvases** and opens.
2. **Add stories.** Drag a story from the sidebar onto the board. It lands where you drop it and stays live: you can click its buttons and type in its inputs. You can also open a story and use **Add to canvas** in the toolbar. Drag a story's title to move it. Click the title to select the story; a selected story has resize handles on its right and bottom edges and an ✕ next to its title that removes it.
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

The addon is published under the npm dist-tag `next` while Storybook 11 is a release candidate, so add `@next`:

```sh
npm install -D storybook-addon-colab@next
# or
pnpm add -D storybook-addon-colab@next
# or
yarn add -D storybook-addon-colab@next
```

To try unreleased changes, build it from source and install it from the local folder:

```sh
git clone https://github.com/winkerVSbecks/addon-colab
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

Everything the agent writes is marked `author: "agent"` and shows on an open canvas without a reload. Coordinates are board pixels at zoom 1.

Frames size to their content, which the server can't measure. While a canvas is open in Storybook, the board tells the dev server how tall it draws each story, and `get_canvas` returns that as `renderedHeight`. The dev server keeps it in memory only and never writes it to the canvas file. `height` is the minimum height someone resized the frame to. The stroke and position summaries use `renderedHeight`, then `height`, and otherwise assume 400 pixels; `get_canvas` adds a `note` when it had to assume a height. Open the canvas once after starting Storybook to give the agent real heights. With the canvas open in more than one tab, `renderedHeight` comes from whichever tab reported last. Reports for a canvas without a file, or for frames that are not on it, are ignored. Errors come back as text starting with a code, such as `NOT_FOUND:` or `INVALID_INPUT:`.

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
- **If you run Storybook with `--host 0.0.0.0` and no `core.allowedHosts`, Storybook accepts every host name.** Then anyone on your network can read and write canvases, and so can a web page using DNS rebinding, because the Origin check accepts every host too. Listing the host names you use blocks DNS rebinding and requests made under other host names:

  ```ts
  export default defineMain({
    // …
    core: { allowedHosts: ['my-laptop.local'] },
  });
  ```

  `allowedHosts: true` turns the check off entirely; avoid it.

  `allowedHosts` does not make the endpoint private: anyone who can reach your machine's IP address can still read and write canvases. Do not use `--host 0.0.0.0` on a network you don't trust.

## Using a canvas

- **Canvases** in the toolbar lists your canvases and creates, renames and deletes them. Each canvas is also a sidebar entry under **Canvases**; its URL stays the same when you rename it.
- **Add to canvas** in the toolbar, shown while a story is open, adds that story to a canvas you pick, to the right of its other stories.
- **Pan** with the trackpad or mouse wheel, by dragging the empty background, with the middle mouse button, or by holding <kbd>Space</kbd> and dragging. **Zoom** (10% to 400%) by pinching, with <kbd>⌘</kbd>/<kbd>Ctrl</kbd>+wheel, or with the zoom buttons in the board's toolbar. **Zoom to fit** frames every story and comment. Storybook's own toolbar zoom is hidden on canvas pages.
- **Select** a story by clicking its title or anything inside it; the selected story comes to the front. Only the selected story shows **Open story** and **Remove from canvas** in its title bar, and resize handles on its right edge, bottom edge and corner.
- A story's frame is as tall as its content. Dragging its bottom edge saves a height, and from then on the frame is at least that tall; it still grows when its content is taller. To clear a saved height, drag the bottom edge all the way up: the frame then follows its content again (the file keeps the 40-pixel minimum). Frames are at least 120 × 40 pixels. The board never saves a height on its own, so opening a canvas does not change its file. Canvases saved by earlier versions of the addon, which stored every frame's measured height, keep those heights as minimums; clear them the same way.
- A story whose file was deleted or renamed shows **This story no longer exists** with a **Remove** button, and comes back by itself when the file returns. A story that fails to load shows the error and a **Retry** button.
- Storybook 11 marks a canvas you have edited as new or modified in the sidebar, the same as a story file you changed, because each canvas is a file in your repository.
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
- **Frames** are `{ id, storyId, x, y, width, height? }`. Without `height` the frame takes its content's height. `height` is written only when someone resizes the frame's height, and the frame is then at least that tall. Files from earlier versions of the addon may have a `height` on every frame (the board used to save measured heights); those heights are treated the same way, as minimums. Their order in the file is the stacking order: the last one is on top.
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
- Tab order of story titles follows the frames' internal ids, not their position on the board or the order they were added.
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

The repository ships two example canvases in `.storybook/canvases/` (`component-review.json` and `testing.json`); they appear under **Canvases** in the sidebar when you run `pnpm storybook`.

`pnpm check:browser` runs `scripts/check-board-*.mjs`. They need Google Chrome 157+ installed (set `CHROME` to its executable if it is not in `/Applications`): Playwright's bundled Chromium has no HTML-in-Canvas. The command starts its own Storybook on port 6190 (set `PORT` to change it) from `scripts/check-storybook`, with canvases in a temporary `.sb-checks/` folder that is deleted afterwards, so it never touches `.storybook/canvases`. Pass words to run some of the checks only: `pnpm check:browser draw comments`. Some checks delete and restore a story file in `scripts/fixtures`; the command puts back any fixture that is missing (from git) before and after the run, also when it had to kill a check that hung.

### Visual tests

The **Chromatic** workflow ([`.github/workflows/chromatic.yml`](.github/workflows/chromatic.yml)) runs [Chromatic](https://www.chromatic.com/docs/) on every push: it builds the addon and the example Storybook, publishes the Storybook and compares a snapshot of each story with its accepted baseline. Options are in [`chromatic.config.json`](chromatic.config.json); the project token is the repository secret `CHROMATIC_PROJECT_TOKEN`, so the job skips Chromatic in forks.

- **Review changes in Chromatic, not in the job log.** Visual changes do not fail the job (it fails only when the Storybook does not build or a story errors). Chromatic's **UI Tests** check on the pull request stays pending until someone accepts or denies the changes, and that check is what to wait for before merging.
- **Baselines.** Changes merged into `main` are accepted automatically (`autoAcceptChanges`), so `main` stays the baseline for new branches.
- **What is snapshotted.** Every story in the static build, in Chromatic's capture browser. Canvases are not in the static build (they need the dev server). The canvas page story that draws the real board (**Addon/Canvas page › Empty**) has `chromatic: { disableSnapshot: true }`, because the board needs HTML-in-Canvas, which the capture browser may not have. Give any new story that depends on HTML-in-Canvas or the dev server the same parameter, or a fixed state such as the "needs Chrome 157" or "server unavailable" views.
- **Animations.** Chromatic pauses CSS animations on their last frame, so spinners in loading stories are stable.

The published Storybook for `main` is at the link in the badge above; that link works once `main` has had a Chromatic build (after the first push to `main`). Each branch gets its own at `https://<branch>--6b084d0ac639954a18641c7a.chromatic.com`.

## Releasing

Releases are published to npm by [`.github/workflows/release.yml`](.github/workflows/release.yml) when a tag `v<version>` is pushed. It uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers): GitHub Actions proves its identity to npm with a short-lived OIDC token, so no npm token is stored in the repository or its secrets.

The workflow runs only for pushed tags that start with `v`, never for pull requests or branch pushes. It has two jobs:

1. **Check, test and build** (read-only): fails at once unless the tag is exactly `v` + the `version` in `package.json`. It then asks the npm registry whether that exact version is already published (a 404 means no; any other failure to get an answer stops the run, so a registry outage is never read as either answer), runs `pnpm install --frozen-lockfile`, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`, and lists the package contents with `npm publish --dry-run` (or `npm pack --dry-run` if the version is already on npm, because the publish dry run refuses a published version).
2. **Publish to npm**: runs only if the version is not on npm yet; otherwise it is skipped, without asking for approval, and the first job's notice says the version is already on npm. It runs in the GitHub environment `npm`, so it waits for approval if the environment requires it. It upgrades npm to 11.21.3, builds again and runs `npm publish --provenance`.

Neither job uses a dependency cache: a cache shared with other workflow runs could change what gets published.

**Dist-tag rule:** versions below 1.0.0, and versions with a pre-release identifier (anything with a `-`, such as `1.2.0-rc.1`), are published under `next`. Other versions are published under `latest`. The workflow always passes the dist-tag with `--tag`; change the rule in its "Check that the tag matches package.json" step. `package.json` also sets `publishConfig.tag` to `next`, so an `npm publish` without `--tag` goes out under `next`, not `latest`. (`npm publish --dry-run` still prints "latest" in its notice, because it logs the command-line default; the real publish uses `next`. A `--tag` on the command line overrides `publishConfig.tag`.) When the first stable version is released, change `publishConfig.tag` to `latest` in the same pull request.

### What npm's documentation requires

From [Trusted publishing for npm packages](https://docs.npmjs.com/trusted-publishers), [`npm trust`](https://docs.npmjs.com/cli/v11/commands/npm-trust) and [Generating provenance statements](https://docs.npmjs.com/generating-provenance-statements), checked on 2026-11-25:

- **npm CLI 11.5.1 or later and Node 22.14.0 or later.** The workflow uses Node 24 and installs npm 11.21.3.
- **GitHub-hosted runners only.** Self-hosted runners are not supported.
- **`id-token: write`** on the publishing job, which lets it request the OIDC token ([GitHub's OIDC reference](https://docs.github.com/en/actions/reference/security/oidc)). The workflow grants only `id-token: write` and `contents: read`, and only to the publish job.
- **Provenance** is generated automatically for trusted publishing from GitHub Actions when both the repository and the package are public. (`--provenance` is passed as well; it is harmless.)
- **`repository.url` in `package.json` must match the GitHub repository** exactly.
- **The trusted publisher names the workflow file name (`release.yml`), the repository (`winkerVSbecks/addon-colab`) and, optionally, an environment (`npm`).** "All fields are case-sensitive and must be exact." npm does not check them when you save; a mistake shows up as an authentication error when publishing. A connection can't be edited, only deleted and recreated.
- **A new trusted publisher expires if it is not used within 2 days**: "A newly created trusted publisher configuration must complete its first successful publish within 2 days." Otherwise it must be deleted and recreated. So add it only when the release it will publish is ready (step 7 below), not after the first manual publish.
- **The package must already exist on npm** before a trusted publisher can be added to it: "The package you're configuring must already exist on the npm registry" ([`npm trust`](https://docs.npmjs.com/cli/v11/commands/npm-trust); the website's settings are also per package). So the first version, 0.1.0, has to be published from your own machine, without provenance. Every later version is published by the workflow.

### Release checklist, in order

Steps 1–6 are the first release (0.1.0). Steps 7–9 are the first release published by the workflow; every release after it repeats step 8.

1. **Merge the pull request into `main`.** The README's icon URL and the workflow only work from `main`.
2. **Check your npm account**: sign in on npmjs.com as the account that will own `storybook-addon-colab`, with two-factor authentication turned on. `npm view storybook-addon-colab` must return 404 (the name is still free).
3. **Create the `npm` environment on GitHub**: repository **Settings → Environments → New environment**, name it `npm`. Under **Deployment protection rules** add yourself as a **required reviewer**, so each release waits for your approval. Under **Deployment branches and tags**, choose **Selected branches and tags** and add the tag rule `v*`. Recommended: also add a tag ruleset (**Settings → Rules → Rulesets → New tag ruleset**) for `v*` that only you can bypass, so nobody else can create a release tag.
4. **Publish 0.1.0 from your machine**, from a clean, up-to-date `main`:

   ```sh
   git switch main && git pull
   git status                          # must be clean
   pnpm install --frozen-lockfile && pnpm build
   npm publish --dry-run --tag next    # check: version 0.1.0 and the 14 files
   npm login
   npm publish --tag next --access public
   ```

   Never run a bare `npm publish`: always pass `--tag next` (and `--access public`), even though `publishConfig` sets both.

5. **Check the dist-tags**: `npm view storybook-addon-colab dist-tags`, and note whether `latest` was also set. npm may point `latest` at a package's first version whatever tag it was published under. Either way, `npm install storybook-addon-colab` installs 0.1.0 while it is the only version, and the `storybook` peer range (`^11.0.0-rc.0`) is what protects people on stable Storybook.
6. **Tag 0.1.0 and run the workflow**: `git tag v0.1.0 && git push origin v0.1.0`. The workflow checks, tests and builds, reports that 0.1.0 is already on npm and skips the publish job, so there is no deployment to approve. This tests the workflow, not trusted publishing, because nothing is published.
7. **When the next release is ready, and no more than 2 days before you push its tag, add the trusted publisher**: on npmjs.com open `storybook-addon-colab` → **Settings** → **Trusted publishing** → **GitHub Actions**, and enter organization or user `winkerVSbecks` (exactly this case), repository `addon-colab`, workflow filename `release.yml`, environment `npm`, and allow **npm publish**. Or, with npm 11.15.0 or later: `npm trust github storybook-addon-colab --file release.yml --repo winkerVSbecks/addon-colab --env npm --allow-publish`.
8. **Release it**: on a branch, set the new `version` in `package.json` and add its entry to `CHANGELOG.md`, then merge to `main`. Tag from an up-to-date `main` (`git switch main && git pull && git tag v0.1.1 && git push origin v0.1.1`), approve the `npm` deployment, then check `npm view storybook-addon-colab dist-tags` and the provenance badge on the package page. If more than 2 days pass after step 7 without a successful publish, delete the trusted publisher and add it again before pushing the tag.
9. **After a workflow publish has succeeded**, open the package's **Settings → Publishing access** and choose **Require two-factor authentication and disallow tokens**. Trusted publishing keeps working.

To lint the package before a release: `npx publint` and `npx @arethetypeswrong/cli --pack . --profile esm-only --exclude-entrypoints ./preset ./manager`. The addon is ESM-only, like Storybook 11, and the `preset` and `manager` entries are loaded by Storybook, not imported, so they ship without types.

## License

MIT
