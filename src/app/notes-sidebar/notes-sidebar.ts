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
import { Note, NoteTreeItem } from '../models';
import { NoteStore } from '../note-store';
import { blockCountLabel, relativeTime } from '../format';
import { Icon } from '../ui/icon';

interface SidebarRow {
  note: Note;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}

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
  protected readonly collapsedNotes = signal<ReadonlySet<string>>(new Set());

  /**
   * A flat, depth-first list of sidebar rows. Search switches to a simple flat
   * result list so matches inside nested notes are never hidden behind a
   * collapsed parent.
   */
  protected readonly rows = computed<SidebarRow[]>(() => {
    if (this.store.query().trim()) {
      return this.store
        .filteredNotes()
        .map((note) => ({ note, depth: 0, hasChildren: false, expanded: false }));
    }

    const collapsed = this.collapsedNotes();
    const rows: SidebarRow[] = [];
    const visit = (items: NoteTreeItem[], depth: number) => {
      for (const item of items) {
        const hasChildren = item.children.length > 0;
        const expanded = !collapsed.has(item.note.id);
        rows.push({ note: item.note, depth, hasChildren, expanded });
        if (hasChildren && expanded) {
          visit(item.children, depth + 1);
        }
      }
    };

    visit(this.store.noteTree(), 0);
    return rows;
  });

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

  protected createChild(note: Note, event: Event): void {
    event.stopPropagation();
    this.reveal(note.id);
    this.store.createChildNote(note.id);
    this.navigated.emit();
  }

  protected toggleChildren(note: Note, event: Event): void {
    event.stopPropagation();
    this.collapsedNotes.update((collapsed) => {
      const next = new Set(collapsed);
      if (next.has(note.id)) {
        next.delete(note.id);
      } else {
        next.add(note.id);
      }
      return next;
    });
  }

  private reveal(noteId: string): void {
    this.collapsedNotes.update((collapsed) => {
      if (!collapsed.has(noteId)) return collapsed;
      const next = new Set(collapsed);
      next.delete(noteId);
      return next;
    });
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
    for (const parent of this.store.parentChain(note)) {
      this.reveal(parent.id);
    }
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
