import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList } from '@angular/cdk/drag-drop';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  forwardRef,
  inject,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { FenceShortcut, MarkdownBlockShortcut } from '../markdown';
import {
  BLOCK_MENU,
  BlockPatch,
  BlockType,
  ImageColumnPatch,
  NoteBlock as NoteBlockData,
} from '../models';
import { NoteStore } from '../note-store';
import { Focus } from '../ui/focus';
import { Icon } from '../ui/icon';
import { NoteBlock as NoteBlockEditor } from '../note-block/note-block';

/**
 * An inline, editable view of a child note. It is deliberately separate from
 * `NoteBlock` so that a sub-note block can render a full block list without the
 * two components importing each other.
 */
@Component({
  selector: 'app-subnote-block',
  imports: [
    Icon,
    Focus,
    CdkDragHandle,
    CdkDropList,
    NoteBlockEditor,
    forwardRef(() => SubnoteBlock),
  ],
  templateUrl: './subnote-block.html',
  styleUrl: './subnote-block.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  hostDirectives: [
    {
      directive: CdkDrag,
      inputs: ['cdkDragLockAxis'],
    },
  ],
  host: {
    class: 'subnote-host',
    '[attr.data-note-id]': 'child()?.id ?? null',
    '(document:keydown.escape)': 'closeMenu(true)',
  },
})
export class SubnoteBlock {
  readonly block = input.required<NoteBlockData>();
  readonly index = input.required<number>();
  readonly total = input.required<number>();
  readonly focusOnInit = input(false);
  /** Nesting depth, used only to soften the surface of deeper sub-notes. */
  readonly depth = input(0);

  readonly removed = output<void>();
  readonly move = output<number>();
  readonly focused = output<void>();

  protected readonly store = inject(NoteStore);
  protected readonly blockMenu = BLOCK_MENU;
  protected readonly menuOpen = signal(false);
  protected readonly focusBlockId = signal<string | null>(null);

  protected readonly child = computed(
    () => this.store.notes().find((note) => note.id === this.block().noteId) ?? null,
  );

  private readonly titleInput = viewChild<ElementRef<HTMLInputElement>>('titleInput');
  private readonly addButton = viewChild<ElementRef<HTMLButtonElement>>('addButton');

  constructor() {
    effect(() => {
      if (!this.focusOnInit()) return;

      setTimeout(() => {
        const input = this.titleInput()?.nativeElement;
        if (!input?.isConnected) return;
        input.focus();
        this.focused.emit();
      });
    });
  }

  protected onTitleInput(event: Event): void {
    const child = this.child();
    if (!child) return;
    this.store.setTitle(child.id, (event.target as HTMLInputElement).value);
  }

  protected openNote(): void {
    const child = this.child();
    if (child) {
      this.store.select(child.id);
    }
  }

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  protected closeMenu(restoreFocus = false): void {
    if (!this.menuOpen()) return;
    this.menuOpen.set(false);

    if (restoreFocus) {
      setTimeout(() => this.addButton()?.nativeElement.focus());
    }
  }

  protected addBlock(type: BlockType): void {
    const child = this.child();
    if (!child) return;

    this.menuOpen.set(false);

    if (type === 'subnote') {
      const block = this.store.addSubnoteBlock(child.id);
      if (block) {
        this.focusBlockId.set(block.id);
      }
      return;
    }

    const block = this.store.addBlock(child.id, type);
    this.focusBlockId.set(block.id);
  }

  protected onBlockChange(blockId: string, patch: BlockPatch): void {
    const child = this.child();
    if (child) {
      this.store.updateBlock(child.id, blockId, patch);
    }
  }

  protected onBlockTypeChange(blockId: string, type: BlockType): void {
    const child = this.child();
    if (!child) return;

    if (type === 'subnote') {
      this.store.convertBlockToSubnote(child.id, blockId);
    } else {
      this.store.setBlockType(child.id, blockId, type);
    }
    this.focusBlockId.set(blockId);
  }

  protected onColumnChange(blockId: string, change: { index: number; value: string }): void {
    const child = this.child();
    if (child) {
      this.store.updateColumn(child.id, blockId, change.index, change.value);
    }
  }

  protected onColumnCountChange(blockId: string, count: number): void {
    const child = this.child();
    if (child) {
      this.store.setColumnCount(child.id, blockId, count);
    }
  }

  protected onImageColumnChange(
    blockId: string,
    change: { index: number; patch: ImageColumnPatch },
  ): void {
    const child = this.child();
    if (child) {
      this.store.updateImageColumn(child.id, blockId, change.index, change.patch);
    }
  }

  protected onSplitBlock(
    blockId: string,
    split: { column: number; before: string; after: string },
  ): void {
    const child = this.child();
    if (!child) return;

    const block = this.store.splitTextBlock(child.id, blockId, split);
    if (block) {
      this.focusBlockId.set(block.id);
    }
  }

  protected onHeadingSplit(blockId: string, split: { before: string; after: string }): void {
    const child = this.child();
    if (!child) return;

    const block = this.store.splitHeadingBlock(child.id, blockId, split);
    if (block) {
      this.focusBlockId.set(block.id);
    }
  }

  protected onFence(blockId: string, fence: FenceShortcut): void {
    const child = this.child();
    if (!child) return;

    this.store.convertTextBlockToCode(child.id, blockId, fence);
    this.focusBlockId.set(blockId);
  }

  protected onMarkdownShortcut(blockId: string, shortcut: MarkdownBlockShortcut): void {
    const child = this.child();
    if (!child) return;

    this.store.applyBlockShortcut(child.id, blockId, shortcut);
    this.focusBlockId.set(blockId);
  }

  protected removeBlock(blockId: string): void {
    if (this.focusBlockId() === blockId) {
      this.focusBlockId.set(null);
    }

    const child = this.child();
    if (child) {
      this.store.removeBlock(child.id, blockId);
    }
  }

  protected moveBlock(from: number, to: number): void {
    const child = this.child();
    if (child) {
      this.store.moveBlock(child.id, from, to);
    }
  }

  protected onDrop(event: CdkDragDrop<NoteBlockData[]>): void {
    if (event.previousIndex !== event.currentIndex) {
      this.moveBlock(event.previousIndex, event.currentIndex);
    }
  }

  protected onBlockFocused(): void {
    this.focusBlockId.set(null);
    this.focused.emit();
  }

  protected onHandleKeydown(event: KeyboardEvent): void {
    const index = this.index();
    if (event.key === 'ArrowUp' && index > 0) {
      event.preventDefault();
      this.move.emit(index - 1);
    } else if (event.key === 'ArrowDown' && index < this.total() - 1) {
      event.preventDefault();
      this.move.emit(index + 1);
    }
  }
}
