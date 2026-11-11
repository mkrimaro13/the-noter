import { describe, expect, it } from 'vitest';
import { Note, createBlock, createImageColumn, createNote } from './models';
import { EMPTY_FILTER, SearchFilter, filterActive, matchesFilter, splitHighlights } from './search';

function note(patch: Partial<Note> = {}): Note {
  return { ...createNote(), updatedAt: 1_000, ...patch };
}

function filter(patch: Partial<SearchFilter> = {}): SearchFilter {
  return { ...EMPTY_FILTER, ...patch };
}

describe('filterActive', () => {
  it('is false for the empty filter', () => {
    expect(filterActive(EMPTY_FILTER)).toBe(false);
  });

  it('is true when any facet is set', () => {
    expect(filterActive(filter({ favorites: true }))).toBe(true);
    expect(filterActive(filter({ images: true }))).toBe(true);
    expect(filterActive(filter({ code: true }))).toBe(true);
    expect(filterActive(filter({ edited: 'today' }))).toBe(true);
    expect(filterActive(filter({ metadataKey: 'Status' }))).toBe(true);
    expect(filterActive(filter({ metadataValue: 'active' }))).toBe(true);
  });

  it('ignores blank metadata text', () => {
    expect(filterActive(filter({ metadataKey: '   ', metadataValue: ' ' }))).toBe(false);
  });
});

describe('matchesFilter', () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const NOW = 30 * DAY_MS;

  it('accepts every note when nothing is set', () => {
    expect(matchesFilter(note(), EMPTY_FILTER, NOW)).toBe(true);
  });

  it('keeps only favorite notes', () => {
    const pinned = note({ favorite: true });
    const plain = note();

    expect(matchesFilter(pinned, filter({ favorites: true }), NOW)).toBe(true);
    expect(matchesFilter(plain, filter({ favorites: true }), NOW)).toBe(false);
  });

  it('keeps notes that actually contain images', () => {
    const withCover = note({ cover: 'asset:abc' });
    const withImageBlock = note({
      blocks: [createBlock('image', { src: 'asset:def' })],
    });
    const withImageColumn = note({
      blocks: [
        createBlock('image', {
          mainColumnType: 'text',
          imageColumns: [createImageColumn('image', { src: 'asset:ghi' })],
        }),
      ],
    });
    const writing = note({ blocks: [createBlock('text', { text: 'just words' })] });
    const emptyImageBlock = note({ blocks: [createBlock('image')] });

    const images = filter({ images: true });
    expect(matchesFilter(withCover, images, NOW)).toBe(true);
    expect(matchesFilter(withImageBlock, images, NOW)).toBe(true);
    expect(matchesFilter(withImageColumn, images, NOW)).toBe(true);
    expect(matchesFilter(writing, images, NOW)).toBe(false);
    expect(matchesFilter(emptyImageBlock, images, NOW)).toBe(false);
  });

  it('keeps notes that actually contain code', () => {
    const withCode = note({ blocks: [createBlock('code', { text: 'npm test' })] });
    const withCaption = note({ blocks: [createBlock('code', { caption: 'Install' })] });
    const emptyCode = note({ blocks: [createBlock('code')] });
    const writing = note({ blocks: [createBlock('text')] });

    const code = filter({ code: true });
    expect(matchesFilter(withCode, code, NOW)).toBe(true);
    expect(matchesFilter(withCaption, code, NOW)).toBe(true);
    expect(matchesFilter(emptyCode, code, NOW)).toBe(false);
    expect(matchesFilter(writing, code, NOW)).toBe(false);
  });

  it('keeps notes edited inside the selected window', () => {
    const hoursAgo = (hours: number) => NOW - hours * 3_600_000;
    const daysAgo = (days: number) => NOW - days * DAY_MS;

    const fresh = note({ updatedAt: hoursAgo(2) });
    const thisWeek = note({ updatedAt: daysAgo(3) });
    const lastMonth = note({ updatedAt: daysAgo(20) });

    const today = filter({ edited: 'today' });
    expect(matchesFilter(fresh, today, NOW)).toBe(true);
    expect(matchesFilter(thisWeek, today, NOW)).toBe(false);

    const week = filter({ edited: 'week' });
    expect(matchesFilter(thisWeek, week, NOW)).toBe(true);
    expect(matchesFilter(lastMonth, week, NOW)).toBe(false);

    const month = filter({ edited: 'month' });
    expect(matchesFilter(lastMonth, month, NOW)).toBe(true);

    expect(matchesFilter(lastMonth, filter({ edited: 'any' }), NOW)).toBe(true);
  });

  it('matches metadata by key and value, case-insensitively', () => {
    const active = note({
      metadata: [{ id: 'm_1', key: 'Status', value: 'active', type: 'text', options: [] }],
    });
    const other = note({
      metadata: [{ id: 'm_2', key: 'Status', value: 'done', type: 'text', options: [] }],
    });
    const missing = note();

    const byKey = filter({ metadataKey: 'status' });
    expect(matchesFilter(active, byKey, NOW)).toBe(true);
    expect(matchesFilter(other, byKey, NOW)).toBe(true);
    expect(matchesFilter(missing, byKey, NOW)).toBe(false);

    const byPair = filter({ metadataKey: 'Status', metadataValue: 'ACTIVE' });
    expect(matchesFilter(active, byPair, NOW)).toBe(true);
    expect(matchesFilter(other, byPair, NOW)).toBe(false);

    const byValueOnly = filter({ metadataValue: 'done' });
    expect(matchesFilter(other, byValueOnly, NOW)).toBe(true);
    expect(matchesFilter(active, byValueOnly, NOW)).toBe(false);
  });

  it('combines facets with AND', () => {
    const pinnedCode = note({
      favorite: true,
      blocks: [createBlock('code', { text: 'npm test' })],
      updatedAt: NOW - 3_600_000,
    });
    const plainCode = note({ blocks: [createBlock('code', { text: 'npm test' })] });

    const combined = filter({ favorites: true, code: true, edited: 'today' });
    expect(matchesFilter(pinnedCode, combined, NOW)).toBe(true);
    expect(matchesFilter(plainCode, combined, NOW)).toBe(false);
  });
});

describe('splitHighlights', () => {
  it('returns one plain segment without a query', () => {
    expect(splitHighlights('Grocery list', '')).toEqual([{ text: 'Grocery list', hit: false }]);
    expect(splitHighlights('Grocery list', '   ')).toEqual([{ text: 'Grocery list', hit: false }]);
  });

  it('splits around case-insensitive matches', () => {
    expect(splitHighlights('Grocery list', 'groc')).toEqual([
      { text: 'Groc', hit: true },
      { text: 'ery list', hit: false },
    ]);
    expect(splitHighlights('My notes', 'NOTES')).toEqual([
      { text: 'My ', hit: false },
      { text: 'notes', hit: true },
    ]);
  });

  it('handles repeated matches and keeps the text intact', () => {
    expect(splitHighlights('banana', 'an')).toEqual([
      { text: 'b', hit: false },
      { text: 'an', hit: true },
      { text: 'an', hit: true },
      { text: 'a', hit: false },
    ]);
    expect(
      splitHighlights('banana', 'an')
        .map((segment) => segment.text)
        .join(''),
    ).toBe('banana');
  });

  it('returns the whole text plain when nothing matches', () => {
    expect(splitHighlights('abc', 'xyz')).toEqual([{ text: 'abc', hit: false }]);
    expect(splitHighlights('', 'xyz')).toEqual([{ text: '', hit: false }]);
  });
});
