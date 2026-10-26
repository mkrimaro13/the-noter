import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import {
  BlockPatch,
  BlockType,
  ImageColumn,
  ImageColumnPatch,
  MAX_HEADING_LEVEL,
  MAX_TEXT_COLUMNS,
  Note,
  NoteBlock,
  NoteMeta,
  createBlock,
  createImageColumn,
  createNote,
  convertBlock,
  uid,
  visibleImageColumnText,
  visibleTextColumns,
} from './models';

const NOTES_KEY = 'the-noter.notes.v1';
const SELECTION_KEY = 'the-noter.selection.v1';
const SAVE_DELAY = 250;

@Injectable({ providedIn: 'root' })
export class NoteStore {
  private readonly destroyRef = inject(DestroyRef);

  private readonly allNotes = signal<Note[]>(loadNotes());

  /** Notes ordered by most recently edited. */
  readonly notes = computed(() => [...this.allNotes()].sort((a, b) => b.updatedAt - a.updatedAt));

  readonly query = signal('');

  readonly filteredNotes = computed(() => {
    const query = this.query().trim().toLowerCase();
    if (!query) return this.notes();
    return this.notes().filter((note) => matchesQuery(note, query));
  });

  readonly total = computed(() => this.allNotes().length);

  private readonly selected = signal<string | null>(loadSelection(this.notes()));
  readonly selectedId = this.selected.asReadonly();
  readonly selectedNote = computed(
    () => this.allNotes().find((note) => note.id === this.selected()) ?? null,
  );

  readonly storageError = signal<string | null>(null);

  /** Set after creating a note so the editor can focus its title. */
  readonly pendingTitleFocus = signal<string | null>(null);

  private saveTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    effect(() => {
      const notes = this.allNotes();
      clearTimeout(this.saveTimer);
      this.saveTimer = setTimeout(() => this.persist(notes), SAVE_DELAY);
    });

    effect(() => {
      const selected = this.selected();
      try {
        localStorage.setItem(SELECTION_KEY, selected ?? '');
      } catch {
        // Selection is a convenience; failing to remember it is harmless.
      }
    });

