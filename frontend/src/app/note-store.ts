import { DestroyRef, Injectable, computed, effect, inject, signal } from '@angular/core';
import { AssetStore, isDataImage } from './assets';
import { FenceShortcut, MarkdownBlockShortcut } from './markdown';
import { SyncService, type RemoteApply } from './sync';
import {
  BlockPatch,
  BlockType,
  CoverLayout,
  CoverPosition,
  DEFAULT_COVER_POSITION,
  ImageColumn,
  ImageColumnPatch,
  MAX_HEADING_LEVEL,
  MAX_TEXT_COLUMNS,
  Note,
  NoteBlock,
  NoteMeta,
  NoteMetaType,
  NoteTreeItem,
  blockPlainText,
  coerceMetaValue,
  createBlock,
  createImageColumn,
  createNote,
  convertBlock,
  isImageIcon,
  normalizeMetaType,
  parseMetaOptions,
  uid,
  visibleImageColumnText,
  visibleTextColumns,
} from './models';

const NOTES_KEY = 'the-noter.notes.v1';
const SELECTION_KEY = 'the-noter.selection.v1';
const SAVE_DELAY = 250;

export interface ImportResult {
  added: number;
  updated: number;
  skipped: number;
}

interface NoteChange {
  id: string;
  before: Note | null;
  after: Note | null;
}

type HistoryKind = 'edit' | 'create' | 'delete' | 'restore' | 'purge';

interface HistoryEntry {
  changes: NoteChange[];
  kind: HistoryKind;
  label: string;
  at: number;
}

const HISTORY_LIMIT = 100;
const HISTORY_COALESCE_MS = 900;

@Injectable({ providedIn: 'root' })
export class NoteStore {
  private readonly destroyRef = inject(DestroyRef);
  private readonly sync = inject(SyncService);
  private readonly assets = inject(AssetStore);

  private readonly allNotes = signal<Note[]>(loadNotes());

  /** Active notes ordered by most recently edited. */
  readonly notes = computed(() =>
    this.allNotes()
      .filter((note) => note.deletedAt === null)
      .sort((a, b) => b.updatedAt - a.updatedAt),
  );

