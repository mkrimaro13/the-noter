import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Note, NoteBlock, createBlock, createNote } from '../models';
import { NoteStore } from '../note-store';
import { NoteBlock as NoteBlockEditor } from '../note-block/note-block';
import { SyncService, SyncStatus } from '../sync';
import { SubnoteBlock } from './subnote-block';

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

function childNote(): Note {
  return {
    ...createNote('n_parent'),
    id: 'n_child',
    title: 'Child note',
    icon: '💡',
    blocks: [
      {
        ...createBlock('text', { columns: ['child writing'], columnCount: 1 }),
        id: 'b_child',
      },
    ],
  };
}

function subnoteBlock(noteId = 'n_child'): NoteBlock {
  return { ...createBlock('subnote', { noteId }), id: 'b_sub' };
}

function setup(
  block = subnoteBlock(),
  child = childNote(),
  focusOnInit = false,
  extra: Note[] = [],
) {
  const parent: Note = {
    ...createNote(),
    id: 'n_parent',
    title: 'Parent',
    blocks: [block],
  };
  localStorage.setItem(NOTES_KEY, JSON.stringify([parent, child, ...extra]));
  const sync = fakeSync();
  TestBed.configureTestingModule({
    providers: [{ provide: SyncService, useValue: sync }],
  });
  const store = TestBed.inject(NoteStore);
  const fixture = TestBed.createComponent(SubnoteBlock);
  fixture.componentRef.setInput('block', block);
  fixture.componentRef.setInput('index', 0);
  fixture.componentRef.setInput('total', 1);
  fixture.componentRef.setInput('focusOnInit', focusOnInit);
  fixture.detectChanges();
  return { fixture, store, sync };
}