    const flush = () => this.flush();
    window.addEventListener('beforeunload', flush);
    this.destroyRef.onDestroy(() => {
      window.removeEventListener('beforeunload', flush);
      this.flush();
    });
  }

  createNote(): Note {
    const note = createNote();
    this.allNotes.update((notes) => [note, ...notes]);
    this.query.set('');
    this.select(note.id);
    this.pendingTitleFocus.set(note.id);
    return note;
  }

  select(id: string | null): void {
    if (id === null || this.allNotes().some((note) => note.id === id)) {
      this.selected.set(id);
    }
  }

  clearTitleFocus(): void {
    this.pendingTitleFocus.set(null);
  }

  setTitle(noteId: string, title: string): void {
    this.mutate(noteId, (note) => ({ ...note, title }));
  }

  addMeta(noteId: string): string {
    const meta: NoteMeta = { id: uid('m'), key: '', value: '' };
    this.mutate(noteId, (note) => ({ ...note, metadata: [...note.metadata, meta] }));
    return meta.id;
  }

  updateMeta(
    noteId: string,
    metaId: string,
    patch: Partial<Pick<NoteMeta, 'key' | 'value'>>,
  ): void {
    this.mutate(noteId, (note) => ({
      ...note,
      metadata: note.metadata.map((meta) => (meta.id === metaId ? { ...meta, ...patch } : meta)),
    }));
  }

  removeMeta(noteId: string, metaId: string): void {
    this.mutate(noteId, (note) => ({
      ...note,
      metadata: note.metadata.filter((meta) => meta.id !== metaId),
    }));
  }

  addBlock(noteId: string, type: BlockType): NoteBlock {
    const block = createBlock(type);
    this.mutate(noteId, (note) => ({ ...note, blocks: [...note.blocks, block] }));
    return block;
  }

  /**
   * Inserts blocks after `afterBlockId`, or at the end when it is null or no
   * longer exists. Used by clipboard image pasting.
   */
  insertBlocks(noteId: string, afterBlockId: string | null, blocks: NoteBlock[]): void {
    if (blocks.length === 0) return;

    this.mutate(noteId, (note) => {
      const index = afterBlockId ? note.blocks.findIndex((block) => block.id === afterBlockId) : -1;
      const at = index >= 0 ? index + 1 : note.blocks.length;
      const next = [...note.blocks];
      next.splice(at, 0, ...blocks);
      return { ...note, blocks: next };
    });
  }

  updateBlock(noteId: string, blockId: string, patch: BlockPatch): void {
    this.mutate(noteId, (note) => ({
      ...note,
      blocks: note.blocks.map((block) => {
        if (block.id !== blockId) return block;
        const next = { ...block, ...patch };
        if (patch.level !== undefined) {
          next.level = Math.min(Math.max(Math.round(patch.level), 1), MAX_HEADING_LEVEL);
        }
        return next;
      }),
    }));
  }

  /** Changes a block's type while carrying compatible writing across. */
  setBlockType(noteId: string, blockId: string, type: BlockType): void {
    this.mutate(noteId, (note) => ({
      ...note,
      blocks: note.blocks.map((block) =>
        block.id === blockId ? convertBlock(block, type) : block,
      ),
    }));
  }

  updateColumn(noteId: string, blockId: string, index: number, value: string): void {
    if (index < 0 || index >= MAX_TEXT_COLUMNS) return;

    this.mutate(noteId, (note) => ({
      ...note,
      blocks: note.blocks.map((block) => {
        if (block.id !== blockId || block.type !== 'text') return block;

        const columns = [...block.columns];
        while (columns.length <= index) {
          columns.push('');
        }
        columns[index] = value;
        return { ...block, columns };
      }),
    }));
  }

  /**
   * Splits a text block at the caret, inserting a new single-column text block
   * directly after it. Returns the new block so the editor can focus it.
   */
  splitTextBlock(
    noteId: string,
    blockId: string,
    change: { column: number; before: string; after: string },
  ): NoteBlock | null {
    if (change.column < 0 || change.column >= MAX_TEXT_COLUMNS) return null;

    let created: NoteBlock | null = null;

    this.mutate(noteId, (note) => {
      const index = note.blocks.findIndex((block) => block.id === blockId);
      const block = note.blocks[index];
      if (!block || block.type !== 'text') return note;

      const columns = [...block.columns];
      while (columns.length <= change.column) {
        columns.push('');
      }
      columns[change.column] = change.before;

      created = createBlock('text', {
        columns: [change.after],
        columnCount: 1,
      });

      const blocks = [...note.blocks];
      blocks.splice(index, 1, { ...block, columns }, created);
      return { ...note, blocks };
    });

    return created;
  }

  setColumnCount(noteId: string, blockId: string, count: number): void {
    if (!Number.isFinite(count)) return;

    const columnCount = Math.min(Math.max(Math.round(count), 1), MAX_TEXT_COLUMNS);
    this.mutate(noteId, (note) => ({
      ...note,
      blocks: note.blocks.map((block) => {
        if (block.id !== blockId) return block;

        if (block.type === 'text') {
          // Grow the array when needed, but keep hidden columns intact so that
          // lowering the count never destroys text.
          const columns = [...block.columns];
          while (columns.length < columnCount) {
            columns.push('');
          }
          return { ...block, columns, columnCount };
        }

        if (block.type === 'image') {
          const imageColumns = [...block.imageColumns];
          while (imageColumns.length < columnCount - 1) {
            imageColumns.push(createImageColumn());
          }
          return { ...block, imageColumns, columnCount };
        }

        return block;
      }),
    }));
  }

  /**
   * Updates one of an image block's extra columns. The index excludes the main
   * image, so `0` is the second visible column.
   */
  updateImageColumn(noteId: string, blockId: string, index: number, patch: ImageColumnPatch): void {
    if (index < 0 || index >= MAX_TEXT_COLUMNS - 1) return;

    this.mutate(noteId, (note) => ({
      ...note,
      blocks: note.blocks.map((block) => {
        if (block.id !== blockId || block.type !== 'image') return block;

        const imageColumns: ImageColumn[] = [...block.imageColumns];
        while (imageColumns.length <= index) {
          imageColumns.push(createImageColumn());
        }

        imageColumns[index] = { ...imageColumns[index], ...patch };
        return { ...block, imageColumns };
      }),
    }));
  }

  removeBlock(noteId: string, blockId: string): void {
    this.mutate(noteId, (note) => ({
      ...note,
      blocks: note.blocks.filter((block) => block.id !== blockId),
    }));
  }

  moveBlock(noteId: string, from: number, to: number): void {
    const note = this.allNotes().find((item) => item.id === noteId);
    if (!note) return;

    const { length } = note.blocks;
    if (from === to || from < 0 || to < 0 || from >= length || to >= length) return;

    this.mutate(noteId, (current) => {
      const blocks = [...current.blocks];
      const [moved] = blocks.splice(from, 1);
      blocks.splice(to, 0, moved);
      return { ...current, blocks };
    });
  }

  deleteNote(noteId: string): void {
    const remaining = this.allNotes().filter((note) => note.id !== noteId);
    this.allNotes.set(remaining);

    if (this.selected() === noteId) {
      const next = [...remaining].sort((a, b) => b.updatedAt - a.updatedAt)[0];
      this.selected.set(next?.id ?? null);
    }
  }

  private mutate(noteId: string, update: (note: Note) => Note): void {
    const now = Date.now();
    this.allNotes.update((notes) =>
      notes.map((note) => (note.id === noteId ? { ...update(note), updatedAt: now } : note)),
    );
  }

  private flush(): void {
    clearTimeout(this.saveTimer);
    this.persist(this.allNotes());
  }

  private persist(notes: Note[]): void {
    try {
      localStorage.setItem(NOTES_KEY, JSON.stringify(notes));
      if (this.storageError() !== null) {
        this.storageError.set(null);
      }
    } catch {
      this.storageError.set('Storage is full. Recent edits are not being saved.');
    }
  }
}

