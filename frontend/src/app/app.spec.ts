import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './app';
import { Note, createBlock, createNote } from './models';
import { NoteStore } from './note-store';
import { SyncService, SyncStatus } from './sync';

const NOTES_KEY = 'the-noter.notes.v1';
const NOTES_VISIBLE_KEY = 'the-noter.ui.notes-visible';
const OUTLINE_VISIBLE_KEY = 'the-noter.ui.outline-visible';

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

function setup(seed: Note[] = []) {
  if (seed.length > 0) localStorage.setItem(NOTES_KEY, JSON.stringify(seed));
  const sync = fakeSync();
  TestBed.configureTestingModule({
    providers: [{ provide: SyncService, useValue: sync }],
  });
  const store = TestBed.inject(NoteStore);
  const fixture = TestBed.createComponent(App);
  fixture.detectChanges();
  TestBed.tick();
  return { fixture, store, sync };
}

function escape(): void {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

describe('App', () => {
  beforeEach(() => TestBed.resetTestingModule());

  afterEach(() => {
    document.title = '';
    vi.useRealTimers();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('shows the empty state and creates the first note', () => {
    const { fixture, store } = setup();
    const element = fixture.nativeElement as HTMLElement;

    expect(element.querySelector('.empty')).not.toBeNull();
    expect(element.querySelector('app-note-editor')).toBeNull();

    element.querySelector<HTMLButtonElement>('.empty .primary')!.click();
    fixture.detectChanges();

    expect(store.total()).toBe(1);
    expect(element.querySelector('app-note-editor')).not.toBeNull();
  });

  it('keeps the document title in sync with the selected note', () => {
    const { fixture, store } = setup();

    expect(document.title).toBe('The Noter');

    const created = store.createNote();
    fixture.detectChanges();
    TestBed.tick();
    expect(document.title).toBe('The Noter');

    store.setTitle(created.id, 'Ideas');
    fixture.detectChanges();
    TestBed.tick();
    expect(document.title).toBe('Ideas · The Noter');

    store.setTitle(created.id, '   ');
    fixture.detectChanges();
    TestBed.tick();
    expect(document.title).toBe('The Noter');
  });

  it('opens and closes the mobile notes sidebar', () => {
    const { fixture } = setup();
    const element = fixture.nativeElement as HTMLElement;
    const open = element.querySelector<HTMLButtonElement>('[aria-label="Open notes"]')!;

    open.click();
    fixture.detectChanges();
    expect(element.querySelector('.scrim')).not.toBeNull();
    expect(element.querySelector('app-notes-sidebar')?.classList.contains('open')).toBe(true);

    element.querySelector<HTMLButtonElement>('.scrim')!.click();
    fixture.detectChanges();
    expect(element.querySelector('.scrim')).toBeNull();

    open.click();
    fixture.detectChanges();
    escape();
    fixture.detectChanges();
    expect(element.querySelector('.scrim')).toBeNull();
  });

  it('collapses and restores the notes sidebar preference', () => {
    const { fixture } = setup([note('n_note')]);
    const element = fixture.nativeElement as HTMLElement;

    element.querySelector<HTMLButtonElement>('.brand-collapse')!.click();
    fixture.detectChanges();

    expect(element.querySelector('.shell')?.classList.contains('notes-hidden')).toBe(true);
    expect(localStorage.getItem(NOTES_VISIBLE_KEY)).toBe('false');

    element.querySelector<HTMLButtonElement>('.rail-expand')!.click();
    fixture.detectChanges();

    expect(element.querySelector('.shell')?.classList.contains('notes-hidden')).toBe(false);
    expect(localStorage.getItem(NOTES_VISIBLE_KEY)).toBe('true');
  });

  it('reads stored layout preferences', () => {
    localStorage.setItem(NOTES_VISIBLE_KEY, 'false');
    localStorage.setItem(OUTLINE_VISIBLE_KEY, 'false');
    const { fixture, store } = setup([note('n_note')]);
    const element = fixture.nativeElement as HTMLElement;
    store.select('n_note');
    fixture.detectChanges();

    expect(element.querySelector('.shell')?.classList.contains('notes-hidden')).toBe(true);
    expect(element.querySelector('app-note-outline')).toBeNull();
    expect(element.querySelector('.outline-rail')).not.toBeNull();
  });

  it('opens the outline as an overlay on narrow layouts and closes it', () => {
    const seeded = note('n_note', {
      blocks: [createBlock('heading', { text: 'A heading', level: 2 })],
    });
    const { fixture, store } = setup([seeded]);
    const element = fixture.nativeElement as HTMLElement;
    store.select('n_note');
    fixture.detectChanges();

    expect(element.querySelector('app-note-outline')).not.toBeNull();
    element.querySelector<HTMLButtonElement>('.outline-collapse')!.click();
    fixture.detectChanges();
    expect(element.querySelector('app-note-outline')).toBeNull();

    element.querySelector<HTMLButtonElement>('.outline-rail')!.click();
    fixture.detectChanges();
    expect(element.querySelector('.outline-scrim')).not.toBeNull();
    expect(element.querySelector('app-note-outline')?.classList.contains('outline-overlay')).toBe(
      true,
    );

    element.querySelector<HTMLButtonElement>('.outline-link')!.click();
    fixture.detectChanges();
    expect(element.querySelector('app-note-outline')).toBeNull();
    expect(element.querySelector('.outline-scrim')).toBeNull();
  });

  it('toggles the keyboard shortcut cheat sheet and closes it with Escape', () => {
    const { fixture } = setup();
    const element = fixture.nativeElement as HTMLElement;

    element.querySelector<HTMLButtonElement>('.cheat-sheet-button')!.click();
    fixture.detectChanges();
    expect(element.querySelector('.cheat-sheet-panel')).not.toBeNull();

    element.querySelector<HTMLButtonElement>('.cheat-sheet-close')!.click();
    fixture.detectChanges();
    expect(element.querySelector('.cheat-sheet-panel')).toBeNull();

    element.querySelector<HTMLButtonElement>('.cheat-sheet-button')!.click();
    fixture.detectChanges();
    escape();
    fixture.detectChanges();
    expect(element.querySelector('.cheat-sheet-panel')).toBeNull();
  });

  it('reacts to wide-layout media query changes and closes the outline overlay', () => {
    const listeners: Array<(event: MediaQueryListEvent) => void> = [];
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query) =>
        ({
          matches: false,
          media: query,
          onchange: null,
          addEventListener: (_type: string, handler: EventListener) => {
            listeners.push(handler as unknown as (event: MediaQueryListEvent) => void);
          },
          removeEventListener: vi.fn(),
          addListener: vi.fn(),
          removeListener: vi.fn(),
          dispatchEvent: vi.fn(),
        }) as unknown as MediaQueryList,
    );
    const seeded = note('n_note', {
      blocks: [createBlock('heading', { text: 'A heading', level: 2 })],
    });
    const { fixture, store } = setup([seeded]);
    const element = fixture.nativeElement as HTMLElement;
    store.select('n_note');
    fixture.detectChanges();

    element.querySelector<HTMLButtonElement>('.outline-rail')!.click();
    fixture.detectChanges();
    expect(element.querySelector('.outline-scrim')).not.toBeNull();

    listeners[0]({ matches: true } as MediaQueryListEvent);
    fixture.detectChanges();
    expect(element.querySelector('.outline-scrim')).toBeNull();

    listeners[0]({ matches: false } as MediaQueryListEvent);
    fixture.detectChanges();
    expect(element.querySelector('.outline-rail')).not.toBeNull();
  });

  it('closes an open outline overlay with Escape', () => {
    const seeded = note('n_note', {
      blocks: [createBlock('heading', { text: 'A heading', level: 2 })],
    });
    const { fixture, store } = setup([seeded]);
    const element = fixture.nativeElement as HTMLElement;
    store.select('n_note');
    fixture.detectChanges();

    element.querySelector<HTMLButtonElement>('.outline-rail')!.click();
    fixture.detectChanges();
    expect(element.querySelector('.outline-scrim')).not.toBeNull();

    escape();
    fixture.detectChanges();

    expect(element.querySelector('.outline-scrim')).toBeNull();
  });

  it('closes the sidebar on Escape when nothing is open', () => {
    const { fixture } = setup();

    escape();
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('.scrim')).toBeNull();
  });

  it('falls back when layout preferences cannot be read', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });

    const { fixture } = setup();

    expect((fixture.nativeElement as HTMLElement).querySelector('.empty')).not.toBeNull();
  });
});
