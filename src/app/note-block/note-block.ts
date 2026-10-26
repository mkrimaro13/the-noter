import { CdkDrag, CdkDragHandle } from '@angular/cdk/drag-drop';
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
  viewChildren,
} from '@angular/core';
import {
  FenceShortcut,
  MarkdownBlockShortcut,
  hasInlineMarkup,
  readBlockShortcut,
  readFence,
  readFenceLine,
} from '../markdown';
import { looksLikeLatex } from '../latex';
import {
  BLOCK_MENU,
  BlockPatch,
  BlockType,
  ImageColumnPatch,
  MAX_HEADING_LEVEL,
  MAX_TEXT_COLUMNS,
  NoteBlock as NoteBlockData,
  visibleImageColumns,
  visibleTextColumns,
} from '../models';
import { Autosize } from '../ui/autosize';
import { Focus } from '../ui/focus';
import { CodeHighlight } from '../ui/highlight';
import { Icon } from '../ui/icon';
import { Latex } from '../ui/latex';
import { MarkdownInline } from '../ui/markdown-inline';
import { ImageColumn } from './image-column/image-column';

@Component({
  selector: 'app-note-block',
  imports: [
    Icon,
    Autosize,
    Focus,
    CodeHighlight,
    Latex,
    MarkdownInline,
    CdkDragHandle,
    ImageColumn,
  ],
  templateUrl: './note-block.html',
  styleUrl: './note-block.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  hostDirectives: [
    {
      directive: CdkDrag,
      inputs: ['cdkDragLockAxis'],
    },
  ],
  host: {
    class: 'block-host',
    '(document:click)': 'onDocumentClick($event)',
    '(document:keydown.escape)': 'closeMenus(true)',
  },
})
export class NoteBlock {
  readonly block = input.required<NoteBlockData>();
  readonly index = input.required<number>();
  readonly total = input.required<number>();
  readonly focusOnInit = input(false);
  /** Visual image-column index to focus after a paste or column change. */
  readonly focusColumn = input<number | null>(null);

  readonly changed = output<BlockPatch>();
  readonly columnChanged = output<{ index: number; value: string }>();
  readonly columnCountChanged = output<number>();
  readonly imageColumnChanged = output<{ index: number; patch: ImageColumnPatch }>();
  readonly split = output<{ column: number; before: string; after: string }>();
  readonly headingSplit = output<{ before: string; after: string }>();
  readonly fence = output<FenceShortcut>();
  readonly shortcut = output<MarkdownBlockShortcut>();
  readonly typeChanged = output<BlockType>();
  readonly removed = output<void>();
  readonly move = output<number>();
  readonly focused = output<void>();

  protected readonly maxColumns = MAX_TEXT_COLUMNS;
  protected readonly columnOptions = [1, 2, 3, 4];
  protected readonly blockTypes = BLOCK_MENU;
  protected readonly headingOptions = Array.from(
    { length: MAX_HEADING_LEVEL },
    (_, index) => index + 1,
  );
  protected readonly columnsMenuOpen = signal(false);
  protected readonly headingMenuOpen = signal(false);
  protected readonly typeMenuOpen = signal(false);
  protected readonly visibleColumns = computed(() => visibleTextColumns(this.block()));
  protected readonly imageColumns = computed(() => visibleImageColumns(this.block()));
  protected readonly hasMarkup = hasInlineMarkup;

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly itemInputs = viewChildren<ElementRef<HTMLInputElement>>('itemInput');
  private readonly pendingItemFocus = signal<number | null>(null);
  private readonly columnInputs = viewChildren<ElementRef<HTMLTextAreaElement>>('columnInput');
  private readonly pendingColumnFocus = signal<number | null>(null);
  private readonly pendingImageColumnFocus = signal<number | null>(null);
  private readonly columnsButton = viewChild<ElementRef<HTMLButtonElement>>('columnsButton');
  private readonly headingButton = viewChild<ElementRef<HTMLButtonElement>>('headingButton');
  private readonly typeButton = viewChild<ElementRef<HTMLButtonElement>>('typeButton');

  constructor() {
    effect(() => {
      const wanted = this.pendingItemFocus();
      if (wanted === null) return;

      const input = this.itemInputs()[wanted]?.nativeElement;
      if (!input) return;

      input.focus();
      this.pendingItemFocus.set(null);
    });

    effect(() => {
      const wanted = this.pendingColumnFocus();
      if (wanted === null) return;

      const input = this.columnInputs()[wanted]?.nativeElement;
      if (!input) return;

      input.focus();
      this.pendingColumnFocus.set(null);
    });
  }

