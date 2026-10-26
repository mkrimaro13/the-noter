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
const LATEX_HINT = /\\([a-zA-Z]+)|\$[^$]+\$|\^|_\{|_\[|=/;

export function looksLikeLatex(value: string): boolean {
  return value.trim().length > 0 && LATEX_HINT.test(value);
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
