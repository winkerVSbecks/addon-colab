# Changelog

All notable changes to `storybook-addon-colab` are recorded here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Versions below 1.0.0 are published under the npm dist-tag `next`.

## [0.1.0] - 2026-11-25

The first pre-release. Install it with `npm install -D storybook-addon-colab@next`.

### Added

- **Canvases.** A canvas is a board where you lay out live stories side by side. Create, rename, open and delete canvases from **Canvases** in Storybook's toolbar; each canvas is also a sidebar entry under **Canvases**, and its URL survives renames.
- **Live stories on the board.** Drag a story from the sidebar onto the board, or use **Add to canvas** while a story is open. Stories stay interactive. Move, resize and remove them; pan and zoom the board (10% to 400%), and zoom to fit.
- **Comments pinned to elements.** In comment mode, hovering highlights the element under the pointer and clicking pins a comment to it. You can also comment on a whole story or a spot on the board. Comments have replies and are open or resolved.
- **Drawing.** Freehand strokes in six colours and three widths, an eraser, and **Clear drawing**. Strokes stay aligned to the stories at any zoom.
- **Undo and redo** for removing stories, deleting comments, and drawing, erasing and clearing strokes.
- **MCP tools for coding agents.** While `storybook dev` runs, the addon serves an MCP endpoint at `/colab/mcp` on Storybook's own address. An agent can list canvases, read comments with each element's story id, story file, CSS selector, HTML, text and accessible role and name, add comments, reply, resolve and reopen. What the agent writes appears on an open canvas within a second or two.
- **Canvas files.** Each canvas is a JSON file in `.storybook/canvases/` (or the folder set with the `canvasDir` option), so canvases can be committed and reviewed. The format is documented in the README.

### Requirements

- Chrome 157 or later. The board uses [HTML-in-Canvas](https://github.com/WICG/html-in-canvas). Other browsers show a message instead of the board; the rest of Storybook works as usual.
- Storybook 11 (built and tested against `11.0.0-rc.0`) with React and Vite (`@storybook/react-vite`). Other frameworks and builders are untested.
- The dev server. A static build (`storybook build`) has no canvases and no MCP endpoint.
- Node 22.12 or later.

### Known limitations

- All stories on a canvas render in one page, so global CSS from one story affects the others and can affect the board's own controls.
- A comment pin can detach from its element when the element's text or accessible name changes and it has no test id or id, and in rare cases attach to an identical look-alike.
- The MCP endpoint has no authentication, like the rest of Storybook's dev server. Do not expose the dev server on a network you don't trust.
- Only one dev server should use a canvas folder at a time.
- Adding a comment and moving or resizing a story can't be undone. Commenting needs a pointer.

See [Known limitations](https://github.com/winkerVSbecks/addon-colab#known-limitations) and [How comment pins find their element](https://github.com/winkerVSbecks/addon-colab#how-comment-pins-find-their-element-and-when-they-dont) in the README for the full list.

[0.1.0]: https://github.com/winkerVSbecks/addon-colab/releases/tag/v0.1.0
