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
import { Note, NoteTreeItem, isImageIcon } from '../models';
import { NoteStore } from '../note-store';
import { ConflictChoice, SyncService } from '../sync';
import { conflictPreview } from '../conflict-preview';
import { blockCountLabel, relativeTime } from '../format';
import type { EditedWindow } from '../search';
import { AssetSrc } from '../ui/asset-src';
import { HighlightText } from '../ui/highlight-text';
import { Icon } from '../ui/icon';

const COLLAPSED_KEY = 'the-noter.ui.collapsed.v1';

const EDITED_OPTIONS: Array<{ value: EditedWindow; label: string }> = [
  { value: 'any', label: 'Any time' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'Last 7 days' },
  { value: 'month', label: 'Last 30 days' },
];

interface SidebarRow {
  note: Note;
  depth: number;
  hasChildren: boolean;
  expanded: boolean;
}

interface ConflictRow {
  conflict: { id: string; origin: string; deletedLocally: boolean };
  mine: ReturnType<typeof conflictPreview>;
  theirs: ReturnType<typeof conflictPreview>;
  inTrash: boolean;
}

@Component({
  selector: 'app-notes-sidebar',
  imports: [Icon, AssetSrc, HighlightText],
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
  protected readonly sync = inject(SyncService);
  protected readonly isImageIcon = isImageIcon;
  protected readonly relativeTime = relativeTime;
  protected readonly confirmingDelete = signal<string | null>(null);
  protected readonly confirmingPurge = signal<string | null>(null);
  protected readonly confirmingEmpty = signal(false);
  protected readonly trashOpen = signal(false);
  protected readonly favoritesOpen = signal(true);
  protected readonly conflictsOpen = signal(false);
  protected readonly diagnosticsOpen = signal(false);
  protected readonly movingNote = signal<string | null>(null);
  protected readonly collapsedNotes = signal<ReadonlySet<string>>(loadCollapsed());
  protected readonly backupStatus = signal<string | null>(null);
  private backupStatusTimer: ReturnType<typeof setTimeout> | undefined;

  /**
   * Every label keeps “Saved locally” first: the browser copy is written before
   * the network request, and it stays valid when the server is unavailable.
   */
  protected readonly saveLabel = computed(() => {
    if (this.store.storageError()) return 'Not saved';
    switch (this.sync.status()) {
      case 'syncing':
        return 'Saved locally · Syncing…';
      case 'synced':
        return 'Saved locally · Synced';
      case 'offline':
        return 'Saved locally · Offline';
      case 'error':
        return 'Saved locally · Sync error';
      default:
        return 'Saved locally';
    }
  });

  protected readonly saveTitle = computed(() => this.store.storageError() ?? this.sync.message());

  /**
   * A flat, depth-first list of sidebar rows. Search and filters switch to a
   * simple flat result list so matches inside nested notes are never hidden
   * behind a collapsed parent.
   */
  protected readonly rows = computed<SidebarRow[]>(() => {
    if (this.store.query().trim() || this.store.filterActive()) {
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

  /**
   * Both sides of every pending sync conflict: the live local note (or its
   * absence) and the version stored when the conflict was detected.
   */
  protected readonly conflictRows = computed<ConflictRow[]>(() =>
    this.sync.conflicts().map((conflict) => {
      const local =
        this.store.notes().find((note) => note.id === conflict.id) ??
        this.store.trashedNotes().find((note) => note.id === conflict.id) ??
        null;
      return {
        conflict,
        mine: conflictPreview(local),
        theirs: conflictPreview(conflict.theirs),
        inTrash: local !== null && local.deletedAt !== null,
      };
    }),
  );

  /** Rows for the sync diagnostics popover, shown when they are available. */
  protected readonly diagnosticRows = computed<Array<{ label: string; value: string }>>(() => {
    const rows: Array<{ label: string; value: string }> = [
      { label: 'Status', value: this.saveLabel() },
      {
        label: 'Last sync',
        value: this.sync.lastSyncedAt() ? relativeTime(this.sync.lastSyncedAt()!) : 'Not yet',
      },
      {
        label: 'Waiting',
        value: this.sync.pendingCount() > 0 ? `${this.sync.pendingCount()} change(s)` : 'Nothing',
      },
    ];

    const diagnostics = this.sync.diagnostics();
    if (diagnostics) {
      rows.push(
        {
          label: 'Server documents',
          value: diagnostics.docCount === null ? '—' : String(diagnostics.docCount),
        },
        {
          label: 'Deleted on server',
          value: diagnostics.deletedCount === null ? '—' : String(diagnostics.deletedCount),
        },
        {
          label: 'Compaction',
          value:
            diagnostics.compactRunning === null
              ? '—'
              : diagnostics.compactRunning
                ? 'Running'
                : 'Idle',
        },
      );
      const maintenance = diagnostics.maintenance;
      if (maintenance) {
        rows.push(
          {
            label: 'Last compaction',
            value: maintenance.lastCompaction ? relativeTime(maintenance.lastCompaction) : 'Never',
          },
          {
            label: 'Last purge',
            value: maintenance.lastPurge ? relativeTime(maintenance.lastPurge) : 'Never',
          },
          {
            label: 'Tombstones purged',
            value: maintenance.purged === null ? '—' : String(maintenance.purged),
          },
        );
      }
    }

    return rows;
  });

  private readonly searchInput = viewChild<ElementRef<HTMLInputElement>>('searchInput');
  private readonly expandButton = viewChild<ElementRef<HTMLButtonElement>>('expandButton');

  /** Distinct values of the selected metadata key, for the value select. */
  protected readonly metadataValues = computed(() =>
    this.store.metadataValues(this.store.filter().metadataKey),
  );

  protected readonly editedOptions = EDITED_OPTIONS;

  constructor() {
    effect(() => {
      this.store.selectedId();
      this.confirmingDelete.set(null);
      this.movingNote.set(null);
    });

    // An empty trash should not stay open, since there is nothing left to show.
    effect(() => {
      if (this.store.trashedNotes().length === 0) {
        this.trashOpen.set(false);
        this.confirmingPurge.set(null);
        this.confirmingEmpty.set(false);
      }
    });

    // Nothing to decide means the conflicts section has nothing to show.
    effect(() => {
      if (this.sync.conflicts().length === 0) this.conflictsOpen.set(false);
    });

    effect(() => {
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...this.collapsedNotes()]));
      } catch {
        // The tree still works for this session if storage is unavailable.
      }
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

  /** Removes every filter facet; the free-text query is kept intact. */
  protected clearFilters(): void {
    this.store.clearFilters();
  }

  protected onEditedFilter(event: Event): void {
    this.store.patchFilter({ edited: (event.target as HTMLSelectElement).value as EditedWindow });
  }

  protected onMetadataKeyFilter(event: Event): void {
    this.store.patchFilter({ metadataKey: (event.target as HTMLSelectElement).value });
  }

  protected onMetadataValueFilter(event: Event): void {
    this.store.patchFilter({ metadataValue: (event.target as HTMLSelectElement).value });
  }

  protected toggleFavorites(): void {
    this.favoritesOpen.update((open) => !open);
  }

  /** Pins or unpins a note straight from the list or favorites section. */
  protected toggleFavorite(note: Note, event: Event): void {
    event.stopPropagation();
    this.store.toggleFavorite(note.id);
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
    this.confirmingPurge.set(null);
    this.confirmingEmpty.set(false);
    this.movingNote.set(null);
    this.diagnosticsOpen.set(false);
  }

  protected toggleConflicts(): void {
    this.conflictsOpen.update((open) => !open);
  }

  /** Applies one of the three decisions for a pending conflict. */
  protected resolveConflict(row: ConflictRow, choice: ConflictChoice): void {
    void this.sync.resolveConflict(row.conflict.id, choice);
  }

  /** Runs a full sync pass and refreshes the server counters for the popover. */
  protected syncNow(): void {
    void this.sync.syncNow();
  }

  protected toggleDiagnostics(): void {
    this.diagnosticsOpen.update((open) => !open);
    if (this.diagnosticsOpen()) void this.sync.refreshDiagnostics();
  }

  protected toggleTrash(): void {
    this.trashOpen.update((open) => !open);
    this.confirmingPurge.set(null);
    this.confirmingEmpty.set(false);
  }

  protected restoreNote(note: Note): void {
    this.store.restoreNote(note.id);
    this.confirmingPurge.set(null);
    this.navigated.emit();
  }

  protected askPurge(note: Note): void {
    this.confirmingPurge.update((current) => (current === note.id ? null : note.id));
    this.confirmingEmpty.set(false);
  }

  protected confirmPurge(note: Note): void {
    this.store.purgeNote(note.id);
    this.confirmingPurge.set(null);
  }

  protected askEmptyTrash(): void {
    this.confirmingEmpty.update((value) => !value);
    this.confirmingPurge.set(null);
  }

  protected confirmEmptyTrash(): void {
    this.store.emptyTrash();
    this.confirmingEmpty.set(false);
  }

  protected askMove(note: Note, event: Event): void {
    event.stopPropagation();
    this.confirmingDelete.set(null);
    this.movingNote.update((current) => (current === note.id ? null : note.id));
  }

  /** Notes that can become the parent of `note` without creating a cycle. */
  protected moveTargets(note: Note): Note[] {
    const descendants = this.store.descendantIds(note.id);
    return this.store
      .notes()
      .filter((target) => target.id !== note.id && !descendants.has(target.id))
      .sort((a, b) => this.displayTitle(a).localeCompare(this.displayTitle(b)));
  }

  protected moveTo(note: Note, parentId: string | null): void {
    this.store.moveNote(note.id, parentId);
    if (parentId) this.reveal(parentId);
    this.movingNote.set(null);
  }

  protected subtitle(note: Note): string {
    const blocks = note.blocks.length === 0 ? 'Empty' : blockCountLabel(note.blocks.length);
    return `${blocks} · ${relativeTime(note.updatedAt)}`;
  }

  protected displayTitle(note: Note): string {
    return note.title.trim() || 'Untitled';
  }

  protected exportBackup(): void {
    const json = this.store.exportBackup();
    const date = new Date().toISOString().slice(0, 10);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = `the-noter-backup-${date}.json`;
    link.click();
    URL.revokeObjectURL(url);

    this.announce(`Exported ${this.store.total()} notes.`);
  }

  protected async importBackup(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;

    try {
      const result = this.store.importBackup(await file.text());
      this.announce(
        `Imported ${result.added} new and ${result.updated} updated notes` +
          (result.skipped > 0 ? `, ${result.skipped} kept local.` : '.'),
      );
      this.navigated.emit();
    } catch (error) {
      this.announce(error instanceof Error ? error.message : 'Could not import the backup.');
    }
  }

  private announce(message: string): void {
    clearTimeout(this.backupStatusTimer);
    this.backupStatus.set(message);
    this.backupStatusTimer = setTimeout(() => this.backupStatus.set(null), 5000);
  }

  focusSearch(): void {
    this.searchInput()?.nativeElement.focus();
  }

  focusExpand(): void {
    this.expandButton()?.nativeElement.focus();
  }
}

function loadCollapsed(): ReadonlySet<string> {
  try {
    const raw = localStorage.getItem(COLLAPSED_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((id): id is string => typeof id === 'string'));
  } catch {
    return new Set();
  }
}
