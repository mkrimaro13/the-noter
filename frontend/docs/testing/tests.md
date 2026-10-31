# Frontend unit tests

Status: active
Runner: Angular `@angular/build:unit-test` with Vitest
DOM: jsdom
Location: `frontend/src/**/*.spec.ts`

## Why this setup

The frontend is a standalone Angular application with signals, effects, and
local-first behaviour. The tests need to exercise real templates and real store
logic without a browser or a sync server.

- **Angular's unit-test builder** keeps the test target inside `angular.json`,
  so `ng test` uses the same compiler, TypeScript configuration, and asset
  pipeline as the application.
- **Vitest** provides a fast watch mode, `vi.fn()` spies, fake timers, and
  `vi.waitFor()` for asynchronous effects. Angular 22's builder runs Vitest for
  us; there is no separate Vitest config file to maintain.
- **jsdom** gives the specs a DOM for templates, focus, `FileReader`, and
  `localStorage`. It is the builder's default when no `browsers` option is set.
- **Real components over shallow mocks.** Template behaviour, bindings, and
  event wiring are part of the product. The tests create components through
  `TestBed` and interact with the rendered DOM.

## Running the tests

From `frontend/`:

```bash
npm test                 # single run (ng test --watch=false)
npm run test:watch       # watch mode
npm run test:coverage    # single run with V8 coverage
npm run build            # production build check
```

The suite currently contains **302 tests across 20 spec files**.

## Coverage

`npm run test:coverage` runs the same suite with V8 coverage. The current
result is:

| Metric     | Coverage |
| ---------- | -------: |
| Statements |   96.08% |
| Branches   |   90.26% |
| Functions  |   93.94% |
| Lines      |   97.73% |

Every metric is above the project's 80% minimum and the 90% target. The report
is written to `frontend/coverage/`, which is ignored by git.

## Shared setup

`src/test-setup.ts` is loaded before every spec through the `setupFiles` option.
It provides only the browser APIs jsdom does not implement:

- clears `localStorage` before each test so note, selection, sync, and layout
  state never leaks between specs;
- defines `window.matchMedia` when missing;
- defines a no-op `ResizeObserver`;
- defines `Element.prototype.scrollIntoView`.

`tsconfig.spec.json` includes the spec files, `test-setup.ts`, and the
`vitest/globals` types.

## What is tested and why

### Pure logic

| Spec                       | Tests | Coverage and rationale                                                                                                                                                                                                                                                              |
| -------------------------- | ----: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/latex.spec.ts`    |    17 | Math detection, delimiter stripping, full-document bodies, `\\[2ex]` row spacing, starred commands, `tabular`/`tabular*`/`tabularx`, width columns, `\\cline` fallback, wrappers, and `multline`/`eqnarray`. These are the failure modes that produced blank or corrupted previews. |
| `src/app/markdown.spec.ts` |    19 | Inline code/links/URLs, safe href filtering, fences, the `$$`, code-fence, and `#>` shortcuts, heading and list prefixes, and block-shortcut parsing. Keeps the deliberately small Markdown subset predictable.                                                                     |
| `src/app/models.spec.ts`   |    28 | Factories, text/image column visibility, plain-text extraction, block conversion, note creation, and the block menu. The store and every editor depend on these shapes.                                                                                                             |
| `src/app/format.spec.ts`   |    12 | Relative times, block labels, word counts, and `now()`/`today()`/`time()` expansion. Metadata values must resolve deterministically.                                                                                                                                                |
| `src/app/image.spec.ts`    |     8 | File validation, small-file passthrough, SVG/GIF handling, canvas downscaling, and fallbacks. Notes store images in `localStorage`, so size behaviour matters.                                                                                                                      |

### State and sync

