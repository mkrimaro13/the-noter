# LaTeX Implementation Action Plan

Status: complete
Owner: frontend
Scope: `frontend/src/app/latex.ts`, `frontend/src/app/ui/latex.ts`,
`frontend/src/app/markdown.ts`, `frontend/src/app/note-block/note-block.ts`, tests and docs.

## Goal

Make the LaTeX path safe and predictable for pasted fragments and complete
documents, then cover the frontend with unit tests and document the test setup.

## Findings to address

| #   | Finding                                                                                                    | Severity | Resolution                                                                                                                     |
| --- | ---------------------------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Full documents render blank because `\begin{document}...` is deleted to EOF.                               | Blocker  | Remove only the `\begin{document}` / `\end{document}` wrapper tokens.                                                          |
| 2   | `\[` / `\]` removal corrupts `\\[2ex]`; `\(` / `\)` become literal `$` in display math.                    | Blocker  | Strip delimiters without matching escaped line-break spacing; remove inline delimiters instead of converting them.             |
| 3   | `globalGroup: true` leaks `\newcommand` definitions and makes a second render fail.                        | Blocker  | Use KaTeX's default per-render group and keep `COMMON_MACROS` immutable per render.                                            |
| 4   | `trust: true` + `bypassSecurityTrustHtml` allows `javascript:` links and HTML extensions.                  | Security | Use a trust callback that allows only `http`, `https`, `mailto`, and relative URLs for `\href` / `\url`; deny everything else. |
| 5   | Table/figure normalization is partial (`\caption`, `\centering`, `\label`, `tabular*`, `tabularx`, `p{}`). | Major    | Normalize wrappers and column specs before handing source to KaTeX.                                                            |
| 6   | Pasting `$$...$$` leaves a trailing `$$` in the function block.                                            | Major    | Strip the closing `$$` when the `$$` block shortcut captures a balanced expression.                                            |
| 7   | Detection misses `x_1` and treats `&` / `\\` as math hints by themselves.                                  | Minor    | Detect single-character subscripts and require `&` + `\\` together for the bare alignment hint.                                |
| 8   | No automated tests or test target.                                                                         | Major    | Add Angular's Vitest unit-test target and specs for the frontend.                                                              |

## Work items

### 1. LaTeX normalization

- [x] Move pure normalization into `frontend/src/app/latex.ts` so it can be tested directly.
- [x] Preserve full-document bodies while removing preamble commands.
- [x] Remove `\begin{document}` / `\end{document}` tokens only.
- [x] Strip `\[`, `\]`, `\(`, `\)` only when they are actual delimiters.
- [x] Keep `\\[2ex]`-style row spacing intact.
- [x] Normalize `\newcommand*`, `\renewcommand*`, and `\providecommand*`.
- [x] Convert `tabular`, `tabular*`, and `tabularx` to KaTeX `array`.
- [x] Normalize `p{}` / `m{}` / `b{}` / `X` column specs to `l`.
- [x] Remove `table`, `figure`, `center`, `flushleft`, and `flushright` wrappers.
- [x] Remove `\centering`, `\caption`, `\captionof`, and `\label`.
- [x] Convert `multline` and `eqnarray` to `aligned`; leave `gather`/`align` alone (KaTeX supports them).

### 2. KaTeX rendering

- [x] Remove `globalGroup: true`.
- [x] Keep the shared macro table free of per-note definitions.
- [x] Replace `trust: true` with a protocol allow-list callback.
- [x] Keep `throwOnError: false` so invalid input still shows a visible KaTeX error.
- [x] Keep the async render token so older renders cannot overwrite newer ones.

### 3. Block shortcuts and detection

- [x] Strip a balanced closing `$$` in `readExtendedBlockShortcut`.
- [x] Detect `x_1`-style subscripts.
- [x] Stop treating a lone `&` or lone `\\` as sufficient math evidence.
- [x] Keep `$$` / ` ` `` / `#>` shortcuts working for single-column text blocks.

### 4. Unit testing

- [x] Add a `test` target to `frontend/angular.json` using `@angular/build:unit-test`.
- [x] Add `test`, `test:watch`, and `test:coverage` scripts to `frontend/package.json`.
- [x] Add Vitest and jsdom as dev dependencies.
- [x] Add pure unit tests for `latex.ts`, `markdown.ts`, `models.ts`, and `format.ts`.
- [x] Add store/service tests for `note-store.ts` and `sync.ts`.
- [x] Add component smoke/interaction tests for the app shell, editor, blocks, sidebar, outline, and UI components.
- [x] Add KaTeX rendering tests for safe links, blocked `javascript:` links, full documents, and re-rendered `\newcommand`.
- [x] Keep tests deterministic: fake timers where needed, clear `localStorage`, and mock `fetch`.

### 5. Documentation

- [x] Write `frontend/docs/testing/tests.md` explaining the runner, DOM environment, coverage, what is tested, and why.
- [x] Record how to run the suite and how to add a new spec.

## Acceptance criteria

- A full document such as `\documentclass{article}\begin{document}E=mc^2\end{document}` renders `E=mc^2`, not an empty preview.
- `a \\[2ex] b` renders as two rows with spacing, not as `a \2ex] b`.
- `\newcommand{\R}{\mathbb{R}} \R` renders on the first and every later render.
- `\href{javascript:alert(1)}{x}` does not produce a `javascript:` anchor.
- `\href{https://example.com}{x}` still produces a link.
- Pasting `$$E=mc^2$$` into a text block produces a function block with text `E=mc^2`.
- `x_1` is detected as math; `AT&T` is not.
- `npm test -- --watch=false` passes.
- `npm run build` passes.

## Verification

```bash
cd frontend
npm install
npm test -- --watch=false
npm run test:coverage -- --watch=false
npm run build
```

## Risks and decisions

- **Security first:** HTML extensions and image inclusion stay disabled. Notes can
  sync from CouchDB, so math input must not be able to create executable links.
- **Compatibility over completeness:** unsupported LaTeX wrappers are removed or
  converted where a safe KaTeX equivalent exists. Commands with no equivalent
  remain visible as KaTeX errors instead of being silently dropped.
- **No global macro state:** each render is isolated. Users who need reusable
  macros should define them inside the block that uses them.
