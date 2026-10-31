import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SyncService, type RemoteApply, type RemoteNoteDoc } from './sync';
import { Note, NoteBlock, createBlock, createImageColumn, createNote } from './models';
import { NoteStore } from './note-store';

const NOTES_KEY = 'the-noter.notes.v1';
const SELECTION_KEY = 'the-noter.selection.v1';

function block(id: string, patch: Partial<NoteBlock> = {}): NoteBlock {
  return { ...createBlock('text'), id, ...patch };
}

function note(id: string, patch: Partial<Note> = {}): Note {
  return { ...createNote(), id, title: id, updatedAt: 100, ...patch };
}

function remote(id: string, patch: Partial<Note> = {}, rev = '1'): RemoteNoteDoc {
  return { id, rev, data: { ...note(id), ...patch } };
}

function remoteHandler(sync: ReturnType<typeof fakeSync>): (change: RemoteApply) => boolean {
  return sync.start.mock.calls[0][0].applyRemote as (change: RemoteApply) => boolean;
}

function fakeSync() {
  return {
    start: vi.fn(),
    markDirty: vi.fn(),
    markDeleted: vi.fn(),
    notifyPersisted: vi.fn(),
  };
}

function setup(seed?: Note[]) {
  if (seed) localStorage.setItem(NOTES_KEY, JSON.stringify(seed));
  const sync = fakeSync();
  TestBed.configureTestingModule({
    providers: [{ provide: SyncService, useValue: sync }],
  });
  const store = TestBed.inject(NoteStore);
  TestBed.tick();
  return { store, sync };
}