  /** Notes waiting in the trash, most recently deleted first. */
  readonly trashedNotes = computed(() =>
    this.allNotes()
      .filter((note) => note.deletedAt !== null)
      .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0)),
  );

  /**
   * Top-level notes with their nested children, depth-first and each level
   * ordered by the last edit. Notes whose parent disappeared become roots so
   * they can never be lost.
   */
  readonly noteTree = computed<NoteTreeItem[]>(() => buildNoteTree(this.notes()));

  readonly query = signal('');

  readonly filteredNotes = computed(() => this.search(this.query()));

  /** Notes matching a free-text query across titles, metadata, and writing. */
  search(value: string): Note[] {
    const query = value.trim().toLowerCase();
    if (!query) return this.notes();
    return this.notes().filter((note) => matchesQuery(note, query));
  }

  readonly total = computed(() => this.notes().length);

  private readonly selected = signal<string | null>(loadSelection(this.notes()));
  readonly selectedId = this.selected.asReadonly();
  readonly selectedNote = computed(
    () => this.notes().find((note) => note.id === this.selected()) ?? null,
  );

  readonly storageError = signal<string | null>(null);

  private readonly undoEntries = signal<HistoryEntry[]>([]);
  private readonly redoEntries = signal<HistoryEntry[]>([]);
  readonly canUndo = computed(() => this.undoEntries().length > 0);
  readonly canRedo = computed(() => this.redoEntries().length > 0);
  readonly undoLabel = computed(() => this.undoEntries().at(-1)?.label ?? '');
  readonly redoLabel = computed(() => this.redoEntries().at(-1)?.label ?? '');

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
    this.recordHistory('create', 'Create note', [{ id: note.id, before: null, after: note }]);
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
    this.recordHistory('create', 'Create note', [{ id: note.id, before: null, after: note }]);
    this.query.set('');
    this.select(note.id);
    this.pendingTitleFocus.set(note.id);
    return note;
  }

  /** Notes nested directly inside `noteId`, most recently edited first. */
  childNotes(noteId: string): Note[] {
    return this.notes().filter((note) => note.parentId === noteId);
  }

  /** Every note below `noteId`, used to keep a move from creating a cycle. */
  descendantIds(noteId: string): Set<string> {
    const children = new Map<string, string[]>();
    for (const note of this.allNotes()) {
      if (!note.parentId) continue;
      const siblings = children.get(note.parentId) ?? [];
      siblings.push(note.id);
      children.set(note.parentId, siblings);
    }

    const descendants = new Set<string>();
    const stack = [...(children.get(noteId) ?? [])];
    while (stack.length > 0) {
      const id = stack.pop()!;
      if (descendants.has(id)) continue;
      descendants.add(id);
      stack.push(...(children.get(id) ?? []));
    }
    return descendants;
  }

  /**
   * Reparents a note, or makes it a root when `parentId` is null. Returns false
   * for missing notes, self-parenting, and moves that would create a cycle.
   */
  moveNote(noteId: string, parentId: string | null): boolean {
    if (noteId === parentId) return false;

    const note = this.allNotes().find((item) => item.id === noteId);
    if (!note) return false;
    if (parentId !== null) {
      const exists = this.allNotes().some((item) => item.id === parentId);
      if (!exists || this.descendantIds(noteId).has(parentId)) return false;
    }
    if (note.parentId === parentId) return false;

    this.mutate(noteId, (current) => ({ ...current, parentId }));
    return true;
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
    this.mutate(noteId, (note) => ({
      ...note,
      // Image icons are data URLs or links and must keep their full source.
      icon: isImageIcon(icon) ? icon : icon.slice(0, 16),
    }));
  }

  setCover(noteId: string, cover: string): void {
    // A new picture starts centred so it never inherits an old framing.
    this.mutate(noteId, (note) => ({
      ...note,
      cover,
      coverPosition: { ...DEFAULT_COVER_POSITION },
    }));
  }

  setCoverLayout(noteId: string, coverLayout: CoverLayout): void {
    this.mutate(noteId, (note) => ({ ...note, coverLayout }));
  }

  /** Moves the visible part of the cover image; values are clamped to 0–100%. */
  setCoverPosition(noteId: string, x: number, y: number): void {
    const coverPosition = { x: clampPercent(x), y: clampPercent(y) };
    this.mutate(noteId, (note) => ({ ...note, coverPosition }));
  }

  select(id: string | null): void {
    if (id === null || this.notes().some((note) => note.id === id)) {
      this.selected.set(id);
    }
  }

  /** Reverts the last note-level action (edits, creates, deletes, restores). */
  undo(): void {
    const entries = this.undoEntries();
    const entry = entries.at(-1);
    if (!entry) return;

    this.undoEntries.set(entries.slice(0, -1));
    this.redoEntries.update((redo) => [...redo, entry]);
    this.applyHistory(entry, 'undo');
  }

  /** Re-applies the last undone action. */
  redo(): void {
    const entries = this.redoEntries();
    const entry = entries.at(-1);
    if (!entry) return;

    this.redoEntries.set(entries.slice(0, -1));
    this.undoEntries.update((undo) => [...undo, entry]);
    this.applyHistory(entry, 'redo');
  }

  clearTitleFocus(): void {
    this.pendingTitleFocus.set(null);
  }

  setTitle(noteId: string, title: string): void {
    this.mutate(noteId, (note) => ({ ...note, title }));
  }

  addMeta(noteId: string): string {
    const meta: NoteMeta = { id: uid('m'), key: '', value: '', type: 'text', options: [] };
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

  /** Switches a metadata field's type and adapts its current value. */
  setMetaType(noteId: string, metaId: string, type: NoteMetaType): void {
    this.mutate(noteId, (note) => ({
      ...note,
      metadata: note.metadata.map((meta) => {
        if (meta.id !== metaId) return meta;
        const options =
          type === 'select' && meta.options.length === 0 ? ['Option 1'] : meta.options;
        let value = coerceMetaValue(type, meta.value);
        if (type === 'select' && !options.includes(value)) value = options[0] ?? '';
        return { ...meta, type, options, value };
      }),
    }));
  }

  /** Replaces the choices of a select field, keeping its value valid. */
  updateMetaOptions(noteId: string, metaId: string, raw: string): void {
    const options = parseMetaOptions(raw);
    this.mutate(noteId, (note) => ({
      ...note,
      metadata: note.metadata.map((meta) => {
        if (meta.id !== metaId) return meta;
        const value = options.includes(meta.value) ? meta.value : (options[0] ?? '');
        return { ...meta, options, value };
      }),
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
    this.recordHistory('create', 'Add sub-note', [
      { id: child.id, before: null, after: child },
      {
        id: noteId,
        before: parent,
        after: { ...parent, blocks: [...parent.blocks, block], updatedAt: now },
      },
    ]);

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
    const updatedParent = {
      ...parent,
      blocks: parent.blocks.map((item) => (item.id === blockId ? block : item)),
      updatedAt: now,
    };

    this.allNotes.update((notes) => [
      updatedParent,
      child,
      ...notes.filter((note) => note.id !== noteId),
    ]);

    this.sync.markDirty(noteId);
    this.sync.markDirty(child.id);
    this.recordHistory('create', 'Add sub-note', [
      { id: child.id, before: null, after: child },
      { id: noteId, before: parent, after: updatedParent },
    ]);

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
   * Moves a note to the trash instead of deleting it right away. Its children
   * stay attached, so restoring the note brings the whole branch back.
   */
  deleteNote(noteId: string): void {
    const note = this.allNotes().find((item) => item.id === noteId);
    if (!note || note.deletedAt !== null) return;

    const now = Math.max(Date.now(), note.updatedAt + 1);
    const next = { ...note, deletedAt: now, updatedAt: now };
    this.allNotes.update((notes) => notes.map((item) => (item.id === noteId ? next : item)));
    this.sync.markDirty(noteId);
    this.recordHistory('delete', 'Move to trash', [{ id: noteId, before: note, after: next }]);

    if (this.selected() === noteId) {
      this.selected.set(this.notes()[0]?.id ?? null);
    }
  }

  /** Brings a note back from the trash. */
  restoreNote(noteId: string): void {
    const note = this.allNotes().find((item) => item.id === noteId);
    if (!note || note.deletedAt === null) return;

    const next = {
      ...note,
      deletedAt: null,
      updatedAt: Math.max(Date.now(), note.updatedAt + 1),
    };
    this.allNotes.update((notes) => notes.map((item) => (item.id === noteId ? next : item)));
    this.sync.markDirty(noteId);
    this.recordHistory('restore', 'Restore note', [{ id: noteId, before: note, after: next }]);
    this.select(noteId);
  }

  /**
   * Deletes a note for good, removing any inline sub-note blocks that point at
   * it. Undo keeps a local copy until the next action clears the history.
   */
  purgeNote(noteId: string): void {
    const note = this.allNotes().find((item) => item.id === noteId);
    if (!note) return;

    const changes: NoteChange[] = [{ id: noteId, before: note, after: null }];
    const remaining = this.allNotes()
      .filter((item) => item.id !== noteId)
      .map((item) => {
        const blocks = item.blocks.filter(
          (block) => !(block.type === 'subnote' && block.noteId === noteId),
        );
        if (blocks.length === item.blocks.length) return item;
        const after = { ...item, blocks };
        changes.push({ id: item.id, before: item, after });
        return after;
      });
    this.allNotes.set(remaining);

    this.sync.markDeleted(noteId);
    for (const change of changes) {
      if (change.id !== noteId && change.after) this.sync.markDirty(change.id);
    }
    this.recordHistory('purge', 'Delete permanently', changes);

    if (this.selected() === noteId) {
      this.selected.set(this.notes()[0]?.id ?? null);
    }
  }

  /** Permanently deletes every note in the trash in a single undoable step. */
  emptyTrash(): void {
    const trashed = this.trashedNotes();
    if (trashed.length === 0) return;

    const ids = new Set(trashed.map((note) => note.id));
    const changes: NoteChange[] = trashed.map((note) => ({
      id: note.id,
      before: note,
      after: null,
    }));

    const remaining = this.allNotes()
      .filter((note) => !ids.has(note.id))
      .map((note) => {
        const blocks = note.blocks.filter(
          (block) => !(block.type === 'subnote' && block.noteId && ids.has(block.noteId)),
        );
        if (blocks.length === note.blocks.length) return note;
        const after = { ...note, blocks };
        changes.push({ id: note.id, before: note, after });
        return after;
      });
    this.allNotes.set(remaining);

    for (const id of ids) this.sync.markDeleted(id);
    for (const change of changes) {
      if (!ids.has(change.id) && change.after) this.sync.markDirty(change.id);
    }
    this.recordHistory('purge', 'Empty trash', changes);

    if (this.selected() !== null && !this.notes().some((note) => note.id === this.selected())) {
      this.selected.set(this.notes()[0]?.id ?? null);
    }
  }

  /**
   * Moves inline base64 images out of the note JSON and into the asset store.
   * Timestamps are intentionally left alone so a migration never reorders the
   * sidebar or looks like a user edit.
   */
  async migrateImages(): Promise<number> {
    const snapshot = new Map(this.allNotes().map((note) => [note.id, note]));
    const updates = new Map<string, Note>();

    for (const note of snapshot.values()) {
      let next = note;

      if (isDataImage(note.icon)) {
        next = { ...next, icon: await this.assets.putDataUrl(note.icon) };
      }
      if (isDataImage(note.cover)) {
        next = { ...next, cover: await this.assets.putDataUrl(note.cover) };
      }

      let blocks = next.blocks;
      let blocksChanged = false;

      for (let index = 0; index < blocks.length; index += 1) {
        const block = blocks[index];
        let nextBlock = block;

        if (isDataImage(block.src)) {
          nextBlock = { ...nextBlock, src: await this.assets.putDataUrl(block.src) };
        }

        let columns = nextBlock.imageColumns;
        let columnsChanged = false;
        for (let columnIndex = 0; columnIndex < columns.length; columnIndex += 1) {
          const column = columns[columnIndex];
          if (!isDataImage(column.src)) continue;
          if (!columnsChanged) {
            columns = [...columns];
            columnsChanged = true;
          }
          columns[columnIndex] = {
            ...column,
            src: await this.assets.putDataUrl(column.src),
          };
        }

        if (columnsChanged) nextBlock = { ...nextBlock, imageColumns: columns };
        if (nextBlock !== block) {
          if (!blocksChanged) {
            blocks = [...blocks];
            blocksChanged = true;
          }
          blocks[index] = nextBlock;
        }
      }

      if (blocksChanged) next = { ...next, blocks };
      if (next !== note) updates.set(note.id, next);
    }

    if (updates.size === 0) return 0;

    // Hashing is asynchronous: if the user edited a note meanwhile, keep the
    // new version and let a later pass migrate its images instead.
    const applied: string[] = [];
    this.allNotes.update((notes) =>
      notes.map((note) => {
        const next = updates.get(note.id);
        if (!next || snapshot.get(note.id) !== note) return note;
        applied.push(note.id);
        return next;
      }),
    );

    for (const id of applied) this.sync.markDirty(id);
    this.flush();
    return applied.length;
  }

  /** Serializes the whole notebook into a portable JSON backup. */
  exportBackup(): string {
    return JSON.stringify(
      {
        format: 'the-noter-backup',
        version: 1,
        exportedAt: new Date().toISOString(),
        notes: this.allNotes(),
      },
      null,
      2,
    );
  }

  /**
   * Merges a JSON backup into the notebook. Existing notes are only replaced
   * when the backup copy is newer, so importing the same file twice never
   * duplicates notes or resurrects an older edit.
   */
  importBackup(raw: string): ImportResult {
    const parsed: unknown = JSON.parse(raw);
    const notesRaw = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed['notes'])
        ? parsed['notes']
        : null;

    if (!notesRaw) {
      throw new Error('This file is not a The Noter backup.');
    }

    const incoming = new Map<string, Note>();
    for (const value of notesRaw) {
      const note = normalizeNote(value);
      if (note) incoming.set(note.id, note);
    }

    if (incoming.size === 0) {
      throw new Error('The backup does not contain any valid notes.');
    }

    const result: ImportResult = { added: 0, updated: 0, skipped: 0 };
    const changed: string[] = [];

    this.allNotes.update((notes) => {
      const next = new Map(notes.map((note) => [note.id, note]));

      for (const note of incoming.values()) {
        const local = next.get(note.id);
        if (!local) {
          next.set(note.id, note);
          result.added += 1;
          changed.push(note.id);
        } else if (note.updatedAt > local.updatedAt) {
          next.set(note.id, note);
          result.updated += 1;
          changed.push(note.id);
        } else {
          result.skipped += 1;
        }
      }

      return sanitizeParents([...next.values()]);
    });

    for (const id of changed) this.sync.markDirty(id);

    this.flush();
    void this.migrateImages();

    if (!this.allNotes().some((note) => note.id === this.selected())) {
      this.selected.set(this.notes()[0]?.id ?? null);
    }

    return result;
  }

  /**
   * Applies notes and tombstones pulled from CouchDB. A remote document never
   * replaces a newer local edit, conflict copies are queued for upload, and a
   * forced apply (a conflict resolution) replaces the local copy outright.
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
        if (!change.force && local && local.updatedAt > note.updatedAt) continue;
        next.set(
          note.id,
          change.force
            ? note
            : {
                ...note,
                // Keep the local clock monotonic even if the server clock is behind.
                updatedAt: Math.max(note.updatedAt, local?.updatedAt ?? 0),
              },
        );
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
    void this.migrateImages();

    if (!this.allNotes().some((note) => note.id === this.selected())) {
      this.selected.set(this.notes()[0]?.id ?? null);
    }

    return this.storageError() === null;
  }

  private mutate(noteId: string, update: (note: Note) => Note, label = 'Edit note'): void {
    const now = Date.now();
    let change: NoteChange | null = null;

    this.allNotes.update((notes) =>
      notes.map((note) => {
        if (note.id !== noteId) return note;
        const next = update(note);
        if (next === note) return note;
        // Two edits in the same millisecond still need distinct timestamps so
        // the pull comparison can tell which copy is newer.
        const after = { ...next, updatedAt: Math.max(now, note.updatedAt + 1) };
        change = { id: noteId, before: note, after };
        return after;
      }),
    );

    if (change) {
      this.sync.markDirty(noteId);
      this.recordHistory('edit', label, [change]);
    }
  }

  /**
   * Stores an undoable action. Rapid edits to the same note coalesce into one
   * entry so typing a sentence undoes as a single step.
   */
  private recordHistory(kind: HistoryKind, label: string, changes: NoteChange[]): void {
    const filtered = changes.filter((change) => change.before !== change.after);
    if (filtered.length === 0) return;

    const now = Date.now();
    const last = this.undoEntries().at(-1);
    const sameTargets =
      last !== undefined &&
      last.kind === 'edit' &&
      kind === 'edit' &&
      last.changes.length === filtered.length &&
      last.changes.every((change, index) => change.id === filtered[index].id);

    if (last && sameTargets && now - last.at <= HISTORY_COALESCE_MS) {
      const merged: HistoryEntry = {
        ...last,
        changes: last.changes.map((change, index) => ({
          ...change,
          after: filtered[index].after,
        })),
        at: now,
      };
      this.undoEntries.update((entries) => [...entries.slice(0, -1), merged]);
    } else {
      const entry: HistoryEntry = { changes: filtered, kind, label, at: now };
      this.undoEntries.update((entries) => [...entries, entry].slice(-HISTORY_LIMIT));
    }

    // Any new action invalidates the redo branch.
    this.redoEntries.set([]);
  }

  /** Replays one history entry forwards or backwards and persists the result. */
  private applyHistory(entry: HistoryEntry, direction: 'undo' | 'redo'): void {
    const targets = new Map<string, Note | null>();
    for (const change of entry.changes) {
      targets.set(change.id, direction === 'undo' ? change.before : change.after);
    }

    this.allNotes.update((notes) => {
      const next = new Map(notes.map((note) => [note.id, note]));
      for (const [id, target] of targets) {
        if (target === null) next.delete(id);
        else next.set(id, target);
      }
      return [...next.values()];
    });

    for (const [id, target] of targets) {
      // `markDirty` also moves an id back out of the delete queue, so undoing a
      // purge resurrects the note locally before the next sync.
      if (target === null) this.sync.markDeleted(id);
      else this.sync.markDirty(id);
    }

    this.flush();

    if (this.selected() !== null && !this.notes().some((note) => note.id === this.selected())) {
      this.selected.set(this.notes()[0]?.id ?? null);
    }
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
    coverLayout: value['coverLayout'] === 'landscape' ? 'landscape' : 'content',
    coverPosition: normalizeCoverPosition(value['coverPosition']),
    parentId: stringOr(value['parentId'], '') || null,
    metadata: metadataRaw.map(normalizeMeta).filter((meta): meta is NoteMeta => meta !== null),
    blocks: blocksRaw.map(normalizeBlock).filter((block): block is NoteBlock => block !== null),
    createdAt,
    updatedAt: numberOr(value['updatedAt'], createdAt),
    deletedAt:
      typeof value['deletedAt'] === 'number' && value['deletedAt'] > 0 ? value['deletedAt'] : null,
  };
}

function normalizeMeta(value: unknown): NoteMeta | null {
  if (!isRecord(value)) return null;

  const type = normalizeMetaType(value['type']);
  const optionsRaw = Array.isArray(value['options']) ? value['options'] : [];
  const options = optionsRaw.filter((option): option is string => typeof option === 'string');

  return {
    id: stringOr(value['id'], uid('m')),
    key: stringOr(value['key'], ''),
    value: coerceMetaValue(type, stringOr(value['value'], '')),
    type,
    options,
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

function normalizeCoverPosition(value: unknown): CoverPosition {
  if (!isRecord(value)) return { ...DEFAULT_COVER_POSITION };
  return {
    x: clampPercent(numberOr(value['x'], DEFAULT_COVER_POSITION.x)),
    y: clampPercent(numberOr(value['y'], DEFAULT_COVER_POSITION.y)),
  };
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.min(100, Math.max(0, value));
}