  protected onText(event: Event): void {
    this.changed.emit({ text: (event.target as HTMLTextAreaElement).value });
  }

  /**
   * Lets headings be written with Markdown-style prefixes. Typing `### ` at
   * the start of a heading switches it to H3 and removes the prefix while
   * keeping the caret in place.
   */
  protected onHeadingInput(event: Event): void {
    const textarea = event.target as HTMLTextAreaElement;
    const match = /^(#{1,6})[ \t]+/.exec(textarea.value);

    if (!match) {
      this.changed.emit({ text: textarea.value });
      return;
    }

    const caret = textarea.selectionStart ?? textarea.value.length;
    const prefixLength = match[0].length;
    const text = textarea.value.slice(prefixLength);

    textarea.value = text;
    const nextCaret = Math.max(0, caret - prefixLength);
    textarea.setSelectionRange(nextCaret, nextCaret);

    this.changed.emit({ text, level: match[1].length });
  }

  protected onColumnInput(event: Event, index: number): void {
    const value = (event.target as HTMLTextAreaElement).value;

    // A pasted or Shift+Entered fence promotes the whole single-column block.
    const fence = readFence(value);
    if (fence && index === 0 && this.visibleColumns().length === 1) {
      this.fence.emit(fence);
      return;
    }

    // Markdown block prefixes only make sense for a single writing column.
    const shortcut = readBlockShortcut(value);
    if (shortcut && index === 0 && this.visibleColumns().length === 1) {
      this.shortcut.emit(shortcut);
      return;
    }

    this.columnChanged.emit({ index, value });
  }

  protected onColumnKeydown(event: KeyboardEvent, index: number): void {
    // Plain Enter starts a new text block. Shift/Alt/Ctrl/Meta + Enter keep
    // their native textarea behavior (a line break within the block), and IME
    // composition must never be interrupted.
    if (event.key !== 'Enter' || event.isComposing) return;
    if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;

    const textarea = event.target as HTMLTextAreaElement;
    const fence = readFenceLine(textarea.value);
    if (fence && index === 0 && this.visibleColumns().length === 1) {
      event.preventDefault();
      this.fence.emit(fence);
      return;
    }

    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? start;

    event.preventDefault();
    this.split.emit({
      column: index,
      before: textarea.value.slice(0, start),
      after: textarea.value.slice(end),
    });
  }

  /**
   * Plain Enter in a heading leaves the heading behind and starts a new text
   * block, matching the rest of the editor. Modifier + Enter still inserts a
   * soft line break inside the heading.
   */
  protected onHeadingKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter' || event.isComposing) return;
    if (event.shiftKey || event.altKey || event.ctrlKey || event.metaKey) return;

    const textarea = event.target as HTMLTextAreaElement;
    const start = textarea.selectionStart ?? textarea.value.length;
    const end = textarea.selectionEnd ?? start;

    event.preventDefault();
    this.headingSplit.emit({
      before: textarea.value.slice(0, start),
      after: textarea.value.slice(end),
    });
  }

  protected onCodeLanguage(event: Event): void {
    this.changed.emit({ language: (event.target as HTMLInputElement).value });
  }

  /**
   * Function blocks render as LaTeX when their label says so, when the fence
   * chose math, or when the writing itself looks like an expression. An
   * explicit `plain` label lets the author turn that detection off.
   */
  protected mathMode(): boolean {
    const block = this.block();
    if (block.type !== 'function') return false;
    if (block.language === 'latex') return true;
    if (block.language === 'plain') return false;
    return looksLikeLatex(block.text);
  }

  protected showMath(): boolean {
    return this.block().text.trim().length > 0 && this.mathMode();
  }

  protected toggleMath(): void {
    this.changed.emit({ language: this.mathMode() ? 'plain' : 'latex' });
  }

  protected toggleColumnsMenu(): void {
    const open = !this.columnsMenuOpen();
    this.columnsMenuOpen.set(open);
    if (open) {
      this.headingMenuOpen.set(false);
      this.typeMenuOpen.set(false);
    }
  }

  protected toggleHeadingMenu(): void {
    const open = !this.headingMenuOpen();
    this.headingMenuOpen.set(open);
    if (open) {
      this.columnsMenuOpen.set(false);
      this.typeMenuOpen.set(false);
    }
  }

