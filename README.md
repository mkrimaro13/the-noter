# The Noter

A small, quiet note-taking interface built with Angular 22. Notes are made of a title,
visible custom metadata, and a stack of content blocks that can be rearranged by dragging.

## What it does

- **Notes** — create, rename, search, and delete notes. Notes are sorted by the last edit.
- **Nested notes** — create a note inside another note from the editor's “Add sub-note” button,
  the nested-note action in the sidebar, or a sub-note block. Sub-notes appear indented under
  their parent in the sidebar (with disclosure controls) and as cards in the parent note;
  breadcrumbs in the editor lead back up the tree. A sub-note block also embeds the child note
  directly in the parent's writing flow, where its title and blocks can be edited in place and
  opened in the full editor when needed. Deleting a note promotes its direct children to the
  deleted note's parent instead of removing them, removes any inline sub-note blocks pointing
  at it, and search flattens the tree so matches are never hidden.
- **Icons and covers** — give a note an emoji or short text icon (presets or your own) and an
  optional cover image. Drop a new image onto an existing cover to replace it, or use the
  header controls to add, replace, and remove covers. The icon appears beside the title and in
  the sidebar.
- **Visible metadata** — add any number of `label → value` pairs to a note. Values accept
  inline time helpers resolved on `Enter` or blur: `now()` inserts the current date and time,
  `today()` the date, and `time()` the time. Use `now(iso)`, `now(unix)`, or a pattern such as
  `now(YYYY-MM-DD HH:mm)` for other formats.
- **Composable blocks** — text, headings, bulleted/numbered lists, images, code, function, and
  sub-note blocks. Use the block-type button beside a block to switch between them at any time;
  writing carries over as a heading, list items, or text columns, and switching to a sub-note
  moves the writing into a new child note. Pressing `Enter` in a text block or heading splits it
  at the caret and starts a new text block; `Shift+Enter` adds a line break inside the block.
  The “Add block” control sits at the end of the writing, just before the sub-note references.
- **Code and function blocks** — code blocks use a monospace editor with an optional language
  label and syntax highlighting for common languages (TypeScript, JavaScript, HTML, CSS, JSON,
  Python, shell, SQL, and more). Function blocks give signatures and expressions the same
  treatment with a quieter `ƒ` marker, and render LaTeX as typeset math when the writing looks
  like an expression. Use the `TeX` control to force math rendering on or off; both block types
  keep their writing when converted to and from other block types.
- **Markdown-compatible writing** — inline `code`, `[label](url)` links, and bare `https://`
  links are rendered while a field is unfocused and return to their raw text as soon as you
  edit. Start a text block with a fence such as ` ```ts ` and press `Enter` (or paste a whole
  fenced block) to promote it to a code block; use ` ```fn ` for a function block or
  ` ```math ` for a math-rendered function block. Markdown block prefixes also convert a
  single-column text block as you type: `# ` through `###### ` create headings, and `- `, `* `,
  `+ `, or `1. ` create unordered or numbered lists. Headings accept Markdown-style prefixes
  too: start one with `# ` through `###### ` to switch its level and remove the prefix. The
  block editing workflow stays the same — Markdown is compatibility, not a replacement.
- **Outline** — on wide screens a right-hand sidebar lists every non-empty heading in document
  order, indented by level. Select an entry to scroll to the heading and focus it. Hide the
  outline when you need more room; a small edge control brings it back.
- **Collapsible sidebars** — the notes sidebar can be tucked into a narrow rail that keeps the
  app mark and an expand control visible. The outline behaves the same way, and both edges slide
  smoothly between states. Both preferences are remembered locally.
- **Floating status** — a pill at the bottom of a note repeats the last-edit time and word
  count from the note header, so they stay visible while writing.
- **Text columns** — split a text block into up to four side-by-side columns from the
  columns menu beside the block. Lowering the count hides extra columns without deleting
  their text; on narrow screens multiple columns stack vertically. `Enter` splits only the
  active column, leaving the other columns in the original block.
- **Image columns** — an image block can hold up to four columns. Every column, including the
  first, can be switched between writing and a picture. Lowering the count hides columns without
  deleting their text or pictures, and narrow screens stack the columns vertically.
- **Images** — drag a file onto an image block, browse for one, or paste an image URL.
  Large photos are scaled and re-encoded before they are stored. Use the replace control on a
  picture to swap just the image while keeping its block or column and caption, or the remove
  control to clear the picture and leave the block ready for another. You can also paste an
  image from the clipboard with `Ctrl`/`⌘` + `V` while editing; pasting into an image column
  replaces that column's picture, while pasting into a text column turns it into an image.
  Pasting into a text, heading, or list block inserts the image after that block.
- **Drag & drop** — use the grip beside any block to move it up or down. Blocks can also be
  moved with `↑` / `↓` while the grip is focused.
- **Local-first** — notes, images, and the selected note are saved to `localStorage`.
  There is no backend and no account. A small “Saved locally” pill in the sidebar confirms
  storage, and turns into a warning if the quota fills up.
- **Responsive** — a two-column writing surface plus the outline on wide desktops, and an
  off-canvas notes drawer on small screens.
- **Themes** — light and dark palettes with pastel indigo accents follow the operating system
  preference.

Keyboard details: `Enter` in a text block or heading starts a new text block, `Shift+Enter` adds
a line break, `Enter` in a list creates a new list item, `Backspace` in an empty item removes it,
and `Escape` closes the block menu, the icon picker, the columns/heading menu, an inline
sub-note's add menu, or the mobile notes drawer.

## Stack

- Angular 22, standalone components, zoneless change detection, signals
- Angular CDK drag & drop
- KaTeX for math rendering and highlight.js for code syntax highlighting
- SCSS with CSS custom properties for theming
- Self-hosted Newsreader (writing) and Inter (interface) variable fonts

## Running it

```bash
npm install
npm start
```

Open `http://localhost:4200/`.

```bash
npm run build   # production build in dist/the-noter/browser
```

## Structure

```
src/app/
  app.ts                    app shell, sidebar drawer, empty state
  note-store.ts             signal store, note tree + localStorage persistence
  models.ts                 note/block types and factories
  markdown.ts               inline links/code and fenced-code parsing
  latex.ts                  LaTeX detection and delimiter stripping
  image.ts                  image reading, scaling, and compression
  format.ts                 relative time and word count helpers
  notes-sidebar/            nested note tree, search, delete confirmation
  note-editor/              cover, icon, title, metadata, sub-notes, block list
  note-block/               text, heading, list, image, code, and function editors
  note-block/image-column/  one image-block column (writing or picture)
  subnote-block/            an inline child note embedded in the parent's block flow
  note-outline/             right-hand heading hierarchy
  ui/                       icon set, inline Markdown preview, code highlight, LaTeX, autosize, focus helper
```

Notes are stored under `the-noter.notes.v1` in `localStorage`; selected-note and sidebar
visibility preferences use `the-noter.selection.v1`, `the-noter.ui.notes-visible`, and
`the-noter.ui.outline-visible`. Clearing site data resets the app. The app is a front-end
demonstration; images encoded as data URLs share the browser's localStorage quota (usually
around 5 MB).
