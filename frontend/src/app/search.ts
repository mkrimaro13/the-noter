import { Note } from './models';

/** How far back the "edited" filter looks. */
export type EditedWindow = 'any' | 'today' | 'week' | 'month';

/**
 * Sidebar filters applied on top of the free-text query: content flags, an
 * edit-recency window, and a metadata key/value pair.
 */
export interface SearchFilter {
  favorites: boolean;
  images: boolean;
  code: boolean;
  edited: EditedWindow;
  /** Metadata key to require, case-insensitive; empty means any. */
  metadataKey: string;
  /** Metadata value to require, case-insensitive; empty means any. */
  metadataValue: string;
}

export const EMPTY_FILTER: SearchFilter = {
  favorites: false,
  images: false,
  code: false,
  edited: 'any',
  metadataKey: '',
  metadataValue: '',
};

const DAY_MS = 24 * 60 * 60 * 1000;
const EDITED_WINDOWS: Record<Exclude<EditedWindow, 'any'>, number> = {
  today: DAY_MS,
  week: 7 * DAY_MS,
  month: 30 * DAY_MS,
};

/** True when the filter narrows the list beyond the free-text query alone. */
export function filterActive(filter: SearchFilter): boolean {
  return (
    filter.favorites ||
    filter.images ||
    filter.code ||
    filter.edited !== 'any' ||
    filter.metadataKey.trim() !== '' ||
    filter.metadataValue.trim() !== ''
  );
}

/** True when the note passes every set filter facet. */
export function matchesFilter(note: Note, filter: SearchFilter, now = Date.now()): boolean {
  if (filter.favorites && !note.favorite) return false;
  if (filter.images && !noteHasImages(note)) return false;
  if (filter.code && !noteHasCode(note)) return false;
  if (filter.edited !== 'any' && now - note.updatedAt > EDITED_WINDOWS[filter.edited]) return false;

  const key = filter.metadataKey.trim().toLowerCase();
  const value = filter.metadataValue.trim().toLowerCase();
  if (!key && !value) return true;

  if (key) {
    const entry = note.metadata.find((meta) => meta.key.trim().toLowerCase() === key);
    if (!entry) return false;
    return !value || entry.value.trim().toLowerCase() === value;
  }

  return note.metadata.some((meta) => meta.value.trim().toLowerCase() === value);
}

function noteHasImages(note: Note): boolean {
  if (note.cover.trim() !== '') return true;
  return note.blocks.some(
    (block) =>
      block.type === 'image' &&
      (block.src.trim() !== '' ||
        block.imageColumns.some((column) => column.type === 'image' && column.src.trim() !== '')),
  );
}

function noteHasCode(note: Note): boolean {
  return note.blocks.some(
    (block) => block.type === 'code' && (block.text.trim() !== '' || block.caption.trim() !== ''),
  );
}

export interface HighlightSegment {
  text: string;
  hit: boolean;
}

/**
 * Splits `text` around case-insensitive occurrences of `query` so the caller
 * can paint each piece, wrapping the hits. An empty query returns the whole
 * text as one plain segment.
 */
export function splitHighlights(text: string, query: string): HighlightSegment[] {
  const needle = query.trim();
  if (!needle || !text) return [{ text, hit: false }];

  const haystack = text.toLowerCase();
  const target = needle.toLowerCase();
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  let index = haystack.indexOf(target);

  while (index !== -1) {
    if (index > cursor) segments.push({ text: text.slice(cursor, index), hit: false });
    segments.push({ text: text.slice(index, index + target.length), hit: true });
    cursor = index + target.length;
    index = haystack.indexOf(target, cursor);
  }

  if (cursor < text.length) segments.push({ text: text.slice(cursor), hit: false });
  return segments;
}
