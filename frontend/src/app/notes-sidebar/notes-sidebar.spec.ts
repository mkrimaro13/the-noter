import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Note, createBlock, createNote } from '../models';
import { NoteStore } from '../note-store';
import { NoteConflict, SyncDiagnostics, SyncService, SyncStatus } from '../sync';
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
    lastSyncedAt: signal<number | null>(null),
    conflicts: signal<NoteConflict[]>([]),
    pendingCount: signal(0),
    diagnostics: signal<SyncDiagnostics | null>(null),
    start: vi.fn(),
    markDirty: vi.fn(),
    markDeleted: vi.fn(),
    notifyPersisted: vi.fn(),
    syncNow: vi.fn(async () => {}),
    refreshDiagnostics: vi.fn(async () => {}),
    resolveConflict: vi.fn(async () => {}),
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

function rowFor(element: HTMLElement, title: string): HTMLElement {
  return Array.from(element.querySelectorAll<HTMLElement>('.note-row')).find(
    (row) => row.querySelector('.note-title')?.textContent?.trim() === title,
  )!;
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

  it('highlights query matches inside the note titles', () => {
    const { fixture, store } = setup([
      note('n_a', { title: 'Grocery list' }),
      note('n_b', { title: 'Project plan' }),
    ]);
    const element = fixture.nativeElement as HTMLElement;

    store.query.set('groc');
    fixture.detectChanges();

    const marks = Array.from(element.querySelectorAll('.note-title mark.hit')).map(
      (mark) => mark.textContent,
    );
    expect(marks).toEqual(['Groc']);
    expect(titles(element)).toEqual(['Grocery list']);
  });

  it('filters with the chips and clears them without touching the query', () => {
    const pinned = note('n_pin', { title: 'Pinned note', favorite: true, updatedAt: 200 });
    const plain = note('n_plain', { title: 'Plain note', updatedAt: 100 });
    const { fixture, store } = setup([pinned, plain]);
    const element = fixture.nativeElement as HTMLElement;
    store.query.set('note');
    fixture.detectChanges();

    element.querySelectorAll<HTMLButtonElement>('.filter-chip')[0]!.click();
    fixture.detectChanges();

    expect(store.filterActive()).toBe(true);
    expect(titles(element)).toEqual(['Pinned note']);
    expect(element.querySelector('.count')?.textContent?.trim()).toBe('1');

    element.querySelector<HTMLButtonElement>('.filter-clear')!.click();
    fixture.detectChanges();

    expect(store.filterActive()).toBe(false);
    expect(store.query()).toBe('note');
    expect(titles(element)).toEqual(['Pinned note', 'Plain note']);
  });

  it('flattens the tree while a filter is active', () => {
    const parent = note('n_parent', { title: 'Parent', favorite: true });
    const child = note('n_child', { title: 'Child', parentId: 'n_parent' });
    const { fixture, store } = setup([parent, child]);
    const element = fixture.nativeElement as HTMLElement;

    store.patchFilter({ favorites: true });
    fixture.detectChanges();

    expect(titles(element)).toEqual(['Parent']);
    expect(element.querySelector('.note-row.nested')).toBeNull();

    store.clearFilters();
    fixture.detectChanges();

    expect(titles(element)).toEqual(['Parent', 'Child']);
    expect(element.querySelector('.note-row.nested')).not.toBeNull();
  });

  it('explains when filters alone leave nothing', () => {
    const { fixture, store } = setup([note('n_a', { title: 'Alpha' })]);
    const element = fixture.nativeElement as HTMLElement;

    store.patchFilter({ code: true });
    fixture.detectChanges();

    expect(element.querySelector('.empty-list')?.textContent).toContain(
      'No notes match the current filters.',
    );
  });

  it('filters by edit window and metadata from the selects', () => {
    const fresh = note('n_fresh', { title: 'Fresh note', updatedAt: Date.now() });
    const stale = note('n_stale', {
      title: 'Stale note',
      updatedAt: Date.now() - 40 * 24 * 60 * 60 * 1000,
      metadata: [{ id: 'm_1', key: 'Status', value: 'active', type: 'text', options: [] }],
    });
    const { fixture, store } = setup([fresh, stale]);
    const element = fixture.nativeElement as HTMLElement;

    const edited = element.querySelectorAll<HTMLSelectElement>('.filter-select')[0]!;
    edited.value = 'month';
    edited.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(titles(element)).toEqual(['Fresh note']);

    const key = element.querySelectorAll<HTMLSelectElement>('.filter-select')[1]!;
    key.value = 'Status';
    key.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(titles(element)).toEqual([]);
    expect(store.filter().metadataKey).toBe('Status');

    const value = element.querySelectorAll<HTMLSelectElement>('.filter-select')[2]!;
    value.value = 'active';
    value.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(titles(element)).toEqual([]);

    edited.value = 'any';
    edited.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(titles(element)).toEqual(['Stale note']);
  });

  it('pins a note from the row actions and shows the favorites section', () => {
    const { fixture, store } = setup([note('n_a', { title: 'Alpha' })]);
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.favorites')).toBeNull();

    rowFor(element, 'Alpha').querySelector<HTMLButtonElement>('.note-favorite')!.click();
    fixture.detectChanges();

    expect(store.notes()[0].favorite).toBe(true);
    expect(rowFor(element, 'Alpha').querySelector('.note-favorite')!.className).toContain('active');
    expect(element.querySelector('.favorites')).not.toBeNull();
  });

  it('lists favorites in their own section and un-pins from there', () => {
    const pinned = note('n_pin', { title: 'Pinned note', favorite: true });
    const { fixture, store } = setup([pinned, note('n_other', { title: 'Other note' })]);
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.favorites-count')?.textContent?.trim()).toBe('1');
    expect(element.querySelector('.favorite-title')?.textContent?.trim()).toBe('Pinned note');

    const row = element.querySelector<HTMLElement>('.favorite-row')!;
    row.querySelector<HTMLButtonElement>('.favorite-main')!.click();
    expect(store.selectedId()).toBe('n_pin');

    row.querySelector<HTMLButtonElement>('.favorite-star')!.click();
    fixture.detectChanges();

    expect(store.notes().find((item) => item.id === 'n_pin')?.favorite).toBe(false);
    expect(element.querySelector('.favorites')).toBeNull();
  });

  it('hides the favorites section while searching or filtering', () => {
    const pinned = note('n_pin', { title: 'Pinned note', favorite: true });
    const { fixture, store } = setup([pinned, note('n_other', { title: 'Other note' })]);
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('.favorites')).not.toBeNull();

    store.query.set('pinned');
    fixture.detectChanges();
    expect(element.querySelector('.favorites')).toBeNull();

    store.query.set('');
    store.patchFilter({ images: true });
    fixture.detectChanges();
    expect(element.querySelector('.favorites')).toBeNull();

    store.clearFilters();
    fixture.detectChanges();
    expect(element.querySelector('.favorites')).not.toBeNull();
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

  it('moves a note to another parent from the move menu', () => {
    const { fixture, store } = setup([
      note('n_target', { title: 'Target' }),
      note('n_move', { title: 'Move me' }),
    ]);
    const element = fixture.nativeElement as HTMLElement;
    const row = Array.from(element.querySelectorAll<HTMLElement>('.note-row')).find((item) =>
      item.querySelector('.note-title')?.textContent?.includes('Move me'),
    )!;

    row.querySelector<HTMLButtonElement>('.note-move')!.click();
    fixture.detectChanges();

    const targets = Array.from(element.querySelectorAll<HTMLElement>('.move-target span')).map(
      (node) => node.textContent?.trim(),
    );
    expect(targets).toEqual(['Root', 'Target']);

    const target = Array.from(element.querySelectorAll<HTMLButtonElement>('.move-target')).find(
      (button) => button.textContent?.includes('Target'),
    )!;
    target.click();
    fixture.detectChanges();

    expect(store.notes().find((item) => item.id === 'n_move')?.parentId).toBe('n_target');
    expect(element.querySelector('.move-menu')).toBeNull();
    expect(titles(element)).toEqual(['Target', 'Move me']);
  });

  it('never offers descendants as move targets', () => {
    const { fixture } = setup([
      note('n_parent', { title: 'Parent' }),
      note('n_child', { title: 'Child', parentId: 'n_parent' }),
      note('n_grand', { title: 'Grand', parentId: 'n_child' }),
      note('n_other', { title: 'Other' }),
    ]);
    const element = fixture.nativeElement as HTMLElement;
    const row = Array.from(element.querySelectorAll<HTMLElement>('.note-row')).find((item) =>
      item.querySelector('.note-title')?.textContent?.includes('Parent'),
    )!;

    row.querySelector<HTMLButtonElement>('.note-move')!.click();
    fixture.detectChanges();

    const targets = Array.from(element.querySelectorAll<HTMLElement>('.move-target span')).map(
      (node) => node.textContent?.trim(),
    );
    expect(targets).toEqual(['Root', 'Other']);
  });

  it('remembers collapsed branches after remounting', () => {
    const { fixture } = setup([
      note('n_parent', { title: 'Parent' }),
      note('n_child', { title: 'Child', parentId: 'n_parent' }),
    ]);
    const element = fixture.nativeElement as HTMLElement;

    element.querySelector<HTMLButtonElement>('.note-toggle')!.click();
    fixture.detectChanges();
    expect(titles(element)).toEqual(['Parent']);

    const second = TestBed.createComponent(NotesSidebar);
    second.componentRef.setInput('collapsed', false);
    second.detectChanges();

    expect(titles(second.nativeElement as HTMLElement)).toEqual(['Parent']);
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

  it('moves a note to the trash and restores it from the sidebar', () => {
    const { fixture, store } = setup([note('n_a'), note('n_b')]);
    const element = fixture.nativeElement as HTMLElement;

    const row = rowFor(element, 'n_a');
    row.querySelector<HTMLButtonElement>('.note-delete')!.click();
    fixture.detectChanges();
    expect(row.querySelector('.delete-confirm')?.textContent).toContain('Move to trash?');

    row.querySelector<HTMLButtonElement>('.confirm-action.danger')!.click();
    fixture.detectChanges();

    expect(store.total()).toBe(1);
    expect(store.trashedNotes().map((item) => item.id)).toEqual(['n_a']);
    expect(element.querySelector('.trash-count')?.textContent?.trim()).toBe('1');

    element.querySelector<HTMLButtonElement>('.trash-toggle')!.click();
    fixture.detectChanges();
    expect(element.querySelector('.trash-title')?.textContent?.trim()).toBe('n_a');

    element.querySelector<HTMLButtonElement>('.trash-action')!.click();
    fixture.detectChanges();

    expect(store.trashedNotes()).toHaveLength(0);
    expect(store.total()).toBe(2);
    expect(titles(element)).toContain('n_a');
  });

  it('permanently deletes one note from the trash', () => {
    const { fixture, store } = setup([note('n_a'), note('n_b')]);
    const element = fixture.nativeElement as HTMLElement;

    store.deleteNote('n_a');
    fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('.trash-toggle')!.click();
    fixture.detectChanges();

    // The first action restores, the second one asks to delete permanently.
    const actions = element.querySelectorAll<HTMLButtonElement>('.trash-row .trash-action');
    actions[1].click();
    fixture.detectChanges();
    expect(element.querySelector('.trash-row.confirming')).not.toBeNull();

    element.querySelector<HTMLButtonElement>('.trash-row .trash-action.danger')!.click();
    fixture.detectChanges();

    expect(store.trashedNotes()).toHaveLength(0);
    expect(store.total()).toBe(1);
  });

  it('empties the whole trash after confirming', () => {
    const { fixture, store } = setup([note('n_a'), note('n_b')]);
    const element = fixture.nativeElement as HTMLElement;

    store.deleteNote('n_a');
    store.deleteNote('n_b');
    fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('.trash-toggle')!.click();
    fixture.detectChanges();

    element.querySelector<HTMLButtonElement>('.trash-empty-button')!.click();
    fixture.detectChanges();
    expect(element.querySelector('.trash-empty-confirm')?.textContent).toContain(
      'Delete everything permanently?',
    );

    element.querySelector<HTMLButtonElement>('.trash-empty-confirm .danger')!.click();
    fixture.detectChanges();

    expect(store.trashedNotes()).toHaveLength(0);
    expect(store.total()).toBe(0);
  });

  it('lists pending conflicts and applies the chosen decision', () => {
    const local = note('n_1', {
      title: 'Local copy',
      blocks: [createBlock('text', { columns: ['Local body'] })],
    });
    const { fixture, sync } = setup([local]);
    const element = fixture.nativeElement as HTMLElement;

    sync.conflicts.set([
      {
        id: 'n_1',
        theirsRev: '2-server',
        theirs: {
          id: 'n_1',
          title: 'Server copy',
          updatedAt: 50,
          blocks: [createBlock('text', { columns: ['Server body'] })],
          metadata: [],
        },
        origin: 'push',
        deletedLocally: false,
        at: 1,
      },
    ]);
    fixture.detectChanges();

    expect(element.querySelector('.conflicts-toggle')?.textContent).toContain('Sync conflicts');
    expect(element.querySelector('.conflicts-count')?.textContent?.trim()).toBe('1');

    element.querySelector<HTMLButtonElement>('.conflicts-toggle')!.click();
    fixture.detectChanges();

    expect(element.querySelector('.conflict-card-title')?.textContent).toContain('Local copy');
    const labels = Array.from(element.querySelectorAll('.conflict-side-label')).map(
      (node) => node.textContent?.trim() ?? '',
    );
    expect(labels).toEqual(['This device', 'Server']);
    const previews = Array.from(element.querySelectorAll('.conflict-side-preview')).map(
      (node) => node.textContent?.trim() ?? '',
    );
    expect(previews).toEqual(['Local body', 'Server body']);

    const actions = Array.from(element.querySelectorAll<HTMLButtonElement>('.conflict-action'));
    actions[1].click();
    expect(sync.resolveConflict).toHaveBeenCalledWith('n_1', 'theirs');

    // The section leaves once the decision has been applied.
    sync.conflicts.set([]);
    fixture.detectChanges();
    expect(element.querySelector('.conflicts')).toBeNull();
  });

  it('marks conflicts about notes deleted on this device', () => {
    const { fixture, store, sync } = setup([note('n_1', { title: 'Trashed copy' })]);
    const element = fixture.nativeElement as HTMLElement;

    store.deleteNote('n_1');
    sync.conflicts.set([
      {
        id: 'n_1',
        theirsRev: '2-server',
        theirs: {
          id: 'n_1',
          title: 'Server copy',
          updatedAt: 50,
          blocks: [],
          metadata: [],
        },
        origin: 'push',
        deletedLocally: true,
        at: 1,
      },
      {
        id: 'n_missing',
        theirsRev: '2-server',
        theirs: null,
        origin: 'push',
        deletedLocally: false,
        at: 1,
      },
    ]);
    fixture.detectChanges();
    element.querySelector<HTMLButtonElement>('.conflicts-toggle')!.click();
    fixture.detectChanges();

    const tags = Array.from(element.querySelectorAll('.conflict-tag')).map(
      (node) => node.textContent?.trim() ?? '',
    );
    expect(tags).toEqual(['in trash', 'deleted here']);

    const cards = element.querySelectorAll('.conflict-card');
    // A note that is gone entirely shows the deleted placeholder.
    const missing = Array.from(cards[cards.length - 1].querySelectorAll('.conflict-side'));
    expect(missing[0].textContent).toContain('This version no longer exists.');

    const actions = Array.from(cards[0].querySelectorAll<HTMLButtonElement>('.conflict-action'));
    actions[2].click();
    expect(sync.resolveConflict).toHaveBeenCalledWith('n_1', 'both');
  });

  it('runs a manual sync from the footer', () => {
    const { fixture, sync } = setup([]);
    const element = fixture.nativeElement as HTMLElement;

    const button = element.querySelector<HTMLButtonElement>('.sync-now')!;
    expect(button.disabled).toBe(false);
    button.click();
    expect(sync.syncNow).toHaveBeenCalledTimes(1);

    sync.status.set('syncing');
    fixture.detectChanges();
    expect(element.querySelector<HTMLButtonElement>('.sync-now')!.disabled).toBe(true);
  });

  it('shows server diagnostics in the popover and closes it with Escape', () => {
    const { fixture, sync } = setup([]);
    const element = fixture.nativeElement as HTMLElement;

    sync.lastSyncedAt.set(Date.now() - 60_000);
    sync.pendingCount.set(2);
    sync.diagnostics.set({
      at: 1,
      docCount: 12,
      deletedCount: 3,
      purgeSeq: '4-p',
      compactRunning: false,
      maintenance: {
        firstRun: 1,
        lastCompaction: 2,
        lastPurge: 3,
        purged: 5,
        intervalSeconds: 3600,
      },
    });
    fixture.detectChanges();

    element.querySelector<HTMLButtonElement>('.save-state')!.click();
    fixture.detectChanges();

    expect(sync.refreshDiagnostics).toHaveBeenCalledTimes(1);
    expect(element.querySelector('.sync-popover')?.textContent).toContain('Server documents');
    const rows = Array.from(element.querySelectorAll('.sync-popover-row')).map(
      (node) => node.textContent?.replace(/\s+/g, ' ').trim() ?? '',
    );
    expect(rows.some((row) => row.includes('Server documents') && row.includes('12'))).toBe(true);
    expect(rows.some((row) => row.includes('Deleted on server') && row.includes('3'))).toBe(true);
    expect(rows.some((row) => row.includes('Compaction') && row.includes('Idle'))).toBe(true);
    expect(rows.some((row) => row.includes('Tombstones purged') && row.includes('5'))).toBe(true);
    expect(rows.some((row) => row.includes('Waiting') && row.includes('2'))).toBe(true);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    fixture.detectChanges();
    expect(element.querySelector('.sync-popover')).toBeNull();
  });
});