  protected toggleTypeMenu(): void {
    const open = !this.typeMenuOpen();
    this.typeMenuOpen.set(open);
    if (open) {
      this.columnsMenuOpen.set(false);
      this.headingMenuOpen.set(false);
    }
  }

  protected closeMenus(restoreFocus = false): void {
    const hadColumns = this.columnsMenuOpen();
    const hadHeading = this.headingMenuOpen();
    const hadType = this.typeMenuOpen();
    if (!hadColumns && !hadHeading && !hadType) return;

    this.columnsMenuOpen.set(false);
    this.headingMenuOpen.set(false);
    this.typeMenuOpen.set(false);

    if (restoreFocus) {
      const button = hadType
        ? this.typeButton()
        : hadHeading
          ? this.headingButton()
          : this.columnsButton();
      setTimeout(() => button?.nativeElement.focus());
    }
  }

  protected setBlockType(type: BlockType): void {
    this.typeMenuOpen.set(false);

    if (type !== this.block().type) {
      this.typeChanged.emit(type);
      return;
    }

    setTimeout(() => this.typeButton()?.nativeElement.focus());
  }

  protected setColumns(count: number): void {
    if (count < 1 || count > MAX_TEXT_COLUMNS) return;

    this.pendingColumnFocus.set(null);
    this.pendingImageColumnFocus.set(null);
    const current = this.block().columnCount;
    this.columnsMenuOpen.set(false);

    if (count === current) {
      setTimeout(() => this.columnsButton()?.nativeElement.focus());
      return;
    }

    this.columnCountChanged.emit(count);

    if (count > current) {
      // Focus the first newly revealed column, ready for writing.
      if (this.block().type === 'image') {
        this.pendingImageColumnFocus.set(current);
      } else {
        this.pendingColumnFocus.set(current);
      }
    } else {
      setTimeout(() => this.columnsButton()?.nativeElement.focus());
    }
  }

  protected setHeadingLevel(level: number): void {
    if (level < 1 || level > MAX_HEADING_LEVEL) return;

    this.headingMenuOpen.set(false);
    this.changed.emit({ level });
    setTimeout(() => this.headingButton()?.nativeElement.focus());
  }

  protected onDocumentClick(event: MouseEvent): void {
    if (!this.columnsMenuOpen() && !this.headingMenuOpen() && !this.typeMenuOpen()) return;

    const target = event.target;
    if (
      target instanceof Node &&
      this.host.nativeElement.contains(target) &&
      target instanceof Element &&
      target.closest(
        '.columns-menu, .columns-toggle, .heading-menu, .heading-toggle, .type-menu, .type-toggle',
      )
    ) {
      return;
    }

    this.closeMenus();
  }

  protected onImageColumnChange(index: number, patch: ImageColumnPatch): void {
    if (index === 0) {
      const { type, ...rest } = patch;
      this.changed.emit(type === undefined ? rest : { ...rest, mainColumnType: type });
      return;
    }
    this.imageColumnChanged.emit({ index: index - 1, patch });
  }

  protected onImageColumnFocused(index: number): void {
    if (this.pendingImageColumnFocus() === index) {
      this.pendingImageColumnFocus.set(null);
    }
    this.focused.emit();
  }

  protected isImageColumnFocused(index: number): boolean {
    return this.focusColumn() === index || this.pendingImageColumnFocus() === index;
  }

  protected onItemInput(event: Event, index: number): void {
    const items = [...this.block().items];
    items[index] = (event.target as HTMLInputElement).value;
    this.changed.emit({ items });
  }

  protected onItemKeydown(event: KeyboardEvent, index: number): void {
    if (event.isComposing) return;

    if (event.key === 'Enter') {
      event.preventDefault();
      this.addItem(index);
      return;
    }

    if (event.key === 'Backspace' && this.block().items[index] === '') {
      event.preventDefault();
      if (this.block().items.length === 1) {
        this.removed.emit();
        return;
      }
      this.removeItem(index);
    }
  }

  protected addItem(afterIndex: number): void {
    const items = [...this.block().items];
    items.splice(afterIndex + 1, 0, '');
    this.changed.emit({ items });
    this.pendingItemFocus.set(afterIndex + 1);
  }

  protected removeItem(index: number): void {
    const items = [...this.block().items];
    items.splice(index, 1);
    if (items.length === 0) {
      items.push('');
    }
    this.changed.emit({ items });
    this.pendingItemFocus.set(Math.max(0, index - 1));
  }

  protected toggleOrdered(): void {
    this.changed.emit({ ordered: !this.block().ordered });
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
