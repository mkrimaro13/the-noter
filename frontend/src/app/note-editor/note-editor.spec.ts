import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Note, createBlock, createImageColumn, createNote } from '../models';
import { NoteBlock as NoteBlockEditor } from '../note-block/note-block';
import { NoteStore } from '../note-store';
import { SyncService, SyncStatus } from '../sync';
import { NoteEditor } from './note-editor';

const NOTES_KEY = 'the-noter.notes.v1';

function fakeSync() {
  return {
    status: signal<SyncStatus>('idle'),
    message: signal(''),
    start: vi.fn(),
    markDirty: vi.fn(),
    markDeleted: vi.fn(),
    notifyPersisted: vi.fn(),
  };
}

function note(id: string, patch: Partial<Note> = {}): Note {
  return { ...createNote(), id, title: id, updatedAt: Date.now(), ...patch };
}

function setup(seed: Note[], editorNoteId = 'n_note') {
  localStorage.setItem(NOTES_KEY, JSON.stringify(seed));
  const sync = fakeSync();
  TestBed.configureTestingModule({
    providers: [{ provide: SyncService, useValue: sync }],
  });
  const store = TestBed.inject(NoteStore);
  const fixture = TestBed.createComponent(NoteEditor);
  const current = () => store.notes().find((item) => item.id === editorNoteId)!;
  fixture.componentRef.setInput('note', current());
  fixture.detectChanges();
  return {
    fixture,
    store,
    sync,
    refresh: () => {
      fixture.componentRef.setInput('note', current());
      fixture.detectChanges();
    },
  };
}

function inputEvent(): Event {
  return new Event('input', { bubbles: true });
}

function keyEvent(key: string, patch: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...patch });
}

function findMenuItem(element: HTMLElement, label: string): HTMLButtonElement {
  return Array.from(element.querySelectorAll<HTMLButtonElement>('.block-menu button')).find(
    (button) => button.textContent?.includes(label),
  )!;
}

