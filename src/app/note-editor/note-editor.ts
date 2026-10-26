import { CdkDragDrop, CdkDropList } from '@angular/cdk/drag-drop';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  computed,
  effect,
  inject,
  input,
  signal,
  viewChild,
} from '@angular/core';
import { relativeTime, resolveTimeFunctions, wordCount } from '../format';
import { imageFileToDataUrl } from '../image';
import {
  BLOCK_MENU,
  BlockPatch,
  BlockType,
  ImageColumnPatch,
  Note,
  NoteBlock,
  createBlock,
  visibleImageColumnText,
  visibleTextColumns,
} from '../models';
import { NoteStore } from '../note-store';
import { Focus } from '../ui/focus';
import { Icon } from '../ui/icon';
import { NoteBlock as NoteBlockEditor } from '../note-block/note-block';

@Component({
  selector: 'app-note-editor',
  imports: [NoteBlockEditor, Icon, Focus, CdkDropList],
  templateUrl: './note-editor.html',
  styleUrl: './note-editor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'closeMenu()',
    '(document:paste)': 'onPaste($event)',
  },
})
export class NoteEditor {
  readonly note = input.required<Note>();

  protected readonly store = inject(NoteStore);
  protected readonly blockMenu = BLOCK_MENU;
  protected readonly menuOpen = signal(false);
  protected readonly focusMetaId = signal<string | null>(null);
  protected readonly focusBlockId = signal<string | null>(null);
  protected readonly focusImageColumn = signal<{ blockId: string; index: number } | null>(null);
  protected readonly pasteError = signal<string | null>(null);

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly addButton = viewChild<ElementRef<HTMLButtonElement>>('addButton');
  private pasteErrorTimer: ReturnType<typeof setTimeout> | undefined;

  protected readonly words = computed(() => {
    const text = this.note()
      .blocks.map((block) =>
        [
          block.text,
          block.caption,
          ...visibleTextColumns(block),
          ...visibleImageColumnText(block),
          ...block.items,
        ].join(' '),
      )
      .join(' ');
    return wordCount(text);
  });

  private readonly noteId = computed(() => this.note().id);

  constructor() {
    effect(() => {
      this.noteId();
      this.menuOpen.set(false);
      this.focusMetaId.set(null);
      this.focusBlockId.set(null);
      this.focusImageColumn.set(null);
    });
  }

  protected relative(timestamp: number): string {
    return relativeTime(timestamp);
  }

  protected onTitleInput(event: Event): void {
    this.store.setTitle(this.note().id, (event.target as HTMLInputElement).value);
  }

  protected addMeta(): void {
    this.focusMetaId.set(this.store.addMeta(this.note().id));
  }

  protected updateMetaKey(metaId: string, event: Event): void {
    this.store.updateMeta(this.note().id, metaId, {
      key: (event.target as HTMLInputElement).value,
    });
  }

  protected updateMetaValue(metaId: string, event: Event): void {
    this.store.updateMeta(this.note().id, metaId, {
      value: (event.target as HTMLInputElement).value,
    });
  }

  /** Time helpers are expanded when the field is committed, not while typing. */
  protected commitMetaValue(metaId: string, event: Event): void {
    const input = event.target as HTMLInputElement;
    const resolved = resolveTimeFunctions(input.value);
    if (resolved === input.value) return;

    input.value = resolved;
    this.store.updateMeta(this.note().id, metaId, { value: resolved });
  }

  protected removeMeta(metaId: string): void {
    if (this.focusMetaId() === metaId) {
      this.focusMetaId.set(null);
    }
    this.store.removeMeta(this.note().id, metaId);
  }

  protected onBlockChange(blockId: string, patch: BlockPatch): void {
    this.store.updateBlock(this.note().id, blockId, patch);
  }

  protected onBlockTypeChange(blockId: string, type: BlockType): void {
    this.store.setBlockType(this.note().id, blockId, type);
    this.focusBlockId.set(blockId);
  }

  protected onColumnChange(blockId: string, change: { index: number; value: string }): void {
    this.store.updateColumn(this.note().id, blockId, change.index, change.value);
  }

  protected onColumnCountChange(blockId: string, count: number): void {
    this.store.setColumnCount(this.note().id, blockId, count);
  }

  protected onImageColumnChange(
    blockId: string,
    change: { index: number; patch: ImageColumnPatch },
  ): void {
    this.store.updateImageColumn(this.note().id, blockId, change.index, change.patch);
  }

  protected onBlockFocused(): void {
    this.focusBlockId.set(null);
    this.focusImageColumn.set(null);
  }

  protected focusColumnFor(blockId: string): number | null {
    const focus = this.focusImageColumn();
    return focus?.blockId === blockId ? focus.index : null;
  }

