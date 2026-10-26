import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { Note } from '../models';
import { NoteStore } from '../note-store';
import { blockCountLabel, relativeTime } from '../format';
import { Icon } from '../ui/icon';

@Component({
  selector: 'app-notes-sidebar',
  imports: [Icon],
  templateUrl: './notes-sidebar.html',
  styleUrl: './notes-sidebar.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'cancelConfirm()',
  },
})
export class NotesSidebar {
  readonly collapsed = input(false);
  readonly navigated = output<void>();
  readonly collapse = output<void>();
  readonly expand = output<void>();

  protected readonly store = inject(NoteStore);
  protected readonly confirmingDelete = signal<string | null>(null);

  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  private readonly expandButton = viewChild<ElementRef<HTMLButtonElement>>('expandButton');

  constructor() {
    effect(() => {
      this.store.selectedId();
      this.confirmingDelete.set(null);
    });
  }

  protected createNote(): void {
    this.store.createNote();
    this.navigated.emit();
  }

  protected onQuery(event: Event): void {
    this.confirmingDelete.set(null);
    this.store.query.set((event.target as HTMLInputElement).value);
  }

  protected clearQuery(): void {
    this.store.query.set('');
    this.searchInput()?.nativeElement.focus();
  }

  protected select(note: Note): void {
    this.store.select(note.id);
    this.navigated.emit();
  }

  protected askDelete(note: Note): void {
    this.confirmingDelete.set(note.id);
  }

  protected confirmDelete(note: Note): void {
    const wasSelected = this.store.selectedId() === note.id;
    this.store.deleteNote(note.id);
    this.confirmingDelete.set(null);
    if (wasSelected) {
      this.navigated.emit();
    }
  }

  protected cancelConfirm(): void {
    this.confirmingDelete.set(null);
  }

  protected subtitle(note: Note): string {
    const blocks = note.blocks.length === 0 ? 'Empty' : blockCountLabel(note.blocks.length);
    return `${blocks} · ${relativeTime(note.updatedAt)}`;
  }

  protected displayTitle(note: Note): string {
    return note.title.trim() || 'Untitled';
  }

  focusSearch(): void {
    this.searchInput()?.nativeElement.focus();
  }

  focusExpand(): void {
    this.expandButton()?.nativeElement.focus();
  }
}
