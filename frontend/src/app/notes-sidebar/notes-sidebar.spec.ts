import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Note, createBlock, createNote } from '../models';
import { NoteStore } from '../note-store';
import { SyncService, SyncStatus } from '../sync';
import { NotesSidebar } from './notes-sidebar';

const NOTES_KEY = 'the-noter.notes.v1';

function note(id: string, patch: Partial<Note> = {}): Note {
  return {
    ...createNote(),
    id,
    title: id,
    updatedAt: Date.now(),
    ...patch,
  };
}

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

function setup(seed: Note[], collapsed = false) {
  localStorage.setItem(NOTES_KEY, JSON.stringify(seed));
  const sync = fakeSync();
  TestBed.configureTestingModule({
    providers: [{ provide: SyncService, useValue: sync }],
  });
  const store = TestBed.inject(NoteStore);
  const fixture = TestBed.createComponent(NotesSidebar);
  fixture.componentRef.setInput('collapsed', collapsed);
  fixture.detectChanges();
  return { fixture, store, sync };
}

function titles(element: HTMLElement): string[] {
  return Array.from(element.querySelectorAll('.note-title')).map(
    (node) => node.textContent?.trim() ?? '',
  );
}

describe('NotesSidebar', () => {
  beforeEach(() => TestBed.resetTestingModule());

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('lists notes as a nested tree with titles and counts', () => {
    const parent = note('n_parent', {
      title: 'Parent',
      blocks: [createBlock('text')],
    });
    const child = note('n_child', {
      title: '',
      parentId: 'n_parent',
      blocks: [],
    });
    const { fixture } = setup([parent, child]);
    const element = fixture.nativeElement as HTMLElement;

    expect(titles(element)).toEqual(['Parent', 'Untitled']);
    expect(element.querySelector('.count')?.textContent?.trim()).toBe('2');
    expect(element.querySelector('.footer-count')?.textContent?.trim()).toBe('2 notes');
    const rows = element.querySelectorAll('.note-row');
    expect(rows[1].classList.contains('nested')).toBe(true);
    expect(rows[1].getAttribute('style')).toContain('--depth: 1');
    expect(element.querySelectorAll('.note-sub')[0].textContent).toContain('1 block');
    expect(element.querySelectorAll('.note-sub')[1].textContent).toContain('Empty');
  });

  it('filters the list while searching and clears the query', () => {
    const { fixture, store } = setup([
      note('n_a', { title: 'Grocery list' }),
      note('n_b', { title: 'Project plan' }),
    ]);
    const element = fixture.nativeElement as HTMLElement;

    store.query.set('grocery');
    fixture.detectChanges();
    expect(titles(element)).toEqual(['Grocery list']);

    store.query.set('nothing');
    fixture.detectChanges();
    expect(element.querySelector('.empty-list')?.textContent).toContain(
      'No notes match “nothing”.',
    );

    element.querySelector<HTMLButtonElement>('.search-clear')!.click();
    fixture.detectChanges();
    expect(store.query()).toBe('');
    expect(titles(element)).toHaveLength(2);
    expect(document.activeElement).toBe(element.querySelector('.search input'));
  });

  it('selects a note and emits navigated', () => {
    const { fixture, store } = setup([note('n_a', { title: 'Alpha' })]);
    const element = fixture.nativeElement as HTMLElement;
    const navigated = vi.fn();
    fixture.componentInstance.navigated.subscribe(navigated);

    element.querySelector<HTMLButtonElement>('.note-main')!.click();

    expect(store.selectedId()).toBe('n_a');
    expect(navigated).toHaveBeenCalled();
  });

  it('creates a root note and a child note', () => {
    const { fixture, store } = setup([note('n_parent', { title: 'Parent' })]);
    const element = fixture.nativeElement as HTMLElement;
    const navigated = vi.fn();
    fixture.componentInstance.navigated.subscribe(navigated);

    element.querySelector<HTMLButtonElement>('.new-note')!.click();
    expect(store.total()).toBe(2);
    expect(navigated).toHaveBeenCalledTimes(1);

    const parentRow = Array.from(element.querySelectorAll('.note-row')).find((row) =>
      row.querySelector('.note-title')?.textContent?.includes('Parent'),
    )!;
    parentRow.querySelector<HTMLButtonElement>('.note-nest')!.click();
    const child = store.notes().find((item) => item.parentId === 'n_parent');
    expect(child).toBeDefined();
    expect(navigated).toHaveBeenCalledTimes(2);
  });

  it('collapses and expands sub-notes', () => {
    const parent = note('n_parent', { title: 'Parent' });
    const child = note('n_child', { title: 'Child', parentId: 'n_parent' });
    const { fixture } = setup([parent, child]);
    const element = fixture.nativeElement as HTMLElement;

    expect(titles(element)).toEqual(['Parent', 'Child']);

    const toggle = element.querySelector<HTMLButtonElement>('.note-toggle')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    toggle.click();
    fixture.detectChanges();

    expect(titles(element)).toEqual(['Parent']);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');

    toggle.click();
    fixture.detectChanges();
    expect(titles(element)).toEqual(['Parent', 'Child']);
  });

  it('asks before deleting and can cancel', () => {
    const { fixture, store } = setup([note('n_a', { title: 'Alpha' })]);
    const element = fixture.nativeElement as HTMLElement;

    element.querySelector<HTMLButtonElement>('.note-delete')!.click();
    fixture.detectChanges();
    expect(element.querySelector('.delete-confirm')).not.toBeNull();

    element
      .querySelector<HTMLButtonElement>('.delete-confirm .confirm-action:not(.danger)')!
      .click();
    fixture.detectChanges();

    expect(element.querySelector('.delete-confirm')).toBeNull();
    expect(store.total()).toBe(1);
  });

  it('deletes a selected note and emits navigated', () => {
    const { fixture, store } = setup([note('n_a', { title: 'Alpha' })]);
    const element = fixture.nativeElement as HTMLElement;
    const navigated = vi.fn();
    fixture.componentInstance.navigated.subscribe(navigated);

    element.querySelector<HTMLButtonElement>('.note-main')!.click();
    navigated.mockClear();
    element.querySelector<HTMLButtonElement>('.note-delete')!.click();
    fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('.delete-confirm .danger')!.click();

    expect(store.total()).toBe(0);
    expect(navigated).toHaveBeenCalled();
  });

  it('reflects sync and storage state in the footer', () => {
    const { fixture, store, sync } = setup([]);
    const element = fixture.nativeElement as HTMLElement;
    const label = () => element.querySelector('.save-state')!.textContent?.trim() ?? '';

    expect(label()).toContain('Saved locally');

    for (const [status, expected] of [
      ['syncing', 'Saved locally · Syncing…'],
      ['synced', 'Saved locally · Synced'],
      ['offline', 'Saved locally · Offline'],
      ['error', 'Saved locally · Sync error'],
    ] as const) {
      sync.status.set(status);
      fixture.detectChanges();
      expect(label()).toContain(expected);
    }

    sync.message.set('Server unavailable');
    fixture.detectChanges();
    expect(element.querySelector('.save-state')?.getAttribute('title')).toBe('Server unavailable');

    store.storageError.set('Storage is full.');
    fixture.detectChanges();
    expect(label()).toContain('Not saved');
    expect(element.querySelector('.save-state')?.classList.contains('error')).toBe(true);
    expect(element.querySelector('.save-state')?.getAttribute('title')).toBe('Storage is full.');
  });

  it('collapses to a rail and emits expand or collapse', () => {
    const { fixture } = setup([], true);
    const element = fixture.nativeElement as HTMLElement;
    const expand = vi.fn();
    const collapse = vi.fn();
    fixture.componentInstance.expand.subscribe(expand);
    fixture.componentInstance.collapse.subscribe(collapse);

    expect(element.querySelector('.sidebar')?.classList.contains('collapsed')).toBe(true);

    element.querySelector<HTMLButtonElement>('.rail-expand')!.click();
    expect(expand).toHaveBeenCalled();

    element.querySelector<HTMLButtonElement>('.brand-collapse')!.click();
    expect(collapse).toHaveBeenCalled();
  });

  it('shows the empty list message', () => {
    const { fixture } = setup([]);
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.empty-list')?.textContent).toContain(
      'Your notes will live here.',
    );
    expect(element.querySelector('.footer-count')?.textContent?.trim()).toBe('0 notes');
  });
});
