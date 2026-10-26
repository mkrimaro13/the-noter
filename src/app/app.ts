import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { NoteEditor } from './note-editor/note-editor';
import { NoteOutline } from './note-outline/note-outline';
import { NoteStore } from './note-store';
import { NotesSidebar } from './notes-sidebar/notes-sidebar';
import { Icon } from './ui/icon';

const NOTES_VISIBLE_KEY = 'the-noter.ui.notes-visible';
const OUTLINE_VISIBLE_KEY = 'the-noter.ui.outline-visible';
const WIDE_LAYOUT = '(min-width: 1241px)';

@Component({
  selector: 'app-root',
  imports: [NotesSidebar, NoteEditor, NoteOutline, Icon],
  templateUrl: './app.html',
  styleUrl: './app.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'handleEscape()',
  },
})
export class App {
  protected readonly store = inject(NoteStore);
  protected readonly sidebarOpen = signal(false);
  protected readonly notesVisible = signal(readPreference(NOTES_VISIBLE_KEY, true));
  protected readonly outlineVisible = signal(readPreference(OUTLINE_VISIBLE_KEY, true));
  protected readonly outlineOverlay = signal(false);
  protected readonly wideLayout = signal(true);

  protected readonly showOutlineInline = computed(
    () => this.store.selectedNote() !== null && this.wideLayout() && this.outlineVisible(),
  );
  protected readonly showOutlineRail = computed(
    () => this.store.selectedNote() !== null && !this.outlineOverlay() && !this.showOutlineInline(),
  );

  private readonly destroyRef = inject(DestroyRef);
  private readonly sidebar = viewChild(NotesSidebar);
  private readonly menuButton = viewChild<ElementRef<HTMLButtonElement>>('menuButton');
  private readonly outlineButton = viewChild<ElementRef<HTMLButtonElement>>('outlineButton');

  constructor() {
    if (typeof window !== 'undefined') {
      const query = window.matchMedia(WIDE_LAYOUT);
      this.wideLayout.set(query.matches);

      const onLayoutChange = (event: MediaQueryListEvent) => {
        this.wideLayout.set(event.matches);
        if (event.matches) {
          this.outlineOverlay.set(false);
        }
      };

      query.addEventListener('change', onLayoutChange);
      this.destroyRef.onDestroy(() => query.removeEventListener('change', onLayoutChange));
    }

    // Keep the browser tab in sync with the current note.
    effect(() => {
      const title = this.store.selectedNote()?.title.trim();
      document.title = title ? `${title} · The Noter` : 'The Noter';
    });

    // A note change should never leave a stale outline overlay open.
    effect(() => {
      this.store.selectedId();
      this.outlineOverlay.set(false);
    });

    effect(() => writePreference(NOTES_VISIBLE_KEY, this.notesVisible()));
    effect(() => writePreference(OUTLINE_VISIBLE_KEY, this.outlineVisible()));
  }

  protected openSidebar(): void {
    this.sidebarOpen.set(true);
    setTimeout(() => this.sidebar()?.focusSearch());
  }

  protected closeSidebar(): void {
    if (!this.sidebarOpen()) return;
    this.sidebarOpen.set(false);
    setTimeout(() => this.menuButton()?.nativeElement.focus());
  }

  protected hideNotesSidebar(): void {
    this.notesVisible.set(false);
    setTimeout(() => this.sidebar()?.focusExpand());
  }

  protected showNotesSidebar(): void {
    this.notesVisible.set(true);
    setTimeout(() => this.sidebar()?.focusSearch());
  }

  protected showOutline(): void {
    this.outlineVisible.set(true);
    if (!this.wideLayout()) {
      this.outlineOverlay.set(true);
    }
  }

  protected hideOutline(): void {
    this.outlineVisible.set(false);
    this.outlineOverlay.set(false);
    this.focusOutlineButton();
  }

  protected closeOutlineOverlay(): void {
    this.outlineVisible.set(false);
    this.outlineOverlay.set(false);
    this.focusOutlineButton();
  }

  protected selectHeading(blockId: string): void {
    this.scrollToHeading(blockId);
    if (this.outlineOverlay()) {
      this.closeOutlineOverlay();
    }
  }

  protected handleEscape(): void {
    if (this.outlineOverlay()) {
      this.closeOutlineOverlay();
      return;
    }
    this.closeSidebar();
  }

  private focusOutlineButton(): void {
    setTimeout(() => this.outlineButton()?.nativeElement.focus());
  }

  private scrollToHeading(blockId: string): void {
    const block = Array.from(document.querySelectorAll<HTMLElement>('app-note-block')).find(
      (element) => element.getAttribute('data-block-id') === blockId,
    );
    const heading = block?.querySelector<HTMLTextAreaElement>('.heading-input');
    if (!heading) return;

    heading.scrollIntoView({ behavior: 'smooth', block: 'center' });
    heading.focus({ preventScroll: true });
  }
}

function readPreference(key: string, fallback: boolean): boolean {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? fallback : stored === 'true';
  } catch {
    return fallback;
  }
}

function writePreference(key: string, value: boolean): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // Ignore unavailable storage; the layout still works for this session.
  }
}
