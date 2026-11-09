import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Note, isImageIcon } from '../models';
import { NoteStore } from '../note-store';
import { Icon } from '../ui/icon';

export type PaletteCommand = 'new-note' | 'toggle-notes' | 'toggle-outline';

interface PaletteAction {
  id: PaletteCommand;
  label: string;
  hint: string;
}

const ACTIONS: PaletteAction[] = [
  { id: 'new-note', label: 'New note', hint: 'Create a blank note' },
  { id: 'toggle-notes', label: 'Toggle notes sidebar', hint: 'Show or hide the note list' },
  { id: 'toggle-outline', label: 'Toggle outline', hint: 'Show or hide the heading outline' },
];

const MAX_NOTES = 8;

/**
 * A keyboard-first palette for jumping to notes and running a few global
 * actions. It owns its query and selection so the sidebar search stays intact.
 */
@Component({
  selector: 'app-command-palette',
  imports: [Icon],
  templateUrl: './command-palette.html',
  styleUrl: './command-palette.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'close()',
  },
})
export class CommandPalette {
  readonly open = input(false);
  readonly closed = output<void>();
  readonly command = output<PaletteCommand>();
  readonly noteSelected = output<string>();

  protected readonly store = inject(NoteStore);
  protected readonly isImageIcon = isImageIcon;
  protected readonly query = signal('');
  protected readonly selected = signal(0);
  protected readonly actions = computed(() => {
    const query = this.query().trim().toLowerCase();
    if (!query) return ACTIONS;
    return ACTIONS.filter((action) => action.label.toLowerCase().includes(query));
  });
  protected readonly notes = computed(() =>
    this.store.search(this.query()).slice(0, MAX_NOTES),
  );

  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');

  constructor() {
    effect(() => {
      if (!this.open()) return;
      this.query.set('');
      this.selected.set(0);
      setTimeout(() => this.searchInput()?.nativeElement.focus());
    });
  }

  protected onQuery(event: Event): void {
    this.query.set((event.target as HTMLInputElement).value);
    this.selected.set(0);
  }

  protected onKeydown(event: KeyboardEvent): void {
    const total = this.actions().length + this.notes().length;
    if (total === 0) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      this.selected.update((index) => (index + 1) % total);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      this.selected.update((index) => (index - 1 + total) % total);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      this.activate(this.selected());
    }
  }

  protected activate(index: number): void {
    const actions = this.actions();
    if (index < actions.length) {
      const action = actions[index];
      if (action) {
        this.command.emit(action.id);
        this.close();
      }
      return;
    }

    const note = this.notes()[index - actions.length];
    if (note) {
      this.noteSelected.emit(note.id);
      this.close();
    }
  }

  protected chooseNote(note: Note): void {
    this.noteSelected.emit(note.id);
    this.close();
  }

  protected chooseAction(action: PaletteAction): void {
    this.command.emit(action.id);
    this.close();
  }

  protected close(): void {
    if (this.open()) this.closed.emit();
  }

  protected displayTitle(note: Note): string {
    return note.title.trim() || 'Untitled';
  }

  protected isActive(index: number): boolean {
    return this.selected() === index;
  }
}