  protected onSplitBlock(
    blockId: string,
    split: { column: number; before: string; after: string },
  ): void {
    const block = this.store.splitTextBlock(this.note().id, blockId, split);
    if (block) {
      this.focusBlockId.set(block.id);
    }
  }

  protected async onPaste(event: ClipboardEvent): Promise<void> {
    const target = event.target;
    if (!(target instanceof Node) || !this.host.nativeElement.contains(target)) return;

    const files = imageFilesFrom(event.clipboardData);
    if (files.length === 0) return;

    event.preventDefault();
    this.pasteError.set(null);

    const sources: string[] = [];
    for (const file of files) {
      try {
        sources.push(await imageFileToDataUrl(file));
      } catch (error) {
        this.showPasteError(error instanceof Error ? error.message : 'Could not paste that image.');
      }
    }

    if (sources.length === 0) return;

    const targetBlock = this.blockFromTarget(target);
    const columnIndex = this.imageColumnAt(target);

    // Pasting into an existing image column replaces only that column's image
    // instead of appending another block. Extra images from the clipboard
    // follow the block.
    if (targetBlock?.type === 'image') {
      const [src, ...rest] = sources;
      const index = columnIndex ?? 0;

      if (index === 0) {
        const shouldFocus = targetBlock.src === '' || targetBlock.mainColumnType !== 'image';
        this.store.updateBlock(this.note().id, targetBlock.id, {
          src,
          caption: '',
          mainColumnType: 'image',
        });

        // When the empty image block's URL field is replaced by the preview,
        // move focus to its caption so the keyboard stays in the editor.
        if (shouldFocus) {
          this.focusImageColumn.set(null);
          this.focusBlockId.set(targetBlock.id);
        }
      } else {
        const column = targetBlock.imageColumns[index - 1];
        const shouldFocus = !column || column.type !== 'image' || column.src === '';

        this.store.updateImageColumn(this.note().id, targetBlock.id, index - 1, {
          type: 'image',
          src,
          caption: '',
        });

        if (shouldFocus) {
          this.focusBlockId.set(null);
          this.focusImageColumn.set({ blockId: targetBlock.id, index });
        }
      }

      if (rest.length > 0) {
        this.store.insertBlocks(
          this.note().id,
          targetBlock.id,
          rest.map((image) => createBlock('image', { src: image })),
        );
      }
      return;
    }

    this.store.insertBlocks(
      this.note().id,
      targetBlock?.id ?? null,
      sources.map((src) => createBlock('image', { src })),
    );
  }

  private showPasteError(message: string): void {
    clearTimeout(this.pasteErrorTimer);
    this.pasteError.set(message);
    this.pasteErrorTimer = setTimeout(() => this.pasteError.set(null), 6000);
  }

  private blockFromTarget(target: Node): NoteBlock | null {
    const element = target instanceof Element ? target : target.parentElement;
    const blockId = element?.closest('app-note-block')?.getAttribute('data-block-id');
    if (!blockId) return null;

    return this.note().blocks.find((block) => block.id === blockId) ?? null;
  }

  private imageColumnAt(target: Node): number | null {
    const element = target instanceof Element ? target : target.parentElement;
    const column = element?.closest<HTMLElement>('[data-image-column]');
    if (!column) return null;

    const index = Number(column.getAttribute('data-image-column'));
    return Number.isInteger(index) ? index : null;
  }

  protected removeBlock(blockId: string): void {
    if (this.focusBlockId() === blockId) {
      this.focusBlockId.set(null);
    }
    this.store.removeBlock(this.note().id, blockId);
  }

  protected moveBlock(from: number, to: number): void {
    this.store.moveBlock(this.note().id, from, to);
  }

  protected onDrop(event: CdkDragDrop<NoteBlock[]>): void {
    if (event.previousIndex !== event.currentIndex) {
      this.store.moveBlock(this.note().id, event.previousIndex, event.currentIndex);
    }
  }

  protected addBlock(type: BlockType): void {
    const block = this.store.addBlock(this.note().id, type);
    this.focusBlockId.set(block.id);
    this.menuOpen.set(false);
  }

  protected toggleMenu(): void {
    this.menuOpen.update((open) => !open);
  }

  protected closeMenu(): void {
    if (!this.menuOpen()) return;
    this.menuOpen.set(false);
    // Return focus to the trigger when the menu is dismissed.
    setTimeout(() => this.addButton()?.nativeElement.focus());
  }
}

function imageFilesFrom(data: DataTransfer | null): File[] {
  if (!data) return [];

  const files = Array.from(data.files).filter((file) => file.type.startsWith('image/'));
  if (files.length > 0) return files;

  return Array.from(data.items)
    .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
    .map((item) => item.getAsFile())
    .filter((file): file is File => file !== null);
}