describe('NoteStore', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('starts empty and registers sync handlers', () => {
    const { store, sync } = setup();

    expect(store.notes()).toEqual([]);
    expect(store.total()).toBe(0);
    expect(store.selectedId()).toBeNull();
    expect(store.selectedNote()).toBeNull();
    expect(sync.start).toHaveBeenCalledWith({
      getNotes: expect.any(Function),
      applyRemote: expect.any(Function),
    });
  });

  it('creates and selects a new root note', () => {
    const { store, sync } = setup();

    const created = store.createNote();

    expect(store.total()).toBe(1);
    expect(store.selectedId()).toBe(created.id);
    expect(store.pendingTitleFocus()).toBe(created.id);
    expect(store.query()).toBe('');
    expect(sync.markDirty).toHaveBeenCalledWith(created.id);
  });

  it('creates a child note and falls back to root when the parent is missing', () => {
    const { store } = setup();
    const parent = store.createNote();

    const child = store.createChildNote(parent.id);
    const orphan = store.createChildNote('missing');

    expect(child.parentId).toBe(parent.id);
    expect(orphan.parentId).toBeNull();
    expect(store.childNotes(parent.id).map((item) => item.id)).toEqual([child.id]);
  });

  it('clears the query when creating a note', () => {
    const { store } = setup();
    store.query.set('search');

    store.createNote();

    expect(store.query()).toBe('');
  });

  it('sorts notes by most recent edit and builds the nested tree', () => {
    const parent = note('n_parent', { updatedAt: 10 });
    const child = note('n_child', { parentId: 'n_parent', updatedAt: 30 });
    const grandchild = note('n_grand', { parentId: 'n_child', updatedAt: 20 });
    const orphan = note('n_orphan', { parentId: 'n_missing', updatedAt: 5 });

    const { store } = setup([parent, child, grandchild, orphan]);

    expect(store.notes().map((item) => item.id)).toEqual([
      'n_child',
      'n_grand',
      'n_parent',
      'n_orphan',
    ]);
    expect(store.noteTree()).toHaveLength(2);
    const root = store.noteTree()[0];
    expect(root.note.id).toBe('n_parent');
    expect(root.children[0].note.id).toBe('n_child');
    expect(root.children[0].children[0].note.id).toBe('n_grand');
    expect(store.noteTree()[1].note.id).toBe('n_orphan');
  });

  it('breaks parent cycles when loading stored notes', () => {
    const first = note('n_a', { parentId: 'n_b' });
    const second = note('n_b', { parentId: 'n_a' });

    const { store } = setup([first, second]);

    expect(store.notes().every((item) => item.parentId === null)).toBe(true);
    expect(store.noteTree()).toHaveLength(2);
  });

  it('returns the parent chain outermost first and stops at cycles', () => {
    const grandparent = note('n_grand');
    const parent = note('n_parent', { parentId: 'n_grand' });
    const child = note('n_child', { parentId: 'n_parent' });

    const { store } = setup([grandparent, parent, child]);

    expect(store.parentChain(child).map((item) => item.id)).toEqual(['n_grand', 'n_parent']);
  });

  it('filters by title, metadata, and block content', () => {
    const byTitle = note('n_title', { title: 'Grocery list' });
    const byMeta = note('n_meta', {
      metadata: [{ id: 'm_1', key: 'project', value: 'needle' }],
    });
    const byText = note('n_text', {
      blocks: [block('b_1', { type: 'text', columns: ['a needle here'], columnCount: 1 })],
    });
    const byItem = note('n_item', {
      blocks: [block('b_2', { type: 'list', items: ['needle'], text: '' })],
    });
    const byCaption = note('n_caption', {
      blocks: [block('b_3', { type: 'image', caption: 'needle photo' })],
    });
    const unrelated = note('n_other', { title: 'Something else' });

    const { store } = setup([byTitle, byMeta, byText, byItem, byCaption, unrelated]);

    store.query.set('NEEDLE');

    expect(
      store
        .filteredNotes()
        .map((item) => item.id)
        .sort(),
    ).toEqual(['n_caption', 'n_item', 'n_meta', 'n_text']);
  });

  it('does not select a note that does not exist', () => {
    const { store } = setup([note('n_a')]);

    store.select('n_missing');
    expect(store.selectedId()).toBe('n_a');

    store.select(null);
    expect(store.selectedId()).toBeNull();
  });

  it('restores the stored selection when it still exists', () => {
    localStorage.setItem(SELECTION_KEY, 'n_b');

    const { store } = setup([note('n_a'), note('n_b')]);

    expect(store.selectedId()).toBe('n_b');
  });

  it('updates note fields and metadata', () => {
    const { store, sync } = setup([note('n_a')]);

    store.setTitle('n_a', 'New title');
    store.setIcon('n_a', 'x'.repeat(40));
    store.setCover('n_a', 'data:image/png;base64,abc');

    const updated = store.notes()[0];
    expect(updated.title).toBe('New title');
    expect(updated.icon).toHaveLength(16);
    expect(updated.cover).toBe('data:image/png;base64,abc');
    expect(sync.markDirty).toHaveBeenCalledWith('n_a');

    const metaId = store.addMeta('n_a');
    store.updateMeta('n_a', metaId, { key: 'status', value: 'done' });
    expect(store.notes()[0].metadata).toEqual([{ id: metaId, key: 'status', value: 'done' }]);

    store.removeMeta('n_a', metaId);
    expect(store.notes()[0].metadata).toEqual([]);
  });

  it('gives two edits in the same millisecond distinct timestamps', () => {
    const { store } = setup([note('n_a', { updatedAt: 100 })]);

    store.setTitle('n_a', 'one');
    const first = store.notes()[0].updatedAt;
    store.setTitle('n_a', 'two');
    const second = store.notes()[0].updatedAt;

    expect(first).toBeGreaterThan(100);
    expect(second).toBeGreaterThan(first);
  });

  it('adds blocks', () => {
    const { store, sync } = setup([note('n_a')]);

    const added = store.addBlock('n_a', 'heading');

    expect(added.type).toBe('heading');
    expect(store.notes()[0].blocks.at(-1)?.id).toBe(added.id);
    expect(sync.markDirty).toHaveBeenCalledWith('n_a');
  });

  it('adds a sub-note block and its child note', () => {
    const { store, sync } = setup([note('n_a')]);

    const added = store.addSubnoteBlock('n_a');

    expect(added?.type).toBe('subnote');
    const parent = store.notes().find((item) => item.id === 'n_a')!;
    const child = store.notes().find((item) => item.id === added?.noteId)!;
    expect(parent.blocks.at(-1)?.id).toBe(added?.id);
    expect(child.parentId).toBe('n_a');
    expect(sync.markDirty).toHaveBeenCalledWith('n_a');
    expect(sync.markDirty).toHaveBeenCalledWith(child.id);
  });

  it('returns null when adding a sub-note to a missing note', () => {
    const { store } = setup();
    expect(store.addSubnoteBlock('missing')).toBeNull();
  });

  it('converts a block to a sub-note and moves its writing', () => {
    const text = block('b_1', { type: 'text', columns: ['keep me'], columnCount: 1 });
    const { store } = setup([note('n_a', { blocks: [text] })]);

    const converted = store.convertBlockToSubnote('n_a', 'b_1');

    expect(converted?.id).toBe('b_1');
    expect(converted?.type).toBe('subnote');
    const child = store.notes().find((item) => item.id === converted?.noteId)!;
    expect(child.blocks[0].columns).toEqual(['keep me']);
  });

  it('reuses an existing sub-note block and ignores missing blocks', () => {
    const existing = block('b_1', { type: 'subnote', noteId: 'n_child' });
    const { store } = setup([note('n_a', { blocks: [existing] })]);

    expect(store.convertBlockToSubnote('n_a', 'b_1')).toMatchObject({
      id: 'b_1',
      type: 'subnote',
      noteId: 'n_child',
    });
    expect(store.convertBlockToSubnote('n_a', 'missing')).toBeNull();
  });

  it('inserts blocks after a target or at the end', () => {
    const first = block('b_1');
    const second = block('b_2');
    const { store } = setup([note('n_a', { blocks: [first, second] })]);
    const inserted = block('b_new');

    store.insertBlocks('n_a', 'b_1', [inserted]);
    expect(store.notes()[0].blocks.map((item) => item.id)).toEqual(['b_1', 'b_new', 'b_2']);

    store.insertBlocks('n_a', null, [block('b_end')]);
    expect(store.notes()[0].blocks.map((item) => item.id)).toEqual([
      'b_1',
      'b_new',
      'b_2',
      'b_end',
    ]);

    store.insertBlocks('n_a', 'b_1', []);
    expect(store.notes()[0].blocks).toHaveLength(4);
  });

  it('updates blocks and clamps heading levels', () => {
    const heading = block('b_1', { type: 'heading', text: 'Old', level: 1 });
    const { store } = setup([note('n_a', { blocks: [heading] })]);

    store.updateBlock('n_a', 'b_1', { text: 'New', level: 0 });
    expect(store.notes()[0].blocks[0]).toMatchObject({ text: 'New', level: 1 });

    store.updateBlock('n_a', 'b_1', { level: 99 });
    expect(store.notes()[0].blocks[0].level).toBe(6);
  });

  it('changes block types while carrying content', () => {
    const text = block('b_1', { type: 'text', columns: ['hello'], columnCount: 1 });
    const { store } = setup([note('n_a', { blocks: [text] })]);

    store.setBlockType('n_a', 'b_1', 'heading');

    expect(store.notes()[0].blocks[0]).toMatchObject({ type: 'heading', text: 'hello' });
  });

  it('converts fenced text into code or function blocks', () => {
    const { store } = setup([
      note('n_a', {
        blocks: [
          block('b_math', { type: 'text' }),
          block('b_fn', { type: 'text' }),
          block('b_code', { type: 'text' }),
          block('b_heading', { type: 'heading' }),
        ],
      }),
    ]);

    store.convertTextBlockToCode('n_a', 'b_math', { language: 'math', text: 'x^2' });
    store.convertTextBlockToCode('n_a', 'b_fn', { language: 'fn', text: 'f(x)' });
    store.convertTextBlockToCode('n_a', 'b_code', { language: 'ts', text: 'const x = 1;' });
    store.convertTextBlockToCode('n_a', 'b_heading', { language: 'ts', text: 'nope' });

    const blocks = store.notes()[0].blocks;
    expect(blocks[0]).toMatchObject({ type: 'function', text: 'x^2', language: 'latex' });
    expect(blocks[1]).toMatchObject({ type: 'function', text: 'f(x)', language: '' });
    expect(blocks[2]).toMatchObject({ type: 'code', text: 'const x = 1;', language: 'ts' });
    expect(blocks[3].type).toBe('heading');
  });

  it('applies heading and list shortcuts only to text blocks', () => {
    const { store } = setup([
      note('n_a', {
        blocks: [
          block('b_heading', { type: 'text' }),
          block('b_list', { type: 'text' }),
          block('b_head', { type: 'heading' }),
        ],
      }),
    ]);

    const heading = store.applyBlockShortcut('n_a', 'b_heading', {
      kind: 'heading',
      level: 2,
      text: 'Title',
    });
    expect(heading).toMatchObject({ type: 'heading', level: 2, text: 'Title' });

    const list = store.applyBlockShortcut('n_a', 'b_list', {
      kind: 'list',
      ordered: true,
      items: ['one'],
    });
    expect(list).toMatchObject({ type: 'list', ordered: true, items: ['one'] });

    expect(
      store.applyBlockShortcut('n_a', 'b_head', {
        kind: 'list',
        ordered: false,
        items: ['no'],
      }),
    ).toBeNull();
  });

  it('updates text columns within bounds', () => {
    const { store } = setup([
      note('n_a', { blocks: [block('b_1', { type: 'text', columns: ['a'], columnCount: 1 })] }),
    ]);

    store.updateColumn('n_a', 'b_1', 2, 'c');
    expect(store.notes()[0].blocks[0].columns).toEqual(['a', '', 'c']);

    store.updateColumn('n_a', 'b_1', -1, 'no');
    store.updateColumn('n_a', 'b_1', 4, 'no');
    expect(store.notes()[0].blocks[0].columns).toEqual(['a', '', 'c']);
  });

  it('splits a text block at the caret and inserts the new block after it', () => {
    const { store } = setup([
      note('n_a', {
        blocks: [
          block('b_1', { type: 'text', columns: ['ab'], columnCount: 1 }),
          block('b_2', { type: 'text' }),
        ],
      }),
    ]);

    const created = store.splitTextBlock('n_a', 'b_1', {
      column: 0,
      before: 'a',
      after: 'b',
    });

    const blocks = store.notes()[0].blocks;
    expect(blocks.map((item) => item.id)).toEqual(['b_1', created!.id, 'b_2']);
    expect(blocks[0].columns[0]).toBe('a');
    expect(blocks[1].columns).toEqual(['b']);
    expect(store.splitTextBlock('n_a', 'b_1', { column: -1, before: '', after: '' })).toBeNull();
  });

  it('splits a heading into a new text block', () => {
    const { store } = setup([
      note('n_a', {
        blocks: [block('b_1', { type: 'heading', text: 'Titlebody', level: 2 })],
      }),
    ]);

    const created = store.splitHeadingBlock('n_a', 'b_1', { before: 'Title', after: 'body' });

    expect(store.notes()[0].blocks[0].text).toBe('Title');
    expect(created?.columns).toEqual(['body']);
    expect(store.splitHeadingBlock('n_a', 'b_1', { before: '', after: '' })).not.toBeNull();
    expect(store.splitHeadingBlock('n_a', 'missing', { before: '', after: '' })).toBeNull();
  });

  it('sets the text column count without destroying hidden columns', () => {
    const { store } = setup([
      note('n_a', {
        blocks: [block('b_1', { type: 'text', columns: ['a', 'b', 'c'], columnCount: 1 })],
      }),
    ]);

    store.setColumnCount('n_a', 'b_1', 2);
    expect(store.notes()[0].blocks[0]).toMatchObject({ columnCount: 2, columns: ['a', 'b', 'c'] });

    store.setColumnCount('n_a', 'b_1', 99);
    expect(store.notes()[0].blocks[0].columnCount).toBe(4);
    expect(store.notes()[0].blocks[0].columns).toEqual(['a', 'b', 'c', '']);

    store.setColumnCount('n_a', 'b_1', Number.NaN);
    expect(store.notes()[0].blocks[0].columnCount).toBe(4);
  });

  it('grows image columns with the column count', () => {
    const { store } = setup([
      note('n_a', { blocks: [block('b_1', { type: 'image', imageColumns: [] })] }),
    ]);

    store.setColumnCount('n_a', 'b_1', 3);

    const image = store.notes()[0].blocks[0];
    expect(image.columnCount).toBe(3);
    expect(image.imageColumns).toHaveLength(2);
    expect(image.imageColumns[0].type).toBe('text');
  });

  it('updates an image column within bounds', () => {
    const { store } = setup([
      note('n_a', {
        blocks: [
          block('b_1', {
            type: 'image',
            imageColumns: [createImageColumn('text', { text: 'old' })],
          }),
        ],
      }),
    ]);

    store.updateImageColumn('n_a', 'b_1', 0, { text: 'new' });
    expect(store.notes()[0].blocks[0].imageColumns[0].text).toBe('new');

    store.updateImageColumn('n_a', 'b_1', 2, { text: 'third' });
    expect(store.notes()[0].blocks[0].imageColumns).toHaveLength(3);

    store.updateImageColumn('n_a', 'b_1', 3, { text: 'no' });
    store.updateImageColumn('n_a', 'b_1', -1, { text: 'no' });
    expect(store.notes()[0].blocks[0].imageColumns).toHaveLength(3);
  });

  it('removes and reorders blocks', () => {
    const { store } = setup([
      note('n_a', {
        blocks: [block('b_1'), block('b_2'), block('b_3')],
      }),
    ]);

    store.moveBlock('n_a', 0, 2);
    expect(store.notes()[0].blocks.map((item) => item.id)).toEqual(['b_2', 'b_3', 'b_1']);

    store.moveBlock('n_a', 0, 0);
    store.moveBlock('n_a', -1, 2);
    store.moveBlock('n_a', 0, 9);
    expect(store.notes()[0].blocks.map((item) => item.id)).toEqual(['b_2', 'b_3', 'b_1']);

    store.removeBlock('n_a', 'b_3');
    expect(store.notes()[0].blocks.map((item) => item.id)).toEqual(['b_2', 'b_1']);
  });

  it('deletes a note, reparents children, and removes dangling sub-note blocks', () => {
    const deleted = note('n_deleted', {
      parentId: 'n_parent',
      updatedAt: 300,
      blocks: [block('b_1')],
    });
    const child = note('n_child', { parentId: 'n_deleted', updatedAt: 200 });
    const holder = note('n_holder', {
      updatedAt: 100,
      blocks: [block('b_sub', { type: 'subnote', noteId: 'n_deleted' })],
    });
    const parent = note('n_parent', { updatedAt: 50 });

    const { store, sync } = setup([deleted, child, holder, parent]);
    store.select('n_deleted');

    store.deleteNote('n_deleted');

    expect(store.notes().some((item) => item.id === 'n_deleted')).toBe(false);
    expect(store.notes().find((item) => item.id === 'n_child')?.parentId).toBe('n_parent');
    expect(store.notes().find((item) => item.id === 'n_holder')?.blocks).toEqual([]);
    expect(sync.markDeleted).toHaveBeenCalledWith('n_deleted');
    expect(sync.markDirty).toHaveBeenCalledWith('n_child');
    expect(sync.markDirty).toHaveBeenCalledWith('n_holder');
    expect(store.selectedId()).toBe('n_child');
  });

  it('persists notes and selection after the debounce', () => {
    vi.useFakeTimers();
    const { store } = setup();

    const created = store.createNote();
    store.setTitle(created.id, 'Saved');
    TestBed.tick();
    vi.advanceTimersByTime(300);

    const saved = JSON.parse(localStorage.getItem(NOTES_KEY) ?? '[]') as Note[];
    expect(saved).toHaveLength(1);
    expect(saved[0].title).toBe('Saved');
    expect(localStorage.getItem(SELECTION_KEY)).toBe(created.id);
  });

  it('reports a storage error when localStorage rejects the notes', () => {
    vi.useFakeTimers();
    const { store } = setup([note('n_a')]);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string) => {
      if (key === NOTES_KEY) throw new Error('QuotaExceededError');
    });

    store.setTitle('n_a', 'Big');
    TestBed.tick();
    vi.advanceTimersByTime(300);

    expect(store.storageError()).toBe('Storage is full. Recent edits are not being saved.');
  });

  it('normalizes stored blocks and restores old text shapes', () => {
    localStorage.setItem(
      NOTES_KEY,
      JSON.stringify([
        {
          id: 'n_old',
          title: 'Old note',
          text: 'legacy',
          blocks: [
            { id: 'b_text', type: 'text', text: 'legacy paragraph' },
            { id: 'b_bad', type: 'nonsense' },
            { id: 'b_list', type: 'list', items: ['one', 2, 'two'] },
            { id: 'b_head', type: 'heading', text: 'Title', level: 99 },
            { id: 'b_image', type: 'image', columnCount: 2, imageColumns: [] },
            { id: 'b_sub', type: 'subnote', noteId: 'n_child' },
          ],
          updatedAt: 10,
        },
      ]),
    );

    const { store } = setup();
    const blocks = store.notes()[0].blocks;

    expect(blocks.map((item) => item.id)).toEqual([
      'b_text',
      'b_list',
      'b_head',
      'b_image',
      'b_sub',
    ]);
    expect(blocks[0].columns).toEqual(['legacy paragraph']);
    expect(blocks[1].items).toEqual(['one', 'two']);
    expect(blocks[2].level).toBe(6);
    expect(blocks[3].imageColumns).toHaveLength(1);
    expect(blocks[4].noteId).toBe('n_child');
  });

  it('ignores corrupt stored notes', () => {
    localStorage.setItem(NOTES_KEY, 'not json');

    const { store } = setup();

    expect(store.notes()).toEqual([]);
  });

  it('applies remote notes and preserves newer local edits', () => {
    const { store, sync } = setup([
      note('n_local', { title: 'Local', updatedAt: 200 }),
      note('n_equal', { title: 'Local equal', updatedAt: 200 }),
    ]);
    const apply = remoteHandler(sync);

    expect(
      apply({
        notes: [
          remote('n_local', { title: 'Stale', updatedAt: 100 }),
          remote('n_equal', { title: 'Remote equal', updatedAt: 200 }),
          remote('n_remote', { title: 'Remote', updatedAt: 150 }),
        ],
        deletes: [],
        copies: [],
      }),
    ).toBe(true);

    expect(store.notes().find((item) => item.id === 'n_local')!.title).toBe('Local');
    expect(store.notes().find((item) => item.id === 'n_equal')!.title).toBe('Remote equal');
    expect(store.notes().find((item) => item.id === 'n_remote')!.title).toBe('Remote');
    expect(sync.notifyPersisted).toHaveBeenCalled();
  });

  it('applies remote deletes and falls back to the next selection', () => {
    const { store, sync } = setup([
      note('n_a', { updatedAt: 300 }),
      note('n_b', { updatedAt: 100 }),
    ]);
    store.select('n_a');
    TestBed.tick();

    remoteHandler(sync)({ notes: [], deletes: ['n_a'], copies: [] });

    expect(store.notes().map((item) => item.id)).toEqual(['n_b']);
    expect(store.selectedId()).toBe('n_b');
  });

  it('stores conflict copies and queues them for upload', () => {
    const { store, sync } = setup();

    remoteHandler(sync)({
      notes: [],
      deletes: [],
      copies: [remote('n_copy', { title: 'Conflict copy' }, '2-abc')],
    });

    expect(store.notes().find((item) => item.id === 'n_copy')!.title).toBe('Conflict copy');
    expect(sync.markDirty).toHaveBeenCalledWith('n_copy');
  });

  it('accepts an empty remote change without persisting', () => {
    const { sync } = setup();

    expect(remoteHandler(sync)({ notes: [], deletes: [], copies: [] })).toBe(true);
    expect(sync.notifyPersisted).not.toHaveBeenCalled();
  });

  it('returns false when a remote change cannot be stored', () => {
    const { store, sync } = setup();
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation((key: string) => {
      if (key === NOTES_KEY) throw new Error('QuotaExceededError');
    });

    expect(remoteHandler(sync)({ notes: [remote('n_remote')], deletes: [], copies: [] })).toBe(
      false,
    );
    expect(store.storageError()).toBe('Storage is full. Recent edits are not being saved.');
    expect(sync.notifyPersisted).toHaveBeenCalled();
  });

  it('normalizes remote notes before storing them', () => {
    const { store, sync } = setup();

    remoteHandler(sync)({
      notes: [
        {
          id: 'n_legacy',
          rev: '1',
          data: {
            title: 'Legacy',
            text: 'old paragraph',
            blocks: [{ id: 'b_text', type: 'text', text: 'old paragraph' }],
            updatedAt: 10,
          },
        },
      ],
      deletes: [],
      copies: [],
    });

    const stored = store.notes().find((item) => item.id === 'n_legacy')!;
    expect(stored.blocks[0].columns).toEqual(['old paragraph']);
    expect(stored.parentId).toBeNull();
  });

  it('surfaces remote parent cycles as roots', () => {
    const { store, sync } = setup();

    remoteHandler(sync)({
      notes: [
        remote('n_a', { parentId: 'n_b' }),
        remote('n_b', { parentId: 'n_a' }),
        remote('n_self', { parentId: 'n_self' }),
      ],
      deletes: [],
      copies: [],
    });

    const tree = store.noteTree();
    expect(tree).toHaveLength(2);
    expect(tree.map((item) => item.note.id).sort()).toEqual(['n_a', 'n_self']);
  });

  it('treats self-parented stored notes as roots', () => {
    const { store } = setup([note('n_self', { parentId: 'n_self' })]);

    expect(store.notes()[0].parentId).toBeNull();
    expect(store.noteTree()).toHaveLength(1);
  });

  it('matches searches inside extra image columns', () => {
    const byColumn = note('n_column', {
      blocks: [
        block('b_image', {
          type: 'image',
          columnCount: 2,
          imageColumns: [createImageColumn('image', { caption: 'needle side' })],
        }),
      ],
    });
    const { store } = setup([byColumn, note('n_other')]);

    store.query.set('needle');

    expect(store.filteredNotes().map((item) => item.id)).toEqual(['n_column']);
  });

  it('flushes pending notes when the window unloads', () => {
    const { store, sync } = setup([note('n_a')]);
    store.setTitle('n_a', 'Changed');

    window.dispatchEvent(new Event('beforeunload'));

    const saved = JSON.parse(localStorage.getItem(NOTES_KEY) ?? '[]') as Note[];
    expect(saved.find((item) => item.id === 'n_a')!.title).toBe('Changed');
    expect(sync.notifyPersisted).toHaveBeenCalled();
  });

  it('clears the pending title focus', () => {
    const { store } = setup();

    const created = store.createNote();
    expect(store.pendingTitleFocus()).toBe(created.id);

    store.clearTitleFocus();
    expect(store.pendingTitleFocus()).toBeNull();
  });

  it('falls back to the first note when the stored selection is gone', () => {
    localStorage.setItem(SELECTION_KEY, 'n_missing');

    const { store } = setup([note('n_a'), note('n_b', { updatedAt: 200 })]);

    expect(store.selectedId()).toBe('n_b');
  });

  it('starts empty when storage reads fail', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });

    const { store } = setup();

    expect(store.notes()).toEqual([]);
    expect(store.selectedId()).toBeNull();
  });

  it('normalizes malformed stored data', () => {
    localStorage.setItem(
      NOTES_KEY,
      JSON.stringify([
        null,
        {
          id: 'n_malformed',
          title: 5,
          metadata: [null, { key: 'k', value: 7 }],
          blocks: 'nope',
          updatedAt: 5,
        },
        {
          id: 'n_blocks',
          blocks: [
            null,
            { id: 'b_text', type: 'text', columns: [1, 'ok'], columnCount: 2 },
            { id: 'b_list', type: 'list', items: [] },
            { id: 'b_image', type: 'image', mainColumnType: 'text', imageColumns: 'nope' },
            {
              id: 'b_image_cols',
              type: 'image',
              columnCount: 3,
              imageColumns: [null, { type: 'image', caption: 'side' }],
            },
          ],
          updatedAt: 6,
        },
        'garbage',
      ]),
    );

    const { store } = setup();

    expect(
      store
        .notes()
        .map((item) => item.id)
        .sort(),
    ).toEqual(['n_blocks', 'n_malformed']);

    const malformed = store.notes().find((item) => item.id === 'n_malformed')!;
    expect(malformed.title).toBe('');
    expect(malformed.blocks).toEqual([]);
    expect(malformed.metadata).toHaveLength(1);
    expect(malformed.metadata[0]).toMatchObject({ key: 'k', value: '' });

    const blocks = store.notes().find((item) => item.id === 'n_blocks')!.blocks;
    expect(blocks.map((item) => item.id)).toEqual(['b_text', 'b_list', 'b_image', 'b_image_cols']);
    expect(blocks[0].columns).toEqual(['ok', '']);
    expect(blocks[1].items).toEqual(['']);
    expect(blocks[2].mainColumnType).toBe('text');
    expect(blocks[2].imageColumns).toHaveLength(0);
    expect(blocks[3].imageColumns).toHaveLength(2);
    expect(blocks[3].imageColumns[0]).toMatchObject({ type: 'image', caption: 'side' });
  });

  it('ignores a stored notes value that is not an array', () => {
    localStorage.setItem(NOTES_KEY, JSON.stringify({ notes: [] }));

    const { store } = setup();

    expect(store.notes()).toEqual([]);
  });

  it('keeps the selection when a remote change leaves it untouched', () => {
    const { store, sync } = setup([note('n_a', { updatedAt: 300 })]);
    store.select('n_a');
    TestBed.tick();

    remoteHandler(sync)({ notes: [remote('n_b')], deletes: [], copies: [] });

    expect(store.selectedId()).toBe('n_a');
  });

  it('ignores updates for missing notes and wrong block types', () => {
    const heading = block('b_head', { type: 'heading', text: 'H', level: 1 });
    const code = block('b_code', { type: 'code', text: 'x' });
    const { store } = setup([note('n_a', { blocks: [heading, code] })]);

    store.updateMeta('n_a', 'missing', { key: 'x' });
    store.moveBlock('missing', 0, 1);
    store.deleteNote('missing');
    expect(
      store.splitTextBlock('n_a', 'b_head', { column: 0, before: 'a', after: 'b' }),
    ).toBeNull();
    expect(store.splitHeadingBlock('n_a', 'b_code', { before: 'a', after: 'b' })).toBeNull();
    store.setColumnCount('n_a', 'b_code', 2);
    expect(store.parentChain({ ...note('n_x'), parentId: 'n_missing' })).toEqual([]);
    expect(store.notes()[0].blocks.map((item) => item.id)).toEqual(['b_head', 'b_code']);
  });

  it('converts blank blocks to sub-notes without copying content', () => {
    const empty = block('b_empty', { type: 'text', columns: [''], columnCount: 1 });
    const other = block('b_other');
    const { store } = setup([note('n_a', { blocks: [empty, other] })]);

    const converted = store.convertBlockToSubnote('n_a', 'b_empty');

    const child = store.notes().find((item) => item.id === converted!.noteId)!;
    expect(child.blocks).toHaveLength(1);
    expect(child.blocks[0]).toMatchObject({ type: 'text', columns: [''] });
    expect(
      store
        .notes()
        .find((item) => item.id === 'n_a')!
        .blocks.map((item) => item.id),
    ).toEqual(['b_empty', 'b_other']);
  });
});
