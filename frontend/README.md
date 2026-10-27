# The Noter — frontend

A small, quiet note-taking interface built with Angular 22. Notes are made of a title,
visible custom metadata, and a stack of content blocks that can be rearranged by dragging.

This folder is the Angular app of the monorepo. The repository root holds the Compose stack and the
`backend/` folder with the CouchDB service. See the [root README](../README.md) for the full layout.

## Current state

- Every feature below is implemented and covered by Playwright tests.
- Persistence is **`localStorage` first**: notes are written as one JSON array under
  `the-noter.notes.v1` after a 250 ms debounce. Images are data URLs inside that array.
- After that local write, the app syncs changed notes to a self-hosted CouchDB database. There is no
  account or login screen: the app uses one restricted database user.
- Sync is optional. Without a valid `/sync-config.json` the app is a purely offline notebook.
- The localStorage quota (around 5 MB) is still the main limitation, because images remain inline
  data URLs. Moving images to CouchDB attachments and the store to IndexedDB are later milestones.

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
- **Local-first** — notes, images, and the selected note are saved to `localStorage` before any
  network request. A small pill in the sidebar confirms storage and reports sync state; it turns
  into a warning if the quota fills up. See [Sync](#sync) below.
- **Responsive** — a two-column writing surface plus the outline on wide desktops, and an
  off-canvas notes drawer on small screens.
- **Themes** — light and dark palettes with pastel indigo accents follow the operating system
  preference.

Keyboard details: `Enter` in a text block or heading starts a new text block, `Shift+Enter` adds
a line break, `Enter` in a list creates a new list item, `Backspace` in an empty item removes it,
and `Escape` closes the block menu, the icon picker, the columns/heading menu, an inline
sub-note's add menu, or the mobile notes drawer.

## Sync

Sync is implemented in `src/app/sync.ts` with plain `fetch` calls against the CouchDB HTTP API.
There is no PouchDB or service worker in the loop.

### Write order

1. A store mutation updates the signal and marks the note id dirty.
2. The 250 ms debounce writes the **whole notes array to `localStorage`**.
3. Only then does `NoteStore.persist()` call `SyncService.notifyPersisted()`, which starts a push
   after a short delay.

If the server is down, steps 1–2 still succeed and the note ids stay in a persisted queue. The app
never waits for the network to accept an edit.

### Push and pull

- **Push** — `POST /_bulk_docs` with one document per changed note (`_id: "note:<id>"`) and the last
  known `_rev`. Deletions are sent as `_deleted: true` tombstones.
- **Pull** — `GET /_changes?since=<cursor>&include_docs=true&conflicts=true`. The cursor (`last_seq`)
  and every known `_rev` are persisted, so only new changes are fetched.
- A note is written to `localStorage` only when the incoming `updatedAt` is not older than the local
  one. Local timestamps are kept monotonic so two edits in the same millisecond still compare
  correctly.
- Remote tombstones remove the local note. A local note that is still dirty or deleted is not
  resurrected or removed by a stale pull.

### Conflicts

If CouchDB rejects a push with `409`, the app reads the current server version, saves it as a new
note titled `Title (conflict YYYY-MM-DD HH:mm)`, and retries the local edit against the new
revision. Both texts survive.

Server-side conflicts (`_conflicts` on a pulled document) are resolved the same way: the losing
revision is copied into a new note, and the copy plus the winning note are written to
`localStorage` first. Only after that does the app delete the losing revision on the server, so a
crash cannot lose the losing text. The conflict copy is then pushed as its own document.

### Offline behavior and status

Network failures (server unreachable or a timeout) move the pill to **Offline** and schedule a retry
after 5 seconds, doubling up to 60 seconds. Credential, CORS, or other CouchDB errors show **Sync
error** instead. Sync also runs when the browser fires `online`, when the tab becomes visible, and
every 30 seconds while the tab is visible. There is no manual button.

The pill reports storage first and then the sync state. It starts with **Saved locally** except when
the local write itself failed:

| Label                        | Meaning                                                     |
| ---------------------------- | ----------------------------------------------------------- |
| `Saved locally`              | Stored in this browser; sync disabled or waiting to start   |
| `Saved locally · Syncing…`   | A push or pull is in progress                               |
| `Saved locally · Synced`     | Local and server copies are up to date                      |
| `Saved locally · Offline`    | Server unreachable; changes are queued and retried          |
| `Saved locally · Sync error` | Credentials, CORS, or a CouchDB error; see the pill tooltip |
| `Not saved`                  | `localStorage` write failed (usually the quota)             |

### Configuration

The app fetches `/sync-config.json` at startup with `cache: 'no-store'`. The file has this shape:

```json
{
  "enabled": true,
  "url": "http://127.0.0.1:5984/thenoter",
  "username": "thenoter",
  "password": "…"
}
```

- In development, `npm start` runs `scripts/write-sync-config.mjs`, which builds this file in
  `frontend/public/` from the repository root `.env`.
- In the container, `docker-entrypoint.d/40-sync-config.sh` writes it from the Compose environment.
  The admin credentials are never included.
- A missing file, `{"enabled":false}`, or an invalid entry leaves sync disabled.
- For automation, set `localStorage['the-noter.sync.disabled'] = '1'` before the app loads. This takes
  precedence over the config file and keeps test runs out of the database.

The app password is present in the browser by design, because the browser talks to CouchDB
directly. It is a restricted user limited to the `thenoter` database, and the app is localhost-only
for now. Remote access will need a better credential story than a static password in a JSON file.

## Stack

- Angular 22, standalone components, zoneless change detection, signals
- Angular CDK drag & drop
- KaTeX for math rendering and highlight.js for code syntax highlighting
- SCSS with CSS custom properties for theming
- Self-hosted Newsreader (writing) and Inter (interface) variable fonts

## Running it

From this folder:

```bash
npm install
npm start
```

Open `http://localhost:4200/`.

`npm start` regenerates `public/sync-config.json` from the repository root `.env`. To have sync in
development, create the root `.env` first and start the database:

```bash
# from the repository root, in another terminal
docker compose up -d backend init
```

Without a root `.env` the generated config is `{"enabled":false}` and the app runs offline-only.
`frontend/public/sync-config.json` is git-ignored.

```bash
npm run build   # production build in dist/the-noter/browser
npx prettier --check .
```

From the repository root, the container build serves the same production output on
`http://127.0.0.1:8080`:

```bash
docker compose up -d --build frontend
```

The container entrypoint writes `/sync-config.json` from `SYNC_URL`, `SYNC_USER`, and
`SYNC_PASSWORD`; nginx serves it with `no-store`.

## Structure

```
src/app/
  app.ts                    app shell, sidebar drawer, empty state
  note-store.ts             signal store, note tree, localStorage persistence
  sync.ts                   local-first push/pull sync, conflicts, retries
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
`the-noter.ui.outline-visible`. Sync bookkeeping lives in `the-noter.sync.v1` (cursor, known
revisions, and the dirty/deleted queues); `the-noter.sync.disabled` turns sync off.

Clearing site data resets the app, but it also removes the sync cursor. On the next start the app
treats the server as the source of truth for existing notes; anything still in `localStorage` is
pushed first. Images are encoded as data URLs and share the browser's localStorage quota (usually
around 5 MB), which is why moving them to CouchDB attachments and the store to IndexedDB are the next
storage steps.

See [../backend/REPLICATION.md](../backend/REPLICATION.md) for the wire protocol, document shape,
and conflict rules.
