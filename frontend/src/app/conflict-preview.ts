/**
 * A short summary of one side of a sync conflict, built from either a live
 * `Note` (the local side) or the raw document fields stored in a
 * `NoteConflict` (the other side). `null` means that side no longer exists.
 */
export interface ConflictPreview {
  title: string;
  updatedAt: number | null;
  preview: string;
}

/** Anything shaped like note data: a `Note` or a raw pulled document body. */
export type ConflictSide = {
  title?: unknown;
  blocks?: unknown;
  updatedAt?: unknown;
} | null;

const PREVIEW_LIMIT = 140;

export function conflictPreview(side: ConflictSide): ConflictPreview {
  if (!side) {
    return { title: 'Deleted', updatedAt: null, preview: 'This version no longer exists.' };
  }

  const rawTitle = typeof side.title === 'string' ? side.title.trim() : '';
  const updatedAt =
    typeof side.updatedAt === 'number' && Number.isFinite(side.updatedAt) ? side.updatedAt : null;

  return {
    title: rawTitle || 'Untitled',
    updatedAt,
    preview: previewText(side.blocks),
  };
}

/** First words of a version, from text columns, headings, and list items. */
function previewText(blocks: unknown): string {
  if (!Array.isArray(blocks)) return 'Empty note';

  const parts: string[] = [];
  for (const block of blocks) {
    if (typeof block !== 'object' || block === null) continue;
    const record = block as Record<string, unknown>;

    const columns = Array.isArray(record['columns']) ? record['columns'] : [];
    for (const column of columns) {
      if (typeof column === 'string' && column.trim())
        parts.push(column.replace(/\s+/g, ' ').trim());
    }

    const text = typeof record['text'] === 'string' ? record['text'].trim() : '';
    if (text) parts.push(text.replace(/\s+/g, ' '));

    const items = Array.isArray(record['items']) ? record['items'] : [];
    for (const item of items) {
      if (typeof item === 'string' && item.trim()) parts.push(item.trim());
    }

    if (parts.join(' ').length >= PREVIEW_LIMIT) break;
  }

  const joined = parts.join(' ').slice(0, PREVIEW_LIMIT);
  return joined || 'Empty note';
}