describe('SubnoteBlock', () => {
  beforeEach(() => TestBed.resetTestingModule());

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('renders the child note title, icon, and blocks', () => {
    const { fixture } = setup();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.getAttribute('data-note-id')).toBe('n_child');
    expect(element.querySelector<HTMLInputElement>('.subnote-title')!.value).toBe('Child note');
    expect(element.querySelector('.subnote-mark')?.textContent).toContain('💡');
    expect(element.querySelectorAll('app-note-block')).toHaveLength(1);
    expect(element.querySelector('.subnote-open')?.textContent).toContain('Open');
  });

  it('updates the child title while typing', () => {
    const { fixture, store } = setup();
    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      '.subnote-title',
    )!;

    input.value = 'Renamed child';
    input.dispatchEvent(new Event('input'));

    expect(store.notes().find((note) => note.id === 'n_child')?.title).toBe('Renamed child');
  });

  it('opens the child note in the editor', () => {
    const { fixture, store } = setup();

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.subnote-open')!
      .click();

    expect(store.selectedId()).toBe('n_child');
  });

  it('wires block edits to the child note', () => {
    const { fixture, store } = setup();
    const input = (fixture.nativeElement as HTMLElement).querySelector<HTMLTextAreaElement>(
      '.text-input',
    )!;

    input.value = 'edited inside';
    input.dispatchEvent(new Event('input'));

    const child = store.notes().find((note) => note.id === 'n_child')!;
    expect(child.blocks[0].columns).toEqual(['edited inside']);
  });

  it('adds blocks to the child note from the menu', () => {
    const { fixture, store } = setup();
    const element = fixture.nativeElement as HTMLElement;

    element.querySelector<HTMLButtonElement>('.subnote-add-block')!.click();
    fixture.detectChanges();

    const menu = element.querySelector('.subnote-menu')!;
    const heading = Array.from(menu.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.textContent?.includes('Heading'),
    )!;
    heading.click();
    fixture.detectChanges();

    const child = store.notes().find((note) => note.id === 'n_child')!;
    expect(child.blocks.map((block) => block.type)).toEqual(['text', 'heading']);
    expect(element.querySelector('.subnote-menu')).toBeNull();
  });

  it('creates a nested sub-note from the menu', () => {
    const { fixture, store } = setup();
    const element = fixture.nativeElement as HTMLElement;

    element.querySelector<HTMLButtonElement>('.subnote-add-block')!.click();
    fixture.detectChanges();
    const subnote = Array.from(
      element.querySelectorAll<HTMLButtonElement>('.subnote-menu button'),
    ).find((button) => button.textContent?.includes('Sub-note'))!;
    subnote.click();

    const child = store.notes().find((note) => note.id === 'n_child')!;
    const nested = child.blocks.find((block) => block.type === 'subnote')!;
    const grandchild = store.notes().find((note) => note.id === nested.noteId)!;
    expect(grandchild.parentId).toBe('n_child');
  });

  it('emits removed when the sub-note block is deleted', () => {
    const { fixture } = setup();
    const removed = vi.fn();
    fixture.componentInstance.removed.subscribe(removed);

    (fixture.nativeElement as HTMLElement)
      .querySelector<HTMLButtonElement>('.subnote-remove')!
      .click();

    expect(removed).toHaveBeenCalled();
  });

  it('shows a missing state when the child note is gone', () => {
    const { fixture } = setup(subnoteBlock('n_missing'), childNote());
    const element = fixture.nativeElement as HTMLElement;
    const removed = vi.fn();
    fixture.componentInstance.removed.subscribe(removed);

    expect(element.querySelector('.subnote-missing')?.textContent).toContain(
      'This sub-note no longer exists.',
    );
    expect(element.querySelector('app-note-block')).toBeNull();

    element.querySelector<HTMLButtonElement>('.subnote-missing button')!.click();
    expect(removed).toHaveBeenCalled();
  });

  it('moves the block with arrow keys on the handle', () => {
    const { fixture } = setup();
    const move = vi.fn();
    fixture.componentInstance.move.subscribe(move);
    const handle = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '.handle',
    )!;

    handle.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }),
    );

    expect(move).not.toHaveBeenCalled();

    fixture.componentRef.setInput('index', 1);
    fixture.componentRef.setInput('total', 3);
    fixture.detectChanges();
    handle.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true, cancelable: true }),
    );
    expect(move).toHaveBeenCalledWith(0);
  });

  it('passes nesting depth to the rendered surface', () => {
    const { fixture } = setup();
    fixture.componentRef.setInput('depth', 2);
    fixture.detectChanges();

    expect(
      (fixture.nativeElement as HTMLElement)
        .querySelector('.subnote-block')
        ?.getAttribute('data-depth'),
    ).toBe('2');
  });

  it('forwards block changes and column changes to the child note', () => {
    const child = childNote();
    child.blocks = [
      { ...createBlock('text', { columns: ['start'], columnCount: 1 }), id: 'b_text' },
      { ...createBlock('image', { src: 'data:image/png;base64,old' }), id: 'b_image' },
    ];
    const { fixture, store } = setup(subnoteBlock(), child);
    const text = editorFor(fixture, 'b_text');
    const image = editorFor(fixture, 'b_image');

    text.changed.emit({ text: 'changed' });
    text.columnChanged.emit({ index: 0, value: 'first column' });
    text.columnCountChanged.emit(2);
    image.imageColumnChanged.emit({ index: 0, patch: { type: 'text', text: 'side' } });

    const blocks = store.notes().find((note) => note.id === 'n_child')!.blocks;
    expect(blocks.find((block) => block.id === 'b_text')).toMatchObject({
      text: 'changed',
      columns: ['first column', ''],
      columnCount: 2,
    });
    expect(blocks.find((block) => block.id === 'b_image')!.imageColumns[0]).toMatchObject({
      type: 'text',
      text: 'side',
    });
  });

  it('splits text and headings, applies fences, shortcuts, and type changes', () => {
    const child = childNote();
    child.blocks = [
      { ...createBlock('text', { columns: ['hello world'], columnCount: 1 }), id: 'b_text' },
      { ...createBlock('heading', { text: 'Titlebody', level: 2 }), id: 'b_heading' },
    ];
    const { fixture, store } = setup(subnoteBlock(), child);

    editorFor(fixture, 'b_text').split.emit({
      column: 0,
      before: 'hello',
      after: ' world',
    });
    let blocks = store.notes().find((note) => note.id === 'n_child')!.blocks;
    expect(blocks).toHaveLength(3);
    expect(blocks[1].columns).toEqual([' world']);

    editorFor(fixture, 'b_heading').headingSplit.emit({ before: 'Title', after: 'body' });
    blocks = store.notes().find((note) => note.id === 'n_child')!.blocks;
    expect(blocks).toHaveLength(4);
    expect(blocks.find((block) => block.id === 'b_heading')!.text).toBe('Title');

    editorFor(fixture, 'b_text').fence.emit({ language: 'ts', text: 'const x = 1' });
    blocks = store.notes().find((note) => note.id === 'n_child')!.blocks;
    expect(blocks.find((block) => block.id === 'b_text')).toMatchObject({
      type: 'code',
      language: 'ts',
      text: 'const x = 1',
    });

    editorFor(fixture, 'b_heading').shortcut.emit({
      kind: 'list',
      ordered: true,
      items: ['one', 'two'],
    });
    blocks = store.notes().find((note) => note.id === 'n_child')!.blocks;
    expect(blocks.find((block) => block.id === 'b_heading')!.type).toBe('heading');

    editorFor(fixture, 'b_heading').typeChanged.emit('list');
    blocks = store.notes().find((note) => note.id === 'n_child')!.blocks;
    expect(blocks.find((block) => block.id === 'b_heading')!.type).toBe('list');
  });

  it('removes, moves, and focuses blocks from child outputs', () => {
    const child = childNote();
    child.blocks = [
      { ...createBlock('text', { columns: ['one'], columnCount: 1 }), id: 'b_one' },
      { ...createBlock('text', { columns: ['two'], columnCount: 1 }), id: 'b_two' },
    ];
    const { fixture, store } = setup(subnoteBlock(), child);
    const focused = vi.fn();
    fixture.componentInstance.focused.subscribe(focused);

    editorFor(fixture, 'b_two').move.emit(0);
    let blocks = store.notes().find((note) => note.id === 'n_child')!.blocks;
    expect(blocks.map((block) => block.id)).toEqual(['b_two', 'b_one']);

    editorFor(fixture, 'b_two').focused.emit();
    expect(focused).toHaveBeenCalled();

    editorFor(fixture, 'b_one').removed.emit();
    blocks = store.notes().find((note) => note.id === 'n_child')!.blocks;
    expect(blocks.map((block) => block.id)).toEqual(['b_two']);
  });

  it('reorders blocks on drop but ignores drops onto the same position', () => {
    const child = childNote();
    child.blocks = [
      { ...createBlock('text', { columns: ['one'], columnCount: 1 }), id: 'b_one' },
      { ...createBlock('text', { columns: ['two'], columnCount: 1 }), id: 'b_two' },
    ];
    const { fixture, store } = setup(subnoteBlock(), child);
    const component = fixture.componentInstance as unknown as {
      onDrop(event: { previousIndex: number; currentIndex: number }): void;
    };

    component.onDrop({ previousIndex: 1, currentIndex: 1 });
    expect(
      store
        .notes()
        .find((note) => note.id === 'n_child')!
        .blocks.map((block) => block.id),
    ).toEqual(['b_one', 'b_two']);

    component.onDrop({ previousIndex: 1, currentIndex: 0 });
    expect(
      store
        .notes()
        .find((note) => note.id === 'n_child')!
        .blocks.map((block) => block.id),
    ).toEqual(['b_two', 'b_one']);
  });

  it('renders and removes a nested sub-note block', () => {
    const nested = {
      ...createNote('n_child'),
      id: 'n_grand',
      title: 'Grandchild',
      blocks: [{ ...createBlock('text', { columns: ['deep'] }), id: 'b_deep' }],
    };
    const child = childNote();
    child.blocks = [{ ...createBlock('subnote', { noteId: 'n_grand' }), id: 'b_nested' }];
    const { fixture, store } = setup(subnoteBlock(), child, false, [nested]);

    const nestedBlock = fixture.debugElement.query(By.directive(SubnoteBlock))
      .componentInstance as SubnoteBlock;
    nestedBlock.removed.emit();

    expect(store.notes().find((note) => note.id === 'n_child')!.blocks).toEqual([]);
  });

  it('closes the add menu from the backdrop and Escape, restoring focus', () => {
    vi.useFakeTimers();
    const { fixture } = setup();
    const element = fixture.nativeElement as HTMLElement;
    const add = element.querySelector<HTMLButtonElement>('.subnote-add-block')!;

    add.click();
    fixture.detectChanges();
    element.querySelector<HTMLElement>('.menu-backdrop')!.click();
    fixture.detectChanges();
    expect(element.querySelector('.subnote-menu')).toBeNull();

    add.click();
    fixture.detectChanges();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    vi.runAllTimers();
    fixture.detectChanges();

    expect(element.querySelector('.subnote-menu')).toBeNull();
    expect(document.activeElement).toBe(add);
  });

  it('focuses the title on init and reports it to the editor', () => {
    vi.useFakeTimers();
    const { fixture } = setup(subnoteBlock(), childNote(), true);
    const focused = vi.fn();
    fixture.componentInstance.focused.subscribe(focused);

    vi.runAllTimers();
    fixture.detectChanges();

    expect(document.activeElement).toBe(
      (fixture.nativeElement as HTMLElement).querySelector('.subnote-title'),
    );
    expect(focused).toHaveBeenCalled();
  });

  it('stays inert when the child note is missing', () => {
    const { fixture } = setup(subnoteBlock('n_missing'), childNote());
    const component = fixture.componentInstance as unknown as Record<
      string,
      (...args: unknown[]) => unknown
    >;
    const block = subnoteBlock('n_missing');

    expect(() => {
      component['onTitleInput'](new Event('input'));
      component['openNote']();
      component['addBlock']('text');
      component['onBlockChange'](block.id, { text: 'x' });
      component['onBlockTypeChange'](block.id, 'subnote');
      component['onColumnChange'](block.id, { index: 0, value: 'x' });
      component['onColumnCountChange'](block.id, 2);
      component['onImageColumnChange'](block.id, { index: 0, patch: {} });
      component['onSplitBlock'](block.id, { column: 0, before: 'a', after: 'b' });
      component['onHeadingSplit'](block.id, { before: 'a', after: 'b' });
      component['onFence'](block.id, { language: 'ts', text: '' });
      component['onMarkdownShortcut'](block.id, { kind: 'heading', level: 1, text: 'x' });
      component['removeBlock'](block.id);
      component['moveBlock'](0, 1);
    }).not.toThrow();
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
