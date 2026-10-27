import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { FenceShortcut, MarkdownBlockShortcut } from './markdown';
import { SyncService, type RemoteApply } from './sync';
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
  NoteTreeItem,
  blockPlainText,
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
  private readonly sync = inject(SyncService);

  private readonly allNotes = signal<Note[]>(loadNotes());

  /** Notes ordered by most recently edited. */
  readonly notes = computed(() => [...this.allNotes()].sort((a, b) => b.updatedAt - a.updatedAt));

  /**
   * Top-level notes with their nested children, depth-first and each level
   * ordered by the last edit. Notes whose parent disappeared become roots so
   * they can never be lost.
   */
  readonly noteTree = computed<NoteTreeItem[]>(() => buildNoteTree(this.notes()));

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

    this.sync.start({
      getNotes: () => this.allNotes(),
      applyRemote: (change) => this.applyRemote(change),
    });
  }

  createNote(): Note {
    const note = createNote();
    this.allNotes.update((notes) => [note, ...notes]);
    this.sync.markDirty(note.id);
    this.query.set('');
    this.select(note.id);
    this.pendingTitleFocus.set(note.id);
    return note;
  }

  /**
   * Creates a note inside `parentId`, selects it, and asks the editor to focus
   * its title so the branch can be named right away.
   */
  createChildNote(parentId: string): Note {
    const parentExists = this.allNotes().some((note) => note.id === parentId);
    const note = createNote(parentExists ? parentId : null);
    this.allNotes.update((notes) => [note, ...notes]);
    this.sync.markDirty(note.id);
    this.query.set('');
    this.select(note.id);
    this.pendingTitleFocus.set(note.id);
    return note;
  }

  /** Notes nested directly inside `noteId`, most recently edited first. */
  childNotes(noteId: string): Note[] {
    return this.notes().filter((note) => note.parentId === noteId);
  }

  /**
   * The parent chain for a note, outermost first. The visited guard keeps a
   * corrupted stored tree from locking the editor into a loop.
   */
  parentChain(note: Note): Note[] {
    const byId = new Map(this.allNotes().map((item) => [item.id, item]));
    const chain: Note[] = [];
    const seen = new Set<string>([note.id]);
    let parentId = note.parentId;

    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) break;
      chain.unshift(parent);
      parentId = parent.parentId;
    }

    return chain;
  }

  setIcon(noteId: string, icon: string): void {
    this.mutate(noteId, (note) => ({ ...note, icon: icon.slice(0, 16) }));
  }

  setCover(noteId: string, cover: string): void {
    this.mutate(noteId, (note) => ({ ...note, cover }));
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
   * Creates a child note and appends an inline sub-note block that points at it.
   * The child is not selected, so it can be named and written in place.
   */
  addSubnoteBlock(noteId: string): NoteBlock | null {
    const parent = this.allNotes().find((note) => note.id === noteId);
    if (!parent) return null;

    const child = createNote(noteId);
    const block = createBlock('subnote', { noteId: child.id });
    const now = Date.now();

    this.allNotes.update((notes) => [
      { ...parent, blocks: [...parent.blocks, block], updatedAt: now },
      child,
      ...notes.filter((note) => note.id !== noteId),
    ]);

    this.sync.markDirty(noteId);
    this.sync.markDirty(child.id);

    return block;
  }

  /**
   * Turns an existing block into an inline sub-note, moving any writing into the
   * new child note so changing type never silently discards the content.
   */
  convertBlockToSubnote(noteId: string, blockId: string): NoteBlock | null {
    const parent = this.allNotes().find((note) => note.id === noteId);
    const existing = parent?.blocks.find((block) => block.id === blockId);
    if (!parent || !existing) return null;
    if (existing.type === 'subnote') return existing;

    const child = createNote(noteId);
    const content = blockPlainText(existing);
    if (content.trim().length > 0) {
      child.blocks = [createBlock('text', { columns: [content], columnCount: 1 })];
    }

    const block = { ...createBlock('subnote', { noteId: child.id }), id: existing.id };
    const now = Date.now();

    this.allNotes.update((notes) => [
      {
        ...parent,
        blocks: parent.blocks.map((item) => (item.id === blockId ? block : item)),
        updatedAt: now,
      },
      child,
      ...notes.filter((note) => note.id !== noteId),
    ]);

    this.sync.markDirty(noteId);
    this.sync.markDirty(child.id);

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

  /**
   * Applies a fenced-code shortcut typed in a text block. ` ```fn ` (or
   * ` ```function `) produces a function block, ` ```math ` (or ` ```latex ` /
   * ` ```tex `) produces a math-rendered function block, and every other fence
   * produces a code block with the language label.
   */
  convertTextBlockToCode(noteId: string, blockId: string, fence: FenceShortcut): void {
    const math =
      fence.language === 'math' || fence.language === 'latex' || fence.language === 'tex';
    const fn = fence.language === 'fn' || fence.language === 'function';
    const type: BlockType = math || fn ? 'function' : 'code';

    this.mutate(noteId, (note) => ({
      ...note,
      blocks: note.blocks.map((block) => {
        if (block.id !== blockId || block.type !== 'text') return block;

        const converted = convertBlock(block, type);
        return {
          ...converted,
          text: fence.text,
          language: type === 'code' ? fence.language : math ? 'latex' : '',
        };
      }),
    }));
  }

  /**
   * Applies a Markdown block prefix typed at the start of a single-column text
   * block, turning it into a heading or list while keeping the rest of the line.
   */
  applyBlockShortcut(
    noteId: string,
    blockId: string,
    shortcut: MarkdownBlockShortcut,
  ): NoteBlock | null {
    let updated: NoteBlock | null = null;

    this.mutate(noteId, (note) => ({
      ...note,
      blocks: note.blocks.map((block) => {
        if (block.id !== blockId || block.type !== 'text') return block;

        const converted = convertBlock(block, shortcut.kind);
        updated =
          shortcut.kind === 'heading'
            ? { ...converted, type: 'heading', text: shortcut.text, level: shortcut.level }
            : { ...converted, type: 'list', items: shortcut.items, ordered: shortcut.ordered };
        return updated;
      }),
    }));

    return updated;
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

  /**
   * Splits a heading at the caret and inserts a new text block after it. The
   * heading keeps the text before the caret; the new block receives the rest.
   */
  splitHeadingBlock(
    noteId: string,
    blockId: string,
    change: { before: string; after: string },
  ): NoteBlock | null {
    let created: NoteBlock | null = null;

    this.mutate(noteId, (note) => {
      const index = note.blocks.findIndex((block) => block.id === blockId);
      const block = note.blocks[index];
      if (!block || block.type !== 'heading') return note;

      created = createBlock('text', {
        columns: [change.after],
        columnCount: 1,
      });

      const blocks = [...note.blocks];
      blocks.splice(index, 1, { ...block, text: change.before }, created);
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

  /**
   * Deletes a note. Its direct children move up to the deleted note's parent
   * instead of being removed with it, and any inline sub-note blocks that point
   * at the deleted note are removed so no dangling inline editors remain.
   */
  deleteNote(noteId: string): void {
    const before = new Map(this.allNotes().map((note) => [note.id, note]));
    const deleted = before.get(noteId) ?? null;
    const parentId = deleted?.parentId ?? null;
    const remaining = this.allNotes()
      .filter((note) => note.id !== noteId)
      .map((note) => {
        const next = note.parentId === noteId ? { ...note, parentId } : note;
        const blocks = next.blocks.filter(
          (block) => !(block.type === 'subnote' && block.noteId === noteId),
        );
        return blocks.length === next.blocks.length ? next : { ...next, blocks };
      });
    this.allNotes.set(remaining);

    // Reparented children and notes that lost an inline sub-note block are
    // changes of their own and must reach the server too.
    for (const note of remaining) {
      const previous = before.get(note.id);
      if (previous && (previous.parentId !== note.parentId || previous.blocks !== note.blocks)) {
        this.sync.markDirty(note.id);
      }
    }
    this.sync.markDeleted(noteId);

    if (this.selected() === noteId) {
      const next = [...remaining].sort((a, b) => b.updatedAt - a.updatedAt)[0];
      this.selected.set(next?.id ?? null);
    }
  }

  /**
   * Applies notes and tombstones pulled from CouchDB. A remote document never
   * replaces a newer local edit, and conflict copies are queued for upload.
   */
  private applyRemote(change: RemoteApply): boolean {
    if (change.notes.length === 0 && change.deletes.length === 0 && change.copies.length === 0) {
      return true;
    }

    this.allNotes.update((notes) => {
      const next = new Map(notes.map((note) => [note.id, note]));

      for (const incoming of change.notes) {
        const note = normalizeNote({ ...incoming.data, id: incoming.id });
        if (!note) continue;
        const local = next.get(note.id);
        if (local && local.updatedAt > note.updatedAt) continue;
        next.set(note.id, {
          ...note,
          // Keep the local clock monotonic even if the server clock is behind.
          updatedAt: Math.max(note.updatedAt, local?.updatedAt ?? 0),
        });
      }

      for (const id of change.deletes) next.delete(id);

      for (const incoming of change.copies) {
        const note = normalizeNote({ ...incoming.data, id: incoming.id });
        if (!note) continue;
        next.set(note.id, note);
      }

      return [...next.values()];
    });

    for (const copy of change.copies) this.sync.markDirty(copy.id);

    // Write remote changes and conflict copies before returning, so the sync
    // service can safely resolve server-side conflicts afterwards.
    this.flush();

    if (!this.allNotes().some((note) => note.id === this.selected())) {
      this.selected.set(this.notes()[0]?.id ?? null);
    }

    return this.storageError() === null;
  }

  private mutate(noteId: string, update: (note: Note) => Note): void {
    const now = Date.now();
    let changed = false;

    this.allNotes.update((notes) =>
      notes.map((note) => {
        if (note.id !== noteId) return note;
        const next = update(note);
        if (next === note) return note;
        changed = true;
        // Two edits in the same millisecond still need distinct timestamps so
        // the pull comparison can tell which copy is newer.
        return { ...next, updatedAt: Math.max(now, note.updatedAt + 1) };
      }),
    );

    if (changed) this.sync.markDirty(noteId);
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

    // Strict order: the local array is written first; only then may the sync
    // service send pending note ids to CouchDB.
    this.sync.notifyPersisted();
  }
}

function buildNoteTree(notes: Note[]): NoteTreeItem[] {
  const ids = new Set(notes.map((note) => note.id));
  const childrenByParent = new Map<string, Note[]>();
  const roots: Note[] = [];

  for (const note of notes) {
    if (note.parentId && note.parentId !== note.id && ids.has(note.parentId)) {
      const siblings = childrenByParent.get(note.parentId) ?? [];
      siblings.push(note);
      childrenByParent.set(note.parentId, siblings);
    } else {
      roots.push(note);
    }
  }

  const visited = new Set<string>();
  const build = (note: Note, depth: number): NoteTreeItem => {
    visited.add(note.id);
    const children = (childrenByParent.get(note.id) ?? [])
      .filter((child) => !visited.has(child.id))
      .map((child) => build(child, depth + 1));
    return { note, depth, children };
  };

  const tree = roots.map((note) => build(note, 0));

  // A corrupt parent cycle has no root; surface its notes at the top level
  // rather than hiding them forever.
  for (const note of notes) {
    if (!visited.has(note.id)) {
      tree.push(build(note, 0));
    }
  }

  return tree;
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

    const notes = parsed
      .map(normalizeNote)
      .filter((note): note is Note => note !== null)
      .sort((a, b) => b.updatedAt - a.updatedAt);

    return sanitizeParents(notes);
  } catch {
    return [];
  }
}

/**
 * Old notes have no parent id. More recent notes may reference a deleted note
 * or (after manual editing) each other in a loop; both cases become top-level
 * notes instead of disappearing from the sidebar.
 */
function sanitizeParents(notes: Note[]): Note[] {
  const ids = new Set(notes.map((note) => note.id));
  const byId = new Map(notes.map((note) => [note.id, note]));

  return notes.map((note) => {
    if (!note.parentId) return { ...note, parentId: null };
    if (note.parentId === note.id || !ids.has(note.parentId)) {
      return { ...note, parentId: null };
    }

    const seen = new Set<string>([note.id]);
    let current: string | null = note.parentId;
    while (current) {
      if (seen.has(current)) return { ...note, parentId: null };
      seen.add(current);
      current = byId.get(current)?.parentId ?? null;
    }

    return note;
  });
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
    icon: stringOr(value['icon'], ''),
    cover: stringOr(value['cover'], ''),
    parentId: stringOr(value['parentId'], '') || null,
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
  if (
    type !== 'text' &&
    type !== 'heading' &&
    type !== 'list' &&
    type !== 'image' &&
    type !== 'code' &&
    type !== 'function' &&
    type !== 'subnote'
  ) {
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
  const noteId = stringOr(value['noteId'], '');

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
      language: '',
      columns,
      imageColumns: [],
      mainColumnType,
      columnCount,
      noteId: '',
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
      language: '',
      columns: [],
      imageColumns,
      mainColumnType,
      columnCount,
      noteId: '',
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
    language: stringOr(value['language'], ''),
    columns: [],
    imageColumns: [],
    mainColumnType,
    columnCount: 1,
    noteId: type === 'subnote' ? noteId : '',
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
