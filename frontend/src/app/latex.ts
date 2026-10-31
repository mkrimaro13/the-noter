/**
 * Helpers for the LaTeX side of function blocks. Notes stay stored as plain
 * text; math is only a rendering choice, so these helpers never change the
 * underlying writing.
 */

/**
 * True when the writing uses math syntax rather than a plain function
 * signature. A single `=` is enough so `E = mc^2` and `x = 1` render as math,
 * while `formatDate(date, pattern)` stays plain.
 */
const LATEX_HINT = /\\([a-zA-Z]+)|\$\$|\$[^$\n]+\$|\\\(|\\\[|\^|_[A-Za-z0-9{\[]/;

export function looksLikeLatex(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (LATEX_HINT.test(trimmed)) return true;

  // A bare `&` (R&D) or a bare `\\` (a Windows path) is not enough. Alignment
  // syntax needs both the column separator and the row break.
  return trimmed.includes('&') && /\\\\/.test(trimmed);
}

/**
 * Removes one pair of surrounding math delimiters (`$$…$$`, `$…$`, `\[…\]`,
 * `\(…\)`) so KaTeX receives the expression itself. Anything else is trimmed
 * and passed through unchanged.
 */
export function stripMathDelimiters(value: string): string {
  const trimmed = value.trim();

  if (trimmed.length > 4 && trimmed.startsWith('$$') && trimmed.endsWith('$$')) {
    return trimmed.slice(2, -2).trim();
  }
  if (trimmed.length > 2 && trimmed.startsWith('$') && trimmed.endsWith('$')) {
    return trimmed.slice(1, -1).trim();
  }
  if (trimmed.startsWith('\\[') && trimmed.endsWith('\\]')) {
    return trimmed.slice(2, -2).trim();
  }
  if (trimmed.startsWith('\\(') && trimmed.endsWith('\\)')) {
    return trimmed.slice(2, -2).trim();
  }

  return trimmed;
}

const PREAMBLE_COMMANDS = [
  /\\documentclass\s*(?:\[[^\]]*\])?\s*\{[^{}]*\}/g,
  /\\usepackage\s*(?:\[[^\]]*\])?\s*\{[^{}]*\}/g,
  /\\title\s*\{[^{}]*\}/g,
  /\\author\s*\{[^{}]*\}/g,
  /\\date\s*\{[^{}]*\}/g,
  /\\maketitle\b/g,
  /\\tableofcontents\b/g,
  /\\newpage\b/g,
  /\\clearpage\b/g,
  /\\pagestyle\s*\{[^{}]*\}/g,
];

/**
 * Converts common LaTeX document and table syntax into the subset KaTeX can
 * render. The input is still stored as typed; only the preview is normalized.
 */
export function normalizeLatex(source: string): string {
  let value = source;

  // A pasted document should keep its body. Remove the preamble commands and
  // the two wrapper tokens, never everything from `\begin{document}` onwards.
  for (const command of PREAMBLE_COMMANDS) {
    value = value.replace(command, '');
  }
  value = value.replace(/\\begin\{document\}/gi, '');
  value = value.replace(/\\end\{document\}/gi, '');

  // Delimiters that survived stripMathDelimiters. The lookbehind keeps the
  // `\[` in `\\[2ex]` (row spacing) intact. Inline delimiters are removed
  // rather than turned into `$`, which is a literal symbol in display math.
  value = value.replace(/(?<!\\)\\\[/g, '');
  value = value.replace(/(?<!\\)\\\]/g, '');
  value = value.replace(/(?<!\\)\\\(/g, '');
  value = value.replace(/(?<!\\)\\\)/g, '');

  // KaTeX supports the unstarred command but not the starred form.
  value = value.replace(/\\newcommand\*\{/g, '\\newcommand{');
  value = value.replace(/\\renewcommand\*\{/g, '\\renewcommand{');
  value = value.replace(/\\providecommand\*\{/g, '\\providecommand{');

  value = normalizeTabular(value);

  // Wrappers KaTeX does not understand. Removing them keeps the contents.
  value = value.replace(/\\begin\{table\*?\}(?:\[[^\]]*\])?/g, '');
  value = value.replace(/\\end\{table\*?\}/g, '');
  value = value.replace(/\\begin\{figure\*?\}(?:\[[^\]]*\])?/g, '');
  value = value.replace(/\\end\{figure\*?\}/g, '');
  value = value.replace(/\\begin\{(?:center|flushleft|flushright|abstract)\}/g, '');
  value = value.replace(/\\end\{(?:center|flushleft|flushright|abstract)\}/g, '');
  value = value.replace(/\\begin\{displaymath\}/g, '');
  value = value.replace(/\\end\{displaymath\}/g, '');
  value = value.replace(/\\begin\{math\}/g, '');
  value = value.replace(/\\end\{math\}/g, '');
  value = value.replace(/\\centering\b/g, '');
  value = value.replace(/\\captionof\s*\{[^{}]*\}\s*\{[^{}]*\}/g, '');
  value = value.replace(/\\caption(?:\[[^\]]*\])?\s*\{[^{}]*\}/g, '');
  value = value.replace(/\\label\s*\{[^{}]*\}/g, '');

  // KaTeX supports gather/align, but not multline or eqnarray.
  value = value.replace(/\\begin\{multline\*\}/g, '\\begin{aligned}');
  value = value.replace(/\\end\{multline\*\}/g, '\\end{aligned}');
  value = value.replace(/\\begin\{multline\}/g, '\\begin{aligned}');
  value = value.replace(/\\end\{multline\}/g, '\\end{aligned}');
  value = value.replace(/\\begin\{eqnarray\*\}/g, '\\begin{aligned}');
  value = value.replace(/\\end\{eqnarray\*\}/g, '\\end{aligned}');
  value = value.replace(/\\begin\{eqnarray\}/g, '\\begin{aligned}');
  value = value.replace(/\\end\{eqnarray\}/g, '\\end{aligned}');

  return value.trim();
}

function normalizeTabular(source: string): string {
  let value = source;

  // tabular* takes a width argument before the optional position and columns.
  value = value.replace(
    /\\begin\{tabular\*\}(\s*)\{([^{}]*)\}(\s*(?:\[[^\]]*\])?)(\s*)\{((?:[^{}]|\{[^{}]*\})*)\}/g,
    (_match, _widthSpace, _width, _position, columnSpace, columns: string) =>
      `\\begin{array}${columnSpace}{${normalizeColumnSpec(columns)}}`,
  );
  // tabularx takes a width argument before the columns.
  value = value.replace(
    /\\begin\{tabularx\}(\s*)\{([^{}]*)\}(\s*)\{((?:[^{}]|\{[^{}]*\})*)\}/g,
    (_match, _widthSpace, _width, columnSpace, columns: string) =>
      `\\begin{array}${columnSpace}{${normalizeColumnSpec(columns)}}`,
  );
  // Plain tabular has an optional position followed by the columns.
  value = value.replace(
    /\\begin\{tabular\}(\s*(?:\[[^\]]*\])?)(\s*)\{((?:[^{}]|\{[^{}]*\})*)\}/g,
    (_match, _position, columnSpace, columns: string) =>
      `\\begin{array}${columnSpace}{${normalizeColumnSpec(columns)}}`,
  );

  value = value.replace(/\\end\{tabular\*?\}/g, '\\end{array}');
  value = value.replace(/\\end\{tabularx\}/g, '\\end{array}');

  // User-provided arrays can carry the same unsupported column specs.
  value = value.replace(
    /\\begin\{array\}(\s*)\{((?:[^{}]|\{[^{}]*\})*)\}/g,
    (_match, columnSpace, columns: string) =>
      `\\begin{array}${columnSpace}{${normalizeColumnSpec(columns)}}`,
  );

  return value;
}

function normalizeColumnSpec(columns: string): string {
  // KaTeX's array only needs simple alignment columns. Width-based columns
  // (`p`, `m`, `b`) and tabularx's flexible `X` become left-aligned columns.
  return columns.replace(/[pmb]\{[^{}]*\}/g, 'l').replace(/X/g, 'l');
}
