# The Noter

A small, quiet note-taking interface built with Angular 22. Notes are made of a title,
visible custom metadata, and a stack of content blocks that can be rearranged by dragging.

## What it does

- **Notes** — create, rename, search, and delete notes. Notes are sorted by the last edit.
- **Visible metadata** — add any number of `label → value` pairs to a note. Values accept
  inline time helpers resolved on `Enter` or blur: `now()` inserts the current date and time,
  `today()` the date, and `time()` the time. Use `now(iso)`, `now(unix)`, or a pattern such as
  `now(YYYY-MM-DD HH:mm)` for other formats.
- **Composable blocks** — text, headings, bulleted/numbered lists, and images. Use the block-type
  button beside a block to switch between them at any time; writing carries over as a heading,
  list items, or text columns. Pressing `Enter` in a text block splits it at the caret and starts
  a new text block; `Shift+Enter` adds a line break inside the block.
- **Headings H1–H6** — each heading has its own level, chosen from the heading menu beside
  the block. Levels render at descending sizes and can be changed at any time. Headings also
  accept Markdown-style prefixes: start one with `# ` through `###### ` to switch its level
  and remove the prefix.
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
  Large photos are scaled and re-encoded before they are stored. You can also paste an image
  from the clipboard with `Ctrl`/`⌘` + `V` while editing; pasting into an image column
  replaces that column's picture, while pasting into a text column turns it into an image.
  Pasting into a text, heading, or list block inserts the image after that block.
- **Drag & drop** — use the grip beside any block to move it up or down. Blocks can also be
  moved with `↑` / `↓` while the grip is focused.
- **Local-first** — notes, images, and the selected note are saved to `localStorage`.
  There is no backend and no account. A small “Saved locally” pill in the sidebar confirms
  storage, and turns into a warning if the quota fills up.
- **Responsive** — a two-column writing surface plus the outline on wide desktops, and an
  off-canvas notes drawer on small screens.
- **Themes** — light and dark palettes follow the operating system preference.

Keyboard details: `Enter` in a text block starts a new text block, `Shift+Enter` adds a line
break, `Enter` in a list creates a new list item, `Backspace` in an empty item removes it,
and `Escape` closes the block menu, the columns/heading menu, or the mobile notes drawer.

## Stack

- Angular 22, standalone components, zoneless change detection, signals
- Angular CDK drag & drop
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
  note-store.ts             signal store + localStorage persistence
  models.ts                 note/block types and factories
  image.ts                  image reading, scaling, and compression
  format.ts                 relative time and word count helpers
  notes-sidebar/            note list, search, delete confirmation
  note-editor/              title, metadata, block list, add-block menu
  note-block/               text, heading, list, and image block editors
  note-block/image-column/  one image-block column (writing or picture)
  note-outline/             right-hand heading hierarchy
  ui/                       icon set, autosize textarea, focus helper
```

Notes are stored under `the-noter.notes.v1` in `localStorage`; selected-note and sidebar
visibility preferences use `the-noter.selection.v1`, `the-noter.ui.notes-visible`, and
`the-noter.ui.outline-visible`. Clearing site data resets the app. The app is a front-end
demonstration; images encoded as data URLs share the browser's localStorage quota (usually
around 5 MB).
