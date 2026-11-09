/**
 * A deliberately small Markdown-compatible layer. It understands the inline
 * pieces that are useful while writing notes — code, links, bold, italic, and
 * strikethrough — plus a fenced-code shortcut that promotes a text block into a
 * code block. Everything else stays plain text so the existing block editor
 * remains predictable.
 */
export type InlineMark = 'bold' | 'italic' | 'strike';

export type InlineToken =
  | { kind: 'text'; text: string; marks?: InlineMark[] }
  | { kind: 'code'; text: string; marks?: InlineMark[] }
  | { kind: 'link'; text: string; href: string; marks?: InlineMark[] };

export interface FenceShortcut {
  language: string;
  text: string;
}

interface Delimiter {
  mark: InlineMark;
  delimiter: string;
  length: number;
}

const LINK_PATTERN = /^\[([^\]\n]+)\]\(([^)\s]+)\)/;
const BARE_URL_PATTERN = /^https?:\/\/[^\s<>()`]+/;
const ESCAPABLE = new Set(['\\', '`', '*', '_', '~', '[', ']', '(', ')', '$']);
const WORD_CHAR = /[\p{L}\p{N}_]/u;

/** A Markdown block prefix typed at the start of a text block. */
export type MarkdownBlockShortcut =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] };

const FENCE_LINE = /^```([A-Za-z0-9_+.#-]*)[ \t]*$/;
const CLOSING_FENCE = /^```[ \t]*$/;
const TRAILING_PUNCTUATION = /^(.*?)([.,;:!?]+)$/;
const HEADING_PREFIX = /^(#{1,6})[ \t]+(.*)$/;
const UNORDERED_LIST_PREFIX = /^[-*+][ \t]+(.*)$/;
const ORDERED_LIST_PREFIX = /^\d{1,9}[.)][ \t]+(.*)$/;
const FUNCTION_SHORTCUT = /^\$\$[ \t]*(.*)$/s;
const CODE_SHORTCUT = /^``[ \t]*(.*)$/s;
const SUBPAGE_SHORTCUT = /^#>[ \t]*(.*)$/s;

/**
 * Splits writing into text, inline-code, and link tokens for safe rendering.
 * Bold (`**`/`__`), italic (`*`/`_`), and strikethrough (`~~`) marks are
 * recorded on the token instead of wrapping it in HTML. Backslash escapes keep
 * the following punctuation literal.
 */
export function parseInline(value: string): InlineToken[] {
  return parseSegment(value, []);
}

/** True when a rendered preview would show anything besides plain writing. */
export function hasInlineMarkup(value: string): boolean {
  return parseInline(value).some(
    (token) => token.kind !== 'text' || (token.marks?.length ?? 0) > 0,
  );
}

/** The visible writing without Markdown punctuation, used by compact lists. */
export function stripInlineMarkdown(value: string): string {
  return parseInline(value)
    .map((token) => token.text)
    .join('');
}

interface DelimiterCandidate {
  length: number;
  marks: InlineMark[];
}

function parseSegment(value: string, marks: InlineMark[]): InlineToken[] {
  const tokens: InlineToken[] = [];
  let buffer = '';
  let index = 0;

  const flush = (): void => {
    if (buffer.length === 0) return;
    pushText(tokens, buffer, marks);
    buffer = '';
  };

  while (index < value.length) {
    const char = value[index];

    if (char === '\\' && index + 1 < value.length && ESCAPABLE.has(value[index + 1])) {
      buffer += value[index + 1];
      index += 2;
      continue;
    }

    if (char === '`') {
      const end = findCodeEnd(value, index + 1);
      if (end !== -1) {
        flush();
        tokens.push(withMarks({ kind: 'code', text: value.slice(index + 1, end) }, marks));
        index = end + 1;
        continue;
      }
      buffer += char;
      index += 1;
      continue;
    }

    if (char === '[') {
      const match = LINK_PATTERN.exec(value.slice(index));
      const href = match ? safeHref(match[2]) : null;
      if (match && href) {
        flush();
        tokens.push(withMarks({ kind: 'link', text: match[1], href }, marks));
        index += match[0].length;
        continue;
      }
    }

    if (char === '*' || char === '_' || char === '~') {
      const run = runLength(value, index, char);
      const openingAllowed = char !== '_' || !isWordChar(value[index - 1] ?? '');
      const candidates = openingAllowed ? delimiterCandidates(char, run) : [];
      let matched = false;

      for (const candidate of candidates) {
        const close = findClosing(value, index + candidate.length, char, candidate.length);
        if (close === -1) continue;

        flush();
        tokens.push(
          ...parseSegment(
            value.slice(index + candidate.length, close),
            mergeMarks(marks, candidate.marks),
          ),
        );
        index = close + candidate.length;
        matched = true;
        break;
      }

      if (matched) continue;

      buffer += value.slice(index, index + run);
      index += run;
      continue;
    }

    if (char === 'h') {
      const match = BARE_URL_PATTERN.exec(value.slice(index));
      if (match) {
        const { url, trailing } = splitTrailingPunctuation(match[0]);
        flush();
        tokens.push(withMarks({ kind: 'link', text: url, href: url }, marks));
        buffer += trailing;
        index += match[0].length;
        continue;
      }
    }

    buffer += char;
    index += 1;
  }

  flush();
  return tokens;
}

function delimiterCandidates(char: string, run: number): DelimiterCandidate[] {
  if (char === '~') {
    return run >= 2 ? [{ length: 2, marks: ['strike'] }] : [];
  }

  const candidates: DelimiterCandidate[] = [];
  if (run >= 3) candidates.push({ length: 3, marks: ['bold', 'italic'] });
  if (run >= 2) candidates.push({ length: 2, marks: ['bold'] });
  if (run === 1) candidates.push({ length: 1, marks: ['italic'] });
  return candidates;
}

