/**
 * A deliberately small Markdown-compatible layer. It understands the two
 * pieces that are useful while writing notes — inline code and links — plus a
 * fenced-code shortcut that promotes a text block into a code block. Everything
 * else stays plain text so the existing block editor remains predictable.
 */
export type InlineToken =
  | { kind: 'text'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string };

export interface FenceShortcut {
  language: string;
  text: string;
}

/** A Markdown block prefix typed at the start of a text block. */
export type MarkdownBlockShortcut =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'list'; ordered: boolean; items: string[] };

const INLINE_PATTERN = /`([^`\n]+)`|\[([^\]\n]+)\]\(([^)\s]+)\)|(https?:\/\/[^\s<>()`]+)/g;

const FENCE_LINE = /^```([A-Za-z0-9_+.#-]*)[ \t]*$/;
const CLOSING_FENCE = /^```[ \t]*$/;
const TRAILING_PUNCTUATION = /^(.*?)([.,;:!?]+)$/;
const HEADING_PREFIX = /^(#{1,6})[ \t]+(.*)$/;
const UNORDERED_LIST_PREFIX = /^[-*+][ \t]+(.*)$/;
const ORDERED_LIST_PREFIX = /^\d{1,9}[.)][ \t]+(.*)$/;

/** Splits writing into text, inline-code, and link tokens for safe rendering. */
export function parseInline(value: string): InlineToken[] {
  const tokens: InlineToken[] = [];
  let lastIndex = 0;

  for (const match of value.matchAll(INLINE_PATTERN)) {
    const index = match.index ?? 0;
    if (index > lastIndex) {
      pushText(tokens, value.slice(lastIndex, index));
    }

    if (match[1] !== undefined) {
      tokens.push({ kind: 'code', text: match[1] });
    } else if (match[2] !== undefined && match[3] !== undefined) {
      const href = safeHref(match[3]);
      if (href) {
        tokens.push({ kind: 'link', text: match[2], href });
      } else {
        pushText(tokens, match[0]);
      }
    } else if (match[4] !== undefined) {
      const { url, trailing } = splitTrailingPunctuation(match[4]);
      tokens.push({ kind: 'link', text: url, href: url });
      pushText(tokens, trailing);
    }

    lastIndex = index + match[0].length;
  }

  if (lastIndex < value.length) {
    pushText(tokens, value.slice(lastIndex));
  }

  return tokens;
}

/** True when a rendered preview would show anything besides plain writing. */
export function hasInlineMarkup(value: string): boolean {
  return parseInline(value).some((token) => token.kind !== 'text');
}

/** The visible writing without Markdown punctuation, used by compact lists. */
export function stripInlineMarkdown(value: string): string {
  return parseInline(value)
    .map((token) => token.text)
    .join('');
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

function pushText(tokens: InlineToken[], text: string): void {
  if (text.length === 0) return;

  const last = tokens[tokens.length - 1];
  if (last?.kind === 'text') {
    last.text += text;
  } else {
    tokens.push({ kind: 'text', text });
  }
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