function matchesQuery(note: Note, query: string): boolean {
  if (note.title.toLowerCase().includes(query)) return true;
  if (
    note.metadata.some(
      (meta) => meta.key.toLowerCase().includes(query) || meta.value.toLowerCase().includes(query),
    )
  ) {
    return true;
  }
  return note.blocks.some(
    (block) =>
      block.text.toLowerCase().includes(query) ||
      block.caption.toLowerCase().includes(query) ||
      visibleTextColumns(block).some((column) => column.toLowerCase().includes(query)) ||
      visibleImageColumnText(block).some((column) => column.toLowerCase().includes(query)) ||
      block.items.some((item) => item.toLowerCase().includes(query)),
  );
}

function loadNotes(): Note[] {
  try {
    const raw = localStorage.getItem(NOTES_KEY);
    if (!raw) return [];

    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map(normalizeNote)
      .filter((note): note is Note => note !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } catch {
    return [];
  }
}

function loadSelection(notes: Note[]): string | null {
  try {
    const stored = localStorage.getItem(SELECTION_KEY);
    if (stored && notes.some((note) => note.id === stored)) return stored;
  } catch {
    // Ignore unavailable storage.
  }
  return notes[0]?.id ?? null;
}

function normalizeNote(value: unknown): Note | null {
  if (!isRecord(value)) return null;

  const createdAt = numberOr(value['createdAt'], Date.now());
  const metadataRaw = Array.isArray(value['metadata']) ? value['metadata'] : [];
  const blocksRaw = Array.isArray(value['blocks']) ? value['blocks'] : [];

  return {
    id: stringOr(value['id'], uid('n')),
    title: stringOr(value['title'], ''),
    metadata: metadataRaw.map(normalizeMeta).filter((meta): meta is NoteMeta => meta !== null),
    blocks: blocksRaw.map(normalizeBlock).filter((block): block is NoteBlock => block !== null),
    createdAt,
    updatedAt: numberOr(value['updatedAt'], createdAt),
  };
}

function normalizeMeta(value: unknown): NoteMeta | null {
  if (!isRecord(value)) return null;
  return {
    id: stringOr(value['id'], uid('m')),
    key: stringOr(value['key'], ''),
    value: stringOr(value['value'], ''),
  };
}

function normalizeBlock(value: unknown): NoteBlock | null {
  if (!isRecord(value)) return null;

  const type = value['type'];
  if (type !== 'text' && type !== 'heading' && type !== 'list' && type !== 'image') {
    return null;
  }

  const itemsRaw = Array.isArray(value['items']) ? value['items'] : [];
  const items = itemsRaw.filter((item): item is string => typeof item === 'string');

  const text = stringOr(value['text'], '');
  const columnsRaw = Array.isArray(value['columns']) ? value['columns'] : [];
  const columns = columnsRaw
    .filter((column): column is string => typeof column === 'string')
    .slice(0, MAX_TEXT_COLUMNS);

  const level = Math.min(Math.max(Math.round(numberOr(value['level'], 1)), 1), MAX_HEADING_LEVEL);
  const mainColumnType: ImageColumn['type'] = value['mainColumnType'] === 'text' ? 'text' : 'image';

  if (type === 'text') {
    // Older notes stored the whole paragraph in `text`. Treat it as the first
    // column, then make sure every visible column has a slot.
    if (columns.length === 0) columns.push(text);
    const columnCount = Math.min(
      Math.max(Math.round(numberOr(value['columnCount'], 1)), 1),
      MAX_TEXT_COLUMNS,
    );
    while (columns.length < columnCount) columns.push('');

    return {
      id: stringOr(value['id'], uid('b')),
      type,
      text: '',
      items,
      ordered: value['ordered'] === true,
      src: stringOr(value['src'], ''),
      caption: stringOr(value['caption'], ''),
      level: 1,
      columns,
      imageColumns: [],
      mainColumnType,
      columnCount,
    };
  }

  if (type === 'image') {
    const columnCount = Math.min(
      Math.max(Math.round(numberOr(value['columnCount'], 1)), 1),
      MAX_TEXT_COLUMNS,
    );
    const imageColumnsRaw = Array.isArray(value['imageColumns']) ? value['imageColumns'] : [];
    const imageColumns = imageColumnsRaw
      .map(normalizeImageColumn)
      .filter((column): column is ImageColumn => column !== null)
      .slice(0, MAX_TEXT_COLUMNS - 1);
    while (imageColumns.length < columnCount - 1) {
      imageColumns.push(createImageColumn());
    }

    return {
      id: stringOr(value['id'], uid('b')),
      type,
      text: stringOr(value['text'], ''),
      items,
      ordered: value['ordered'] === true,
      src: stringOr(value['src'], ''),
      caption: stringOr(value['caption'], ''),
      level: 1,
      columns: [],
      imageColumns,
      mainColumnType,
      columnCount,
    };
  }

  return {
    id: stringOr(value['id'], uid('b')),
    type,
    text,
    items: type === 'list' && items.length === 0 ? [''] : items,
    ordered: value['ordered'] === true,
    src: stringOr(value['src'], ''),
    caption: stringOr(value['caption'], ''),
    level,
    columns: [],
    imageColumns: [],
    mainColumnType,
    columnCount: 1,
  };
}

function normalizeImageColumn(value: unknown): ImageColumn | null {
  if (!isRecord(value)) return null;

  return {
    id: stringOr(value['id'], uid('c')),
    type: value['type'] === 'image' ? 'image' : 'text',
    text: stringOr(value['text'], ''),
    src: stringOr(value['src'], ''),
    caption: stringOr(value['caption'], ''),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}