describe('NoteEditor', () => {
  beforeEach(() => TestBed.resetTestingModule());

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('renders the note title, metadata, blocks, and word count', () => {
    const seeded = note('n_note', {
      title: 'My note',
      metadata: [{ id: 'm_1', key: 'status', value: 'draft' }],
      blocks: [
        createBlock('text', { columns: ['one two'], columnCount: 1 }),
        createBlock('heading', { text: 'three', level: 2 }),
      ],
    });
    const { fixture } = setup([seeded]);
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector<HTMLInputElement>('.title')!.value).toBe('My note');
    expect(element.querySelectorAll('.meta-row')).toHaveLength(1);
    expect(element.querySelector<HTMLInputElement>('.meta-key')!.value).toBe('status');
    expect(element.querySelectorAll('app-note-block')).toHaveLength(2);
    expect(element.querySelector('.word-count')?.textContent).toContain('3 words');
  });

  it('shows an empty-note message when there are no blocks', () => {
    const { fixture } = setup([note('n_note', { blocks: [] })]);
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.empty-note')?.textContent).toContain(
      'This note is empty. Add a block to begin.',
    );
    expect(element.querySelector('.word-count')).toBeNull();
  });

  it('updates the note title while typing', () => {
    const { fixture, store } = setup([note('n_note')]);
    const title = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>('.title')!;

    title.value = 'Renamed note';
    title.dispatchEvent(inputEvent());

    expect(store.notes().find((item) => item.id === 'n_note')?.title).toBe('Renamed note');
  });

  it('adds, edits, resolves, and removes metadata', () => {
    const { fixture, store, refresh } = setup([note('n_note')]);
    const element = fixture.nativeElement as HTMLElement;

    element.querySelector<HTMLButtonElement>('.meta-add')!.click();
    refresh();
    const metadata = store.notes().find((item) => item.id === 'n_note')!.metadata;
    expect(metadata).toHaveLength(1);

    const metaId = metadata[0].id;
    const key = element.querySelector<HTMLInputElement>('.meta-key')!;
    key.value = 'created';
    key.dispatchEvent(inputEvent());

    const value = element.querySelector<HTMLInputElement>('.meta-value')!;
    value.value = 'now()';
    value.dispatchEvent(keyEvent('Enter'));

    const updated = store
      .notes()
      .find((item) => item.id === 'n_note')!
      .metadata.find((item) => item.id === metaId)!;
    expect(updated.key).toBe('created');
    expect(updated.value).not.toBe('now()');
    expect(updated.value.length).toBeGreaterThan(0);

    element.querySelector<HTMLButtonElement>('.meta-remove')!.click();
    expect(store.notes().find((item) => item.id === 'n_note')!.metadata).toEqual([]);
  });

  it('adds blocks from the add menu', () => {
    const { fixture, store, refresh } = setup([note('n_note', { blocks: [] })]);
    const element = fixture.nativeElement as HTMLElement;

    element.querySelector<HTMLButtonElement>('.add-block')!.click();
    fixture.detectChanges();
    expect(element.querySelector('.block-menu')).not.toBeNull();

    findMenuItem(element, 'Heading').click();
    refresh();

    const blocks = store.notes().find((item) => item.id === 'n_note')!.blocks;
    expect(blocks.map((block) => block.type)).toEqual(['heading']);
    expect(element.querySelector('.block-menu')).toBeNull();
    expect(element.querySelectorAll('app-note-block')).toHaveLength(1);
  });

  it('adds a sub-note block and a child note', () => {
    const { fixture, store, refresh } = setup([note('n_note', { blocks: [] })]);
    const element = fixture.nativeElement as HTMLElement;

    element.querySelector<HTMLButtonElement>('.add-block')!.click();
    fixture.detectChanges();
    findMenuItem(element, 'Sub-note').click();
    refresh();

    const blocks = store.notes().find((item) => item.id === 'n_note')!.blocks;
    expect(blocks[0].type).toBe('subnote');
    const child = store.notes().find((item) => item.id === blocks[0].noteId)!;
    expect(child.parentId).toBe('n_note');
    expect(element.querySelectorAll('app-subnote-block')).toHaveLength(1);
  });

  it('shows child notes and opens or creates them', () => {
    const parent = note('n_note', { title: 'Parent', blocks: [] });
    const child = note('n_child', { title: 'Child', parentId: 'n_note' });
    const { fixture, store } = setup([parent, child]);
    const element = fixture.nativeElement as HTMLElement;

    const card = element.querySelector<HTMLButtonElement>('.subnote-card')!;
    expect(card.textContent).toContain('Child');

    card.click();
    expect(store.selectedId()).toBe('n_child');

    element.querySelector<HTMLButtonElement>('.subnote-add')!.click();
    const created = store
      .notes()
      .find((item) => item.parentId === 'n_note' && item.id !== 'n_child');
    expect(created).toBeDefined();
    expect(store.selectedId()).toBe(created!.id);
  });

  it('renders breadcrumbs and navigates to an ancestor', () => {
    const grandparent = note('n_grand', { title: 'Grandparent' });
    const parent = note('n_parent', { title: 'Parent', parentId: 'n_grand' });
    const current = note('n_note', { title: 'Current', parentId: 'n_parent' });
    const { fixture, store } = setup([grandparent, parent, current]);
    const element = fixture.nativeElement as HTMLElement;

    const crumbs = element.querySelectorAll<HTMLButtonElement>('.crumb');
    expect(Array.from(crumbs).map((crumb) => crumb.textContent?.trim())).toEqual([
      'Grandparent',
      'Parent',
    ]);
    expect(element.querySelector('.crumb-current')?.textContent?.trim()).toBe('Current');

    crumbs[0].click();
    expect(store.selectedId()).toBe('n_grand');
  });

  it('chooses, customises, and removes the note icon', () => {
    const { fixture, store, refresh } = setup([note('n_note')]);
    const element = fixture.nativeElement as HTMLElement;

    element.querySelector<HTMLButtonElement>('.icon-add')!.click();
    fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('.icon-choice')!.click();
    expect(store.notes().find((item) => item.id === 'n_note')!.icon.length).toBeGreaterThan(0);

    refresh();
    element.querySelector<HTMLButtonElement>('.icon-add')!.click();
    fixture.detectChanges();
    const custom = element.querySelector<HTMLInputElement>('.icon-input')!;
    custom.value = '★';
    custom.dispatchEvent(keyEvent('Enter'));
    expect(store.notes().find((item) => item.id === 'n_note')!.icon).toBe('★');

    refresh();
    element.querySelector<HTMLButtonElement>('.icon-add')!.click();
    fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('.icon-remove')!.click();
    expect(store.notes().find((item) => item.id === 'n_note')!.icon).toBe('');
  });

  it('removes a cover and reports a bad cover file', async () => {
    const { fixture, store, refresh } = setup([
      note('n_note', { cover: 'data:image/png;base64,abc' }),
    ]);
    const element = fixture.nativeElement as HTMLElement;

    element.querySelector<HTMLButtonElement>('.cover-remove')!.click();
    expect(store.notes().find((item) => item.id === 'n_note')!.cover).toBe('');

    refresh();
    const picker = element.querySelector<HTMLInputElement>('.cover-picker')!;
    const file = new File(['text'], 'notes.txt', { type: 'text/plain' });
    Object.defineProperty(picker, 'files', { configurable: true, value: [file] });
    picker.dispatchEvent(new Event('change'));

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(element.querySelector('.cover-error')?.textContent).toContain(
        'That file is not an image.',
      );
    });
  });

  it('wires block edits, deletion, movement, and splitting to the store', () => {
    const heading = {
      ...createBlock('heading', { text: 'Titlebody', level: 2 }),
      id: 'b_heading',
    };
    const text = { ...createBlock('text', { columns: ['second'], columnCount: 1 }), id: 'b_text' };
    const { fixture, store, refresh } = setup([note('n_note', { blocks: [heading, text] })]);
    const element = fixture.nativeElement as HTMLElement;

    const textInput = element.querySelector<HTMLTextAreaElement>('.text-input')!;
    textInput.value = 'edited';
    textInput.dispatchEvent(inputEvent());
    expect(store.notes().find((item) => item.id === 'n_note')!.blocks[1].columns).toEqual([
      'edited',
    ]);

    const headingInput = element.querySelector<HTMLTextAreaElement>('.heading-input')!;
    headingInput.setSelectionRange(5, 5);
    headingInput.dispatchEvent(keyEvent('Enter'));
    expect(store.notes().find((item) => item.id === 'n_note')!.blocks).toHaveLength(3);
    expect(store.notes().find((item) => item.id === 'n_note')!.blocks[0].text).toBe('Title');

    refresh();
    const before = store
      .notes()
      .find((item) => item.id === 'n_note')!
      .blocks.map((block) => block.id);
    const handles = element.querySelectorAll<HTMLButtonElement>('.handle');
    handles[0].dispatchEvent(keyEvent('ArrowDown'));
    const after = store
      .notes()
      .find((item) => item.id === 'n_note')!
      .blocks.map((block) => block.id);
    expect(after).toEqual([before[1], before[0], before[2]]);

    refresh();
    element.querySelector<HTMLButtonElement>('.remove')!.click();
    expect(store.notes().find((item) => item.id === 'n_note')!.blocks).toHaveLength(2);
  });

  it('converts a block into a sub-note from the type menu', () => {
    const text = { ...createBlock('text', { columns: ['keep me'], columnCount: 1 }), id: 'b_text' };
    const { fixture, store } = setup([note('n_note', { blocks: [text] })]);
    const element = fixture.nativeElement as HTMLElement;

    element.querySelector<HTMLButtonElement>('.type-toggle')!.click();
    fixture.detectChanges();
    const subnote = Array.from(
      element.querySelectorAll<HTMLButtonElement>('.type-menu button'),
    ).find((button) => button.textContent?.includes('Sub-note'))!;
    subnote.click();

    const blocks = store.notes().find((item) => item.id === 'n_note')!.blocks;
    expect(blocks[0].type).toBe('subnote');
    const child = store.notes().find((item) => item.id === blocks[0].noteId)!;
    expect(child.blocks[0].columns).toEqual(['keep me']);
  });

  it('pastes images into the note and ignores empty clipboards', async () => {
    const { fixture, store } = setup([note('n_note', { blocks: [] })]);
    const element = fixture.nativeElement as HTMLElement;

    const empty = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(empty, 'clipboardData', { value: { files: [], items: [] } });
    element.querySelector('.editor')!.dispatchEvent(empty);
    await Promise.resolve();
    expect(store.notes().find((item) => item.id === 'n_note')!.blocks).toEqual([]);

    const file = new File(['image'], 'photo.png', { type: 'image/png' });
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(paste, 'clipboardData', { value: { files: [file], items: [] } });
    element.querySelector('.editor')!.dispatchEvent(paste);

    await vi.waitFor(() => {
      const blocks = store.notes().find((item) => item.id === 'n_note')!.blocks;
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('image');
      expect(blocks[0].src.startsWith('data:image/png')).toBe(true);
    });
    expect(paste.defaultPrevented).toBe(true);
  });

  it('forwards block edits and column changes to the note', () => {
    const text = {
      ...createBlock('text', { columns: ['start'], columnCount: 1 }),
      id: 'b_text',
    };
    const image = {
      ...createBlock('image', { src: 'data:image/png;base64,old', columnCount: 2 }),
      id: 'b_image',
      imageColumns: [createImageColumn()],
    };
    const { fixture, store } = setup([note('n_note', { blocks: [text, image] })]);

    const textEditor = editorFor(fixture, 'b_text');
    textEditor.changed.emit({ text: 'changed' });
    textEditor.columnChanged.emit({ index: 0, value: 'first column' });
    textEditor.columnCountChanged.emit(2);
    editorFor(fixture, 'b_image').imageColumnChanged.emit({
      index: 0,
      patch: { type: 'image', src: 'data:image/png;base64,new' },
    });

    const blocks = store.notes().find((item) => item.id === 'n_note')!.blocks;
    expect(blocks.find((block) => block.id === 'b_text')).toMatchObject({
      text: 'changed',
      columns: ['first column', ''],
      columnCount: 2,
    });
    expect(blocks.find((block) => block.id === 'b_image')!.imageColumns[0]).toMatchObject({
      type: 'image',
      src: 'data:image/png;base64,new',
    });
  });

  it('splits, fences, shortcuts, and converts blocks', () => {
    const text = {
      ...createBlock('text', { columns: ['hello world'], columnCount: 1 }),
      id: 'b_text',
    };
    const heading = {
      ...createBlock('heading', { text: 'Titlebody', level: 2 }),
      id: 'b_heading',
    };
    const shortcut = {
      ...createBlock('text', { columns: ['## Shortcut'], columnCount: 1 }),
      id: 'b_shortcut',
    };
    const { fixture, store } = setup([note('n_note', { blocks: [text, heading, shortcut] })]);

    editorFor(fixture, 'b_text').split.emit({ column: 0, before: 'hello', after: ' world' });
    editorFor(fixture, 'b_heading').headingSplit.emit({ before: 'Title', after: 'body' });
    let blocks = store.notes().find((item) => item.id === 'n_note')!.blocks;
    expect(blocks).toHaveLength(5);
    expect(blocks.find((block) => block.id === 'b_heading')!.text).toBe('Title');

    editorFor(fixture, 'b_text').fence.emit({ language: 'ts', text: 'const x = 1' });
    blocks = store.notes().find((item) => item.id === 'n_note')!.blocks;
    expect(blocks.find((block) => block.id === 'b_text')).toMatchObject({
      type: 'code',
      language: 'ts',
      text: 'const x = 1',
    });

    editorFor(fixture, 'b_shortcut').shortcut.emit({
      kind: 'heading',
      level: 3,
      text: 'Shortcut',
    });
    blocks = store.notes().find((item) => item.id === 'n_note')!.blocks;
    expect(blocks.find((block) => block.id === 'b_shortcut')).toMatchObject({
      type: 'heading',
      level: 3,
      text: 'Shortcut',
    });

    editorFor(fixture, 'b_heading').typeChanged.emit('list');
    blocks = store.notes().find((item) => item.id === 'n_note')!.blocks;
    expect(blocks.find((block) => block.id === 'b_heading')!.type).toBe('list');
  });

  it('moves, focuses, removes, and drops blocks', () => {
    const one = { ...createBlock('text', { columns: ['one'], columnCount: 1 }), id: 'b_one' };
    const two = { ...createBlock('text', { columns: ['two'], columnCount: 1 }), id: 'b_two' };
    const { fixture, store } = setup([note('n_note', { blocks: [one, two] })]);
    const component = fixture.componentInstance as unknown as {
      onDrop(event: { previousIndex: number; currentIndex: number }): void;
    };

    editorFor(fixture, 'b_two').move.emit(0);
    expect(
      store
        .notes()
        .find((item) => item.id === 'n_note')!
        .blocks.map((block) => block.id),
    ).toEqual(['b_two', 'b_one']);

    editorFor(fixture, 'b_two').focused.emit();
    component.onDrop({ previousIndex: 0, currentIndex: 0 });
    expect(
      store
        .notes()
        .find((item) => item.id === 'n_note')!
        .blocks.map((block) => block.id),
    ).toEqual(['b_two', 'b_one']);

    component.onDrop({ previousIndex: 0, currentIndex: 1 });
    expect(
      store
        .notes()
        .find((item) => item.id === 'n_note')!
        .blocks.map((block) => block.id),
    ).toEqual(['b_one', 'b_two']);

    editorFor(fixture, 'b_two').removed.emit();
    expect(
      store
        .notes()
        .find((item) => item.id === 'n_note')!
        .blocks.map((block) => block.id),
    ).toEqual(['b_one']);
  });

  it('browses, replaces, and drops cover images', async () => {
    const { fixture, store, refresh } = setup([
      note('n_note', { cover: 'data:image/png;base64,abc' }),
    ]);
    const element = fixture.nativeElement as HTMLElement;
    const picker = element.querySelector<HTMLInputElement>('.cover-picker')!;
    const click = vi.spyOn(picker, 'click').mockImplementation(() => undefined);

    element.querySelector<HTMLButtonElement>('.cover-add')!.click();
    element.querySelector<HTMLButtonElement>('.cover-replace')!.click();
    expect(click).toHaveBeenCalledTimes(2);

    const cover = element.querySelector<HTMLElement>('.note-cover')!;
    const dragOver = new Event('dragover', { bubbles: true, cancelable: true });
    cover.dispatchEvent(dragOver);
    expect(dragOver.defaultPrevented).toBe(true);

    const file = new File(['image'], 'cover.png', { type: 'image/png' });
    const drop = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(drop, 'dataTransfer', { value: { files: [file] } });
    cover.dispatchEvent(drop);

    await vi.waitFor(() => {
      refresh();
      expect(store.notes().find((item) => item.id === 'n_note')!.cover).toMatch(/^data:image\/png/);
    });
    expect(drop.defaultPrevented).toBe(true);
  });

  it('closes the icon menu and ignores blank custom icons', () => {
    vi.useFakeTimers();
    const { fixture, store } = setup([note('n_note')]);
    const element = fixture.nativeElement as HTMLElement;
    const toggle = element.querySelector<HTMLButtonElement>('.icon-add')!;

    toggle.click();
    fixture.detectChanges();
    vi.runAllTimers();
    expect(document.activeElement).toBe(element.querySelector('.icon-input'));
    element.querySelector<HTMLElement>('.icon-backdrop')!.click();
    fixture.detectChanges();
    expect(element.querySelector('.icon-menu')).toBeNull();

    toggle.click();
    fixture.detectChanges();
    const input = element.querySelector<HTMLInputElement>('.icon-input')!;
    input.value = '   ';
    element.querySelector<HTMLButtonElement>('.icon-set')!.click();
    fixture.detectChanges();
    expect(element.querySelector('.icon-menu')).not.toBeNull();

    input.value = '★';
    element.querySelector<HTMLButtonElement>('.icon-set')!.click();
    fixture.detectChanges();
    expect(store.notes().find((item) => item.id === 'n_note')!.icon).toBe('★');
    expect(element.querySelector('.icon-menu')).toBeNull();

    toggle.click();
    fixture.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    fixture.detectChanges();
    expect(element.querySelector('.icon-menu')).toBeNull();
  });

  it('commits metadata values on blur and leaves plain values alone', () => {
    const { fixture, store } = setup([
      note('n_note', {
        metadata: [{ id: 'm_1', key: 'status', value: 'draft' }],
      }),
    ]);
    const element = fixture.nativeElement as HTMLElement;
    const value = element.querySelector<HTMLInputElement>('.meta-value')!;

    value.value = 'plain text';
    value.dispatchEvent(inputEvent());
    value.dispatchEvent(new Event('blur'));
    expect(store.notes().find((item) => item.id === 'n_note')!.metadata[0].value).toBe(
      'plain text',
    );

    value.value = 'now()';
    value.dispatchEvent(new Event('blur'));
    const committed = store.notes().find((item) => item.id === 'n_note')!.metadata[0].value;
    expect(committed).not.toBe('now()');
    expect(value.value).toBe(committed);

    element.querySelector<HTMLButtonElement>('.meta-remove')!.click();
    expect(store.notes().find((item) => item.id === 'n_note')!.metadata).toEqual([]);
  });

  it('closes the add menu from the backdrop and Escape, restoring focus', () => {
    vi.useFakeTimers();
    const { fixture } = setup([note('n_note', { blocks: [] })]);
    const element = fixture.nativeElement as HTMLElement;
    const add = element.querySelector<HTMLButtonElement>('.add-block')!;

    add.click();
    fixture.detectChanges();
    element.querySelector<HTMLElement>('.menu-backdrop')!.click();
    fixture.detectChanges();
    expect(element.querySelector('.block-menu')).toBeNull();

    add.click();
    fixture.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    vi.runAllTimers();
    fixture.detectChanges();

    expect(element.querySelector('.block-menu')).toBeNull();
    expect(document.activeElement).toBe(add);
  });

  it('replaces an image block and appends extra pasted images', async () => {
    const image = { ...createBlock('image', { src: '' }), id: 'b_image' };
    const { fixture, store } = setup([note('n_note', { blocks: [image] })]);
    const element = fixture.nativeElement as HTMLElement;
    const target = element.querySelector<HTMLElement>('[data-block-id="b_image"]')!;
    const files = [
      new File(['one'], 'one.png', { type: 'image/png' }),
      new File(['two'], 'two.png', { type: 'image/png' }),
    ];

    const event = pasteOn(target, { files });
    expect(event.defaultPrevented).toBe(true);

    await vi.waitFor(() => {
      const blocks = store.notes().find((item) => item.id === 'n_note')!.blocks;
      expect(blocks).toHaveLength(2);
      expect(blocks[0]).toMatchObject({ type: 'image', caption: '', mainColumnType: 'image' });
      expect(blocks[0].src).toMatch(/^data:image\/png/);
      expect(blocks[1].type).toBe('image');
      expect(blocks[1].src).toMatch(/^data:image\/png/);
    });
  });

  it('pastes into an existing image column', async () => {
    const image = {
      ...createBlock('image', { src: 'data:image/png;base64,main', columnCount: 2 }),
      id: 'b_image',
      imageColumns: [createImageColumn()],
    };
    const { fixture, store } = setup([note('n_note', { blocks: [image] })]);
    const element = fixture.nativeElement as HTMLElement;
    const target = element.querySelector<HTMLElement>('[data-image-column="1"]')!;

    pasteOn(target, {
      files: [
        new File(['one'], 'one.png', { type: 'image/png' }),
        new File(['two'], 'two.png', { type: 'image/png' }),
      ],
    });

    await vi.waitFor(() => {
      const blocks = store.notes().find((item) => item.id === 'n_note')!.blocks;
      expect(blocks[0].imageColumns[0]).toMatchObject({
        type: 'image',
        caption: '',
      });
      expect(blocks[0].imageColumns[0].src).toMatch(/^data:image\/png/);
      expect(blocks).toHaveLength(2);
      expect(blocks[1].type).toBe('image');
    });
  });

  it('pastes into an inline sub-note and ignores non-image files', async () => {
    const subnote = { ...createBlock('subnote', { noteId: 'n_child' }), id: 'b_sub' };
    const parent = note('n_note', { blocks: [subnote] });
    const child = note('n_child', {
      parentId: 'n_note',
      blocks: [{ ...createBlock('text', { columns: ['child'] }), id: 'b_child' }],
    });
    const { fixture, store } = setup([parent, child]);
    const element = fixture.nativeElement as HTMLElement;
    const target = element.querySelector<HTMLElement>('app-subnote-block[data-note-id="n_child"]')!;

    pasteOn(target, { files: [new File(['text'], 'notes.txt', { type: 'text/plain' })] });
    expect(store.notes().find((item) => item.id === 'n_child')!.blocks).toHaveLength(1);

    pasteOn(target, { files: [new File(['image'], 'child.png', { type: 'image/png' })] });
    await vi.waitFor(() => {
      const blocks = store.notes().find((item) => item.id === 'n_child')!.blocks;
      expect(blocks).toHaveLength(2);
      expect(blocks[1].type).toBe('image');
    });
  });

  it('uses clipboard items when files are missing and reports unreadable images', async () => {
    const { fixture, store } = setup([note('n_note', { blocks: [] })]);
    const element = fixture.nativeElement as HTMLElement;
    const editor = element.querySelector<HTMLElement>('.editor')!;
    const file = new File(['image'], 'item.png', { type: 'image/png' });

    pasteOn(editor, {
      items: [
        { kind: 'string', type: 'text/plain', getAsFile: () => null },
        { kind: 'file', type: 'image/png', getAsFile: () => file },
        { kind: 'file', type: 'image/png', getAsFile: () => null },
      ],
    });

    await vi.waitFor(() => {
      const blocks = store.notes().find((item) => item.id === 'n_note')!.blocks;
      expect(blocks).toHaveLength(1);
      expect(blocks[0].type).toBe('image');
    });

    const huge = new File(['image'], 'huge.png', { type: 'image/png' });
    Object.defineProperty(huge, 'size', { value: 16 * 1024 * 1024 });
    pasteOn(editor, { files: [huge] });

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(element.querySelector('.paste-error')?.textContent).toContain(
        'Images must be smaller than 15 MB.',
      );
    });
  });

  it('ignores pastes outside the editor', () => {
    const { fixture, store } = setup([note('n_note', { blocks: [] })]);
    const file = new File(['image'], 'outside.png', { type: 'image/png' });

    pasteOn(document.body, { files: [file] });

    expect(store.notes().find((item) => item.id === 'n_note')!.blocks).toEqual([]);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.paste-error')).toBeNull();
  });

  it('shows Untitled and Empty labels and singular word counts', () => {
    const parent = note('n_note', { title: '', blocks: [] });
    const child = note('n_child', { parentId: 'n_note', title: '', blocks: [] });
    const { fixture } = setup([parent, child]);
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.visually-hidden')?.textContent).toBe('Untitled note');
    expect(element.querySelector('.subnote-name')?.textContent?.trim()).toBe('Untitled');
    expect(element.querySelector('.subnote-sub')?.textContent).toContain('Empty');
    expect(element.querySelector('.subnotes-count')?.textContent).toContain('1');
    expect(element.querySelector('.word-count')).toBeNull();
  });

  it('renders singular word counts', () => {
    const { fixture } = setup([
      note('n_note', {
        blocks: [{ ...createBlock('text', { columns: ['word'], columnCount: 1 }), id: 'b_1' }],
      }),
    ]);
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.word-count')?.textContent).toContain('1 word');
    expect(element.querySelector('.status-word-count')?.textContent).toContain('1 word');
  });
});

function editorFor(fixture: ReturnType<typeof setup>['fixture'], blockId: string): NoteBlockEditor {
  const editor = fixture.debugElement
    .queryAll(By.directive(NoteBlockEditor))
    .map((debug) => debug.componentInstance as NoteBlockEditor)
    .find((instance) => instance.block().id === blockId);
  if (!editor) throw new Error(`No block editor for ${blockId}`);
  return editor;
}

function pasteOn(
  target: Element,
  data: {
    files?: File[];
    items?: Array<{ kind: string; type: string; getAsFile: () => File | null }>;
  },
): Event {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', {
    value: { files: data.files ?? [], items: data.items ?? [] },
  });
  target.dispatchEvent(event);
  return event;
}