| Spec                         | Tests | Coverage and rationale                                                                                                                                                                                                                                                                                                                                              |
| ---------------------------- | ----: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/note-store.spec.ts` |    52 | Note creation, tree building, cycle breaking, search (including image columns), selection, metadata, block editing, column bounds, splits, reordering, deletion/reparenting, persistence debounce, storage failures, stored-data normalization, remote apply/deletes/conflict copies, and unload flushing. Uses a fake `SyncService` so no request leaves the test. |
| `src/app/sync.spec.ts`       |    30 | Disabled/offline/error states, dirty/removed queues, state validation, scheduling, push/pull, remote apply/tombstones, conflicts and conflict copies, malformed responses, pending local edits, and authentication failure. Uses a routed `fetch` mock with fake responses.                                                                                         |

### Components

| Spec                                                   | Tests | Coverage and rationale                                                                                                                                                                                                                               |
| ------------------------------------------------------ | ----: | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/app/note-block/note-block.spec.ts`                |    24 | Text/heading/list/image/code/function rendering, column edits, fences, extended and Markdown shortcuts, Enter splitting, list editing, image-column routing, math toggle, type/column/heading menus, menu dismissal/focus, reordering, and deletion. |
| `src/app/note-block/image-column/image-column.spec.ts` |    13 | Text/image switching, captions, removal, browsing/replacing, dropped images, broken-image state, URL entry, drag-over state, focus reporting, markup previews, and non-image errors.                                                                 |
| `src/app/note-editor/note-editor.spec.ts`              |    27 | Title and metadata editing, time-function commit, block menu, sub-note creation, child cards, breadcrumbs, icon menu, cover browse/replace/drop, block wiring, splitting/type conversion, focus restore, clipboard fallbacks, and image paste.       |
| `src/app/notes-sidebar/notes-sidebar.spec.ts`          |    10 | Nested rows, search/filter/clear, selection, root/child creation, collapse/expand, delete confirmation, sync/storage labels, rail collapse, and empty states.                                                                                        |
| `src/app/subnote-block/subnote-block.spec.ts`          |    18 | Inline child title, block/column edits, opening the child, adding blocks, splitting, fences, shortcuts, nested sub-notes, deletion, missing-child state, menu dismissal/focus, reordering, and depth.                                                |
| `src/app/note-outline/note-outline.spec.ts`            |     5 | Heading extraction, inline-markup stripping, indentation, selection, collapse, and empty state.                                                                                                                                                      |
| `src/app/app.spec.ts`                                  |    11 | Empty state, first-note creation, document title, mobile sidebar, layout preferences, outline overlay/Escape, media-query changes, storage-read fallback, and the shortcut cheat sheet.                                                              |
| `src/app/ui/latex.spec.ts`                             |     8 | Real KaTeX rendering, full documents, repeated `\newcommand`, safe links, blocked `javascript:` links, blocked images/HTML extensions, empty sources, and tables with partial rules.                                                                 |
| `src/app/ui/markdown-inline.spec.ts`                   |     4 | Plain text, inline code, safe links, and unsafe-link fallback.                                                                                                                                                                                       |
| `src/app/ui/highlight.spec.ts`                         |     5 | HTML escaping, known languages, auto-detection, and component rendering.                                                                                                                                                                             |
| `src/app/ui/icon.spec.ts`                              |     4 | Default and explicit sizes, stroke width, per-name paths, and unknown names.                                                                                                                                                                         |
| `src/app/ui/autosize.spec.ts`                          |     2 | Initial sizing plus the font-settle resize, including detached textareas.                                                                                                                                                                            |
| `src/app/ui/focus.spec.ts`                             |     5 | Focus gating, one-shot focus, caret offset, `appFocusDone`, and detached elements.                                                                                                                                                                   |

## Test design decisions

- **No network.** `NoteStore` specs provide a fake `SyncService`. `SyncService`
  specs replace `fetch` with a router that returns realistic CouchDB-shaped
  responses.
- **Real store where it matters.** Component specs inject the real `NoteStore`
  with a fake `SyncService`; this exercises signals, normalization, and
  persistence without duplicating store logic in mocks.
- **Deterministic time.** Debounce and `setTimeout` paths use Vitest fake timers.
  `vi.waitFor()` is used for real asynchronous work such as FileReader, KaTeX
  loading, and image decoding.
- **DOM-level assertions.** Tests click buttons and dispatch `input`,
  `keydown`, `change`, `drag`, and `paste` events instead of calling protected
  methods, so template wiring is covered too.
- **Security assertions.** KaTeX specs check the rendered DOM for anchors and
  images rather than comparing HTML strings; KaTeX error output contains the
  original source text.
- **No visual snapshots.** Styling is not asserted. Layout behaviour is checked
  through classes, attributes, and emitted events.

## Adding a spec

1. Create `*.spec.ts` next to the file under test.
2. Import `describe`, `expect`, `it`, and `vi` from `vitest`.
3. Use `TestBed.createComponent()` for components and
   `TestBed.inject()` for services.
4. Call `TestBed.resetTestingModule()` in `afterEach` when the spec configures
   providers.
5. Run `npm test` from `frontend/`.

## Out of scope

- End-to-end browser flows and visual regression testing.
- A live CouchDB server. Sync request/response shapes are covered with mocks.
- Backend tests; this document covers the frontend only.
