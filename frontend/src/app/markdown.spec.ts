import { describe, expect, it } from 'vitest';
import {
  hasInlineMarkup,
  parseInline,
  readBlockShortcut,
  readExtendedBlockShortcut,
  readFence,
  readFenceLine,
  stripInlineMarkdown,
} from './markdown';

describe('parseInline', () => {
  it('returns plain text as a single token', () => {
    expect(parseInline('hello world')).toEqual([{ kind: 'text', text: 'hello world' }]);
  });

  it('parses inline code and links', () => {
    expect(parseInline('a `b` [c](https://example.com) d')).toEqual([
      { kind: 'text', text: 'a ' },
      { kind: 'code', text: 'b' },
      { kind: 'text', text: ' ' },
      { kind: 'link', text: 'c', href: 'https://example.com' },
      { kind: 'text', text: ' d' },
    ]);
  });

  it('parses bare URLs and moves trailing punctuation outside the link', () => {
    expect(parseInline('See https://example.com/a.')).toEqual([
      { kind: 'text', text: 'See ' },
      { kind: 'link', text: 'https://example.com/a', href: 'https://example.com/a' },
      { kind: 'text', text: '.' },
    ]);
  });

  it('rejects unsafe link protocols', () => {
    expect(parseInline('[x](javascript:alert(1))')).toEqual([
      { kind: 'text', text: '[x](javascript:alert(1))' },
    ]);
  });

  it('accepts mail, relative, and in-app links', () => {
    expect(parseInline('[m](mailto:a@b.c) [r](/notes) [h](#top)')).toEqual([
      { kind: 'link', text: 'm', href: 'mailto:a@b.c' },
      { kind: 'text', text: ' ' },
      { kind: 'link', text: 'r', href: '/notes' },
      { kind: 'text', text: ' ' },
      { kind: 'link', text: 'h', href: '#top' },
    ]);
  });
});

describe('inline helpers', () => {
  it('detects markup', () => {
    expect(hasInlineMarkup('plain')).toBe(false);
    expect(hasInlineMarkup('`code`')).toBe(true);
    expect(hasInlineMarkup('[link](https://example.com)')).toBe(true);
  });

  it('strips markup for compact labels', () => {
    expect(stripInlineMarkdown('**a** `b` [c](https://example.com)')).toBe('**a** b c');
  });
});

describe('fenced blocks', () => {
  it('reads a single fence line', () => {
    expect(readFenceLine('```ts')).toEqual({ language: 'ts', text: '' });
    expect(readFenceLine('```TS')).toEqual({ language: 'ts', text: '' });
    expect(readFenceLine('```ts\nbody')).toBeNull();
    expect(readFenceLine('plain')).toBeNull();
  });

  it('reads a fenced block and removes the closing fence', () => {
    expect(readFence('```ts\nconst x = 1;\n```')).toEqual({
      language: 'ts',
      text: 'const x = 1;',
    });
  });

  it('keeps the body when the closing fence is missing', () => {
    expect(readFence('```ts\nconst x = 1;')).toEqual({
      language: 'ts',
      text: 'const x = 1;',
    });
  });

  it('requires a newline and an opening fence', () => {
    expect(readFence('```ts')).toBeNull();
    expect(readFence('plain\ntext')).toBeNull();
  });
});

describe('readExtendedBlockShortcut', () => {
  it('converts $$ to a function block and strips a balanced closing $$', () => {
    expect(readExtendedBlockShortcut('$$E = mc^2$$')).toEqual({
      kind: 'function',
      text: 'E = mc^2',
    });
    expect(readExtendedBlockShortcut('$$E = mc^2')).toEqual({
      kind: 'function',
      text: 'E = mc^2',
    });
    expect(readExtendedBlockShortcut('$$')).toEqual({ kind: 'function', text: '' });
  });

  it('converts double backticks to a code block', () => {
    expect(readExtendedBlockShortcut('``const x = 1;')).toEqual({
      kind: 'code',
      text: 'const x = 1;',
    });
  });

  it('converts #> to a subpage block', () => {
    expect(readExtendedBlockShortcut('#> Child')).toEqual({
      kind: 'subpage',
      text: 'Child',
    });
  });

  it('returns null for ordinary text', () => {
    expect(readExtendedBlockShortcut('plain')).toBeNull();
  });
});

describe('readBlockShortcut', () => {
  it('reads heading prefixes', () => {
    expect(readBlockShortcut('## Title')).toEqual({
      kind: 'heading',
      level: 2,
      text: 'Title',
    });
  });

  it('keeps later lines with a heading', () => {
    expect(readBlockShortcut('## Title\nmore')).toEqual({
      kind: 'heading',
      level: 2,
      text: 'Title\nmore',
    });
  });

  it('reads unordered and ordered list prefixes', () => {
    expect(readBlockShortcut('- one')).toEqual({
      kind: 'list',
      ordered: false,
      items: ['one'],
    });
    expect(readBlockShortcut('1. one')).toEqual({
      kind: 'list',
      ordered: true,
      items: ['one'],
    });
  });

  it('requires whitespace after the marker', () => {
    expect(readBlockShortcut('#hashtag')).toBeNull();
    expect(readBlockShortcut('-dash')).toBeNull();
    expect(readBlockShortcut('1.5')).toBeNull();
  });
});