/** Finds the closing delimiter, skipping escapes and inline-code spans. */
function findClosing(value: string, from: number, delimiter: string, length: number): number {
  let index = from;

  while (index < value.length) {
    const char = value[index];

    if (char === '\\') {
      index += 2;
      continue;
    }

    if (char === '`') {
      const end = findCodeEnd(value, index + 1);
      index = end === -1 ? index + 1 : end + 1;
      continue;
    }

    if (char === delimiter) {
      const run = runLength(value, index, char);
      const closesWord = delimiter !== '_' || !isWordChar(value[index + run] ?? '');
      if (run >= length && closesWord) return index;
      index += run;
      continue;
    }

    index += 1;
  }

  return -1;
}

function findCodeEnd(value: string, from: number): number {
  for (let index = from; index < value.length; index += 1) {
    if (value[index] === '\\') {
      index += 1;
      continue;
    }
    if (value[index] === '`') return index;
  }
  return -1;
}

function runLength(value: string, from: number, char: string): number {
  let length = 0;
  while (value[from + length] === char) length += 1;
  return length;
}

function isWordChar(char: string): boolean {
  return char.length > 0 && WORD_CHAR.test(char);
}

function mergeMarks(existing: InlineMark[], added: InlineMark[]): InlineMark[] {
  const merged = [...existing];
  for (const mark of added) {
    if (!merged.includes(mark)) merged.push(mark);
  }
  return merged;
}

function withMarks<T extends InlineToken>(token: T, marks: InlineMark[]): T {
  if (marks.length === 0) return token;
  return { ...token, marks: [...marks] };
}

/** A single fenced-code opening line, such as ```` ```ts ````. */
export function readFenceLine(value: string): FenceShortcut | null {
  if (/[\r\n]/.test(value)) return null;

  const match = FENCE_LINE.exec(value.trim());
  return match ? { language: match[1].toLowerCase(), text: '' } : null;
}

/**
 * Reads a pasted (or Shift+Entered) fenced block. The opening line is enough to
 * trigger the shortcut; the closing fence is optional and removed when present.
 */
export function readFence(value: string): FenceShortcut | null {
  const lines = value.split(/\r?\n/);
  if (lines.length < 2) return null;

  const opening = FENCE_LINE.exec(lines[0].trim());
  if (!opening) return null;

  let body = lines.slice(1);
  if (body.length > 0 && CLOSING_FENCE.test(body[body.length - 1].trim())) {
    body = body.slice(0, -1);
  }

  return { language: opening[1].toLowerCase(), text: body.join('\n') };
}

/** Shortcuts for converting blocks: $$ to function, `` to code, #> to subpage */
export function readExtendedBlockShortcut(
  value: string,
): { kind: 'function'; text: string } | { kind: 'code'; text: string } | { kind: 'subpage'; text: string } | null {
  const funcMatch = FUNCTION_SHORTCUT.exec(value);
  if (funcMatch) {
    let text = funcMatch[1];
    // Pasting a balanced `$$…$$` expression should not leave the closing
    // delimiter behind in the new function block.
    if (text.trimEnd().endsWith('$$')) {
      text = text.trimEnd().slice(0, -2).trimEnd();
    }
    return { kind: 'function', text };
  }
  const codeMatch = CODE_SHORTCUT.exec(value);
  if (codeMatch) {
    return { kind: 'code', text: codeMatch[1] };
  }
  const subpageMatch = SUBPAGE_SHORTCUT.exec(value);
  if (subpageMatch) {
    return { kind: 'subpage', text: subpageMatch[1] };
  }
  return null;
}

/**
 * Reads a Markdown block prefix such as `## `, `- `, `* `, `+ `, or `1. `.
 * Markdown requires whitespace after the marker, so ordinary writing that
 * starts with a dash or a hash is never converted by accident.
 */
export function readBlockShortcut(value: string): MarkdownBlockShortcut | null {
  const [first, ...rest] = value.split(/\r?\n/);
  if (first === undefined) return null;

  const heading = HEADING_PREFIX.exec(first);
  if (heading) {
    return {
      kind: 'heading',
      level: heading[1].length,
      text: [heading[2], ...rest].join('\n'),
    };
  }

  const unordered = UNORDERED_LIST_PREFIX.exec(first);
  if (unordered) {
    return { kind: 'list', ordered: false, items: [unordered[1], ...rest] };
  }

  const ordered = ORDERED_LIST_PREFIX.exec(first);
  if (ordered) {
    return { kind: 'list', ordered: true, items: [ordered[1], ...rest] };
  }

  return null;
}

function pushText(tokens: InlineToken[], text: string, marks: InlineMark[]): void {
  if (text.length === 0) return;

  const last = tokens[tokens.length - 1];
  if (last?.kind === 'text' && sameMarks(last.marks, marks)) {
    last.text += text;
  } else {
    tokens.push(withMarks({ kind: 'text', text }, marks));
  }
}

function sameMarks(left: InlineMark[] | undefined, right: InlineMark[]): boolean {
  const a = left ?? [];
  if (a.length !== right.length) return false;
  return a.every((mark, index) => mark === right[index]);
}

function splitTrailingPunctuation(url: string): { url: string; trailing: string } {
  const match = TRAILING_PUNCTUATION.exec(url);
  if (!match || match[1].length === 0) return { url, trailing: '' };
  return { url: match[1], trailing: match[2] };
}

/** Keeps preview links to ordinary web, mail, and in-app destinations. */
function safeHref(value: string): string | null {
  return /^(https?:\/\/|mailto:|\/|#)/i.test(value) ? value : null;
}
