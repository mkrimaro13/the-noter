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
import { AssetStore } from '../assets';
import { blockCountLabel, relativeTime, resolveTimeFunctions, wordCount } from '../format';
import { imageFileToDataUrl, loadImage } from '../image';
import { FenceShortcut, MarkdownBlockShortcut } from '../markdown';
import {
  BLOCK_MENU,
  BlockPatch,
  BlockType,
  CoverLayout,
  CoverPosition,
  ImageColumnPatch,
  NOTE_META_TYPES,
  Note,
  NoteBlock,
  NoteMeta,
  NoteMetaType,
  createBlock,
  isImageIcon,
  visibleImageColumnText,
  visibleTextColumns,
} from '../models';
import { NoteStore } from '../note-store';
import { SubnoteBlock } from '../subnote-block/subnote-block';
import { AssetSrc } from '../ui/asset-src';
import { Focus } from '../ui/focus';
import { Icon } from '../ui/icon';
import { NoteBlock as NoteBlockEditor } from '../note-block/note-block';

const ICON_IMAGE_ERROR =
  "We couldn't load that image. Please check the link or choose another image.";
const ICON_FILE_ERROR = "We couldn't use that file. Please choose another image.";
const COVER_IMAGE_ERROR =
  "We couldn't load that cover. Please check the link or choose another image.";
const RECENT_ICONS_KEY = 'the-noter.ui.recent-icons.v1';

type IconCategory = 'Work' | 'Life' | 'Ideas' | 'Media';

interface NoteIconChoice {
  icon: string;
  name: string;
  keywords: string;
  category: IconCategory;
}

const NOTE_ICONS: readonly NoteIconChoice[] = [
  { icon: '📝', name: 'note', keywords: 'write memo draft', category: 'Work' },
  { icon: '📚', name: 'books', keywords: 'read library study', category: 'Work' },
  { icon: '🗂️', name: 'files', keywords: 'folder archive organize', category: 'Work' },
  { icon: '📁', name: 'folder', keywords: 'directory project', category: 'Work' },
  { icon: '📌', name: 'pin', keywords: 'important keep', category: 'Work' },
  { icon: '📎', name: 'clip', keywords: 'attach paper', category: 'Work' },
  { icon: '✅', name: 'check', keywords: 'done task complete', category: 'Work' },
  { icon: '📊', name: 'chart', keywords: 'data analytics report', category: 'Work' },
  { icon: '💼', name: 'briefcase', keywords: 'job business office', category: 'Work' },
  { icon: '🧾', name: 'receipt', keywords: 'invoice money expense', category: 'Work' },
  { icon: '🗓️', name: 'calendar', keywords: 'date schedule plan', category: 'Work' },
  { icon: '⏰', name: 'clock', keywords: 'time alarm deadline', category: 'Work' },
  { icon: '☕', name: 'coffee', keywords: 'drink break morning', category: 'Life' },
  { icon: '🏠', name: 'home', keywords: 'house family', category: 'Life' },
  { icon: '🛒', name: 'cart', keywords: 'shop grocery buy', category: 'Life' },
  { icon: '🍳', name: 'cooking', keywords: 'food recipe kitchen', category: 'Life' },
  { icon: '🏃', name: 'exercise', keywords: 'run sport fitness', category: 'Life' },
  { icon: '🛌', name: 'rest', keywords: 'sleep bed relax', category: 'Life' },
  { icon: '❤️', name: 'heart', keywords: 'love favorite health', category: 'Life' },
  { icon: '🌱', name: 'plant', keywords: 'grow garden nature', category: 'Life' },
  { icon: '🐾', name: 'pet', keywords: 'animal paw dog cat', category: 'Life' },
  { icon: '🎁', name: 'gift', keywords: 'present birthday', category: 'Life' },
  { icon: '💊', name: 'health', keywords: 'medicine pill doctor', category: 'Life' },
  { icon: '✈️', name: 'travel', keywords: 'plane trip flight', category: 'Life' },
  { icon: '💡', name: 'idea', keywords: 'light bulb inspiration', category: 'Ideas' },
  { icon: '🎯', name: 'target', keywords: 'goal focus aim', category: 'Ideas' },
  { icon: '🧭', name: 'compass', keywords: 'direction explore', category: 'Ideas' },
  { icon: '🧪', name: 'experiment', keywords: 'science lab test', category: 'Ideas' },
  { icon: '🧠', name: 'brain', keywords: 'think mind smart', category: 'Ideas' },
  { icon: '✨', name: 'sparkles', keywords: 'magic new bright', category: 'Ideas' },
  { icon: '🔖', name: 'bookmark', keywords: 'save read later', category: 'Ideas' },
  { icon: '🎨', name: 'art', keywords: 'paint design creative', category: 'Ideas' },
  { icon: '🧩', name: 'puzzle', keywords: 'solve piece logic', category: 'Ideas' },
  { icon: '🔥', name: 'fire', keywords: 'hot urgent energy', category: 'Ideas' },
  { icon: '⭐', name: 'star', keywords: 'favorite important', category: 'Ideas' },
  { icon: '🚀', name: 'rocket', keywords: 'launch start fast', category: 'Ideas' },
  { icon: '🎵', name: 'music', keywords: 'song audio listen', category: 'Media' },
  { icon: '🎬', name: 'film', keywords: 'movie video cinema', category: 'Media' },
  { icon: '📷', name: 'camera', keywords: 'photo picture', category: 'Media' },
  { icon: '🎮', name: 'game', keywords: 'play controller fun', category: 'Media' },
  { icon: '📖', name: 'reading', keywords: 'book open story', category: 'Media' },
  { icon: '🎧', name: 'headphones', keywords: 'audio podcast music', category: 'Media' },
  { icon: '🖥️', name: 'screen', keywords: 'computer desktop work', category: 'Media' },
  { icon: '📱', name: 'phone', keywords: 'mobile app device', category: 'Media' },
  { icon: '🌙', name: 'night', keywords: 'moon dark sleep', category: 'Media' },
  { icon: '☀️', name: 'sun', keywords: 'day light morning', category: 'Media' },
];

@Component({
  selector: 'app-note-editor',
  imports: [NoteBlockEditor, SubnoteBlock, Icon, Focus, CdkDropList, AssetSrc],
  templateUrl: './note-editor.html',
  styleUrl: './note-editor.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '(document:keydown.escape)': 'closePopovers()',
    '(document:paste)': 'onPaste($event)',
  },
})
export class NoteEditor {
  readonly note = input.required<Note>();

  protected readonly store = inject(NoteStore);
  private readonly assets = inject(AssetStore);
  protected readonly blockMenu = BLOCK_MENU;
  protected readonly menuOpen = signal(false);
  protected readonly iconMenuOpen = signal(false);
  protected readonly focusMetaId = signal<string | null>(null);
  protected readonly focusBlockId = signal<string | null>(null);
  protected readonly focusImageColumn = signal<{ blockId: string; index: number } | null>(null);
  protected readonly pasteError = signal<string | null>(null);
  protected readonly coverError = signal<string | null>(null);
  protected readonly coverAdjusting = signal(false);
  protected readonly coverDragPosition = signal<CoverPosition | null>(null);
  protected readonly coverUrlOpen = signal(false);
  protected readonly iconError = signal<string | null>(null);
  protected readonly iconQuery = signal('');
  protected readonly iconCategory = signal<string>('All');
  protected readonly recentIcons = signal<string[]>(loadRecentIcons());
  protected readonly isImageIcon = isImageIcon;

  protected readonly ancestors = computed(() => this.store.parentChain(this.note()));
  protected readonly subNotes = computed(() => this.store.childNotes(this.note().id));
  protected readonly coverObjectPosition = computed(() => {
    const position = this.coverDragPosition() ?? this.note().coverPosition;
    return `${position.x}% ${position.y}%`;
  });

  protected readonly iconCategories = computed(() => [
    'All',
    ...new Set(NOTE_ICONS.map((choice) => choice.category)),
  ]);
  protected readonly filteredIcons = computed(() => {
    const query = this.iconQuery().trim().toLowerCase();
    const category = this.iconCategory();
    return NOTE_ICONS.filter(
      (choice) =>
        (category === 'All' || choice.category === category) &&
        (query.length === 0 || `${choice.name} ${choice.keywords}`.toLowerCase().includes(query)),
    );
  });
  protected readonly recentChoices = computed(() => {
    const byIcon = new Map(NOTE_ICONS.map((choice) => [choice.icon, choice]));
    return this.recentIcons()
      .map((icon) => byIcon.get(icon))
      .filter((choice): choice is NoteIconChoice => choice !== undefined);
  });

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly addButton = viewChild<ElementRef<HTMLButtonElement>>('addButton');
  private readonly coverPicker = viewChild<ElementRef<HTMLInputElement>>('coverPicker');
  private readonly coverUrlInput = viewChild<ElementRef<HTMLInputElement>>('coverUrlInput');
  private readonly iconPicker = viewChild<ElementRef<HTMLInputElement>>('iconPicker');
  private readonly iconInput = viewChild<ElementRef<HTMLInputElement>>('iconInput');
  private readonly iconUrlInput = viewChild<ElementRef<HTMLInputElement>>('iconUrlInput');
  private pasteErrorTimer: ReturnType<typeof setTimeout> | undefined;
  private coverDrag: {
    pointerId: number;
    startX: number;
    startY: number;
    startPosition: CoverPosition;
    overflowX: number;
    overflowY: number;
  } | null = null;

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
      this.iconMenuOpen.set(false);
      this.focusMetaId.set(null);
      this.focusBlockId.set(null);
      this.focusImageColumn.set(null);
      this.coverError.set(null);
      this.coverAdjusting.set(false);
      this.coverUrlOpen.set(false);
      this.coverDrag = null;
      this.coverDragPosition.set(null);
      this.iconError.set(null);
      this.iconQuery.set('');
      this.iconCategory.set('All');
    });
  }

  protected relative(timestamp: number): string {
    return relativeTime(timestamp);
  }

  protected displayTitle(note: Note): string {
    return note.title.trim() || 'Untitled';
  }

  protected noteSubtitle(note: Note): string {
    const blocks = note.blocks.length === 0 ? 'Empty' : blockCountLabel(note.blocks.length);
    return `${blocks} · ${relativeTime(note.updatedAt)}`;
  }

  protected openNote(note: Note): void {
    this.store.select(note.id);
  }

  protected addChildNote(): void {
    this.store.createChildNote(this.note().id);
  }

  protected browseCover(): void {
    this.coverPicker()?.nativeElement.click();
  }

  protected onCoverFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    void this.importCover(file);
  }

  protected onCoverDragOver(event: DragEvent): void {
    event.preventDefault();
  }

  protected onCoverDrop(event: DragEvent): void {
    event.preventDefault();
    void this.importCover(event.dataTransfer?.files?.[0] ?? null);
  }

  protected removeCover(): void {
    this.coverError.set(null);
    this.coverUrlOpen.set(false);
    this.store.setCover(this.note().id, '');
  }

  protected toggleCoverUrl(): void {
    const open = !this.coverUrlOpen();
    this.coverUrlOpen.set(open);
    this.coverError.set(null);
    if (open) setTimeout(() => this.coverUrlInput()?.nativeElement.focus());
  }

  protected applyCoverUrl(): void {
    const input = this.coverUrlInput()?.nativeElement;
    const value = input?.value.trim() ?? '';
    if (!value) {
      this.coverError.set(COVER_IMAGE_ERROR);
      input?.focus();
      return;
    }
    void this.importCoverUrl(value);
  }

  protected chooseCoverLayout(layout: CoverLayout): void {
    this.store.setCoverLayout(this.note().id, layout);
  }

  protected toggleCoverAdjust(): void {
    const adjusting = !this.coverAdjusting();
    this.coverAdjusting.set(adjusting);
    if (!adjusting) {
      this.coverDrag = null;
      this.coverDragPosition.set(null);
    }
  }

  /** Starts panning the cover; the image follows the pointer while adjusting. */
  protected startCoverDrag(event: PointerEvent): void {
    if (!this.coverAdjusting() || event.button !== 0) return;
    if (!(event.currentTarget instanceof HTMLImageElement)) return;

    const image = event.currentTarget;
    const rect = image.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;

    const naturalWidth = image.naturalWidth || rect.width;
    const naturalHeight = image.naturalHeight || rect.height;
    const scale = Math.max(rect.width / naturalWidth, rect.height / naturalHeight);

    this.coverDrag = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      startPosition: { ...this.note().coverPosition },
      overflowX: Math.max(0, naturalWidth * scale - rect.width),
      overflowY: Math.max(0, naturalHeight * scale - rect.height),
    };
    this.coverDragPosition.set({ ...this.note().coverPosition });
    image.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  }

  protected moveCover(event: PointerEvent): void {
    const drag = this.coverDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    this.coverDragPosition.set({
      x:
        drag.overflowX > 0.5
          ? clampPercent(drag.startPosition.x - (dx / drag.overflowX) * 100)
          : drag.startPosition.x,
      y:
        drag.overflowY > 0.5
          ? clampPercent(drag.startPosition.y - (dy / drag.overflowY) * 100)
          : drag.startPosition.y,
    });
    event.preventDefault();
  }

  protected endCoverDrag(event: PointerEvent): void {
    const drag = this.coverDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const position = this.coverDragPosition();
    this.coverDrag = null;
    this.coverDragPosition.set(null);

    const current = this.note().coverPosition;
    if (position && (position.x !== current.x || position.y !== current.y)) {
      this.store.setCoverPosition(this.note().id, position.x, position.y);
    }
  }

  protected cancelCoverDrag(event: PointerEvent): void {
    if (this.coverDrag?.pointerId !== event.pointerId) return;
    this.coverDrag = null;
    this.coverDragPosition.set(null);
  }

  protected toggleIconMenu(): void {
    const open = !this.iconMenuOpen();
    this.iconMenuOpen.set(open);
    this.iconError.set(null);
    if (open) {
      this.iconQuery.set('');
      setTimeout(() => this.iconInput()?.nativeElement.focus());
    }
  }

  protected closeIconMenu(): void {
    this.iconMenuOpen.set(false);
  }

  protected onIconQuery(event: Event): void {
    this.iconQuery.set((event.target as HTMLInputElement).value);
  }

  protected setIconCategory(category: string): void {
    this.iconCategory.set(category);
  }

  protected chooseIcon(icon: string): void {
    this.store.setIcon(this.note().id, icon);
    if (!isImageIcon(icon)) this.rememberIcon(icon);
    this.iconError.set(null);
    this.iconMenuOpen.set(false);
  }

  private rememberIcon(icon: string): void {
    const next = [icon, ...this.recentIcons().filter((item) => item !== icon)].slice(0, 8);
    this.recentIcons.set(next);
    try {
      localStorage.setItem(RECENT_ICONS_KEY, JSON.stringify(next));
    } catch {
      // Recents are a convenience; the picker still works without storage.
    }
  }

  protected applyCustomIcon(): void {
    const value = this.iconInput()?.nativeElement.value.trim() ?? '';
    if (!value) return;
    this.chooseIcon(value);
  }

  protected browseIconImage(): void {
    this.iconError.set(null);
    this.iconPicker()?.nativeElement.click();
  }

  protected onIconFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    void this.importIconFile(file);
  }

  protected applyIconUrl(): void {
    const input = this.iconUrlInput()?.nativeElement;
    const value = input?.value.trim() ?? '';
    if (!value) {
      this.iconError.set(ICON_IMAGE_ERROR);
      input?.focus();
      return;
    }
    void this.importIconUrl(value);
  }

  protected removeIcon(): void {
    this.store.setIcon(this.note().id, '');
    this.iconError.set(null);
    this.iconMenuOpen.set(false);
  }

  private async importIconFile(file: File | null): Promise<void> {
    if (!file) return;

    this.iconError.set(null);
    if (!file.type.startsWith('image/')) {
      this.iconError.set(ICON_FILE_ERROR);
      return;
    }

    try {
      const dataUrl = await imageFileToDataUrl(file, 256);
      await loadImage(dataUrl);
      this.chooseIcon(await this.assets.prepare(dataUrl));
    } catch {
      this.iconError.set(ICON_FILE_ERROR);
    }
  }

  private async importIconUrl(value: string): Promise<void> {
    this.iconError.set(null);
    const source = imageSourceFrom(value);
    if (!source) {
      this.iconError.set(ICON_IMAGE_ERROR);
      return;
    }

    try {
      await loadImage(source);
      this.chooseIcon(await this.assets.prepare(source));
    } catch {
      this.iconError.set(ICON_IMAGE_ERROR);
    }
  }

  private async importCover(file: File | null): Promise<void> {
    if (!file) return;

    this.coverError.set(null);
    try {
      const dataUrl = await imageFileToDataUrl(file, 2000);
      this.store.setCover(this.note().id, await this.assets.prepare(dataUrl));
    } catch (error) {
      this.coverError.set(error instanceof Error ? error.message : 'Could not read that image.');
    }
  }

  private async importCoverUrl(value: string): Promise<void> {
    this.coverError.set(null);
    const source = imageSourceFrom(value);
    if (!source) {
      this.coverError.set(COVER_IMAGE_ERROR);
      return;
    }

    try {
      await loadImage(source);
      this.store.setCover(this.note().id, await this.assets.prepare(source));
      this.coverUrlOpen.set(false);
    } catch {
      this.coverError.set(COVER_IMAGE_ERROR);
    }
  }

  protected onTitleInput(event: Event): void {
    this.store.setTitle(this.note().id, (event.target as HTMLInputElement).value);
  }

  protected addMeta(): void {
    this.focusMetaId.set(this.store.addMeta(this.note().id));
  }

  protected readonly metaTypes = NOTE_META_TYPES;

  protected updateMetaKey(metaId: string, event: Event): void {
    this.store.updateMeta(this.note().id, metaId, {
      key: (event.target as HTMLInputElement).value,
    });
  }

  protected updateMetaValue(metaId: string, event: Event): void {
    this.store.updateMeta(this.note().id, metaId, {
      value: (event.target as HTMLInputElement | HTMLSelectElement).value,
    });
  }

  protected updateMetaChecked(metaId: string, event: Event): void {
    this.store.updateMeta(this.note().id, metaId, {
      value: (event.target as HTMLInputElement).checked ? 'true' : 'false',
    });
  }

  protected changeMetaType(metaId: string, event: Event): void {
    this.store.setMetaType(
      this.note().id,
      metaId,
      (event.target as HTMLSelectElement).value as NoteMetaType,
    );
  }

  protected updateMetaOptions(metaId: string, event: Event): void {
    this.store.updateMetaOptions(this.note().id, metaId, (event.target as HTMLInputElement).value);
  }

  protected metaInputType(type: NoteMetaType): string {
    switch (type) {
      case 'number':
      case 'date':
      case 'url':
        return type;
      default:
        return 'text';
    }
  }

  protected metaTypeLabel(type: NoteMetaType): string {
    switch (type) {
      case 'number':
        return 'Number';
      case 'date':
        return 'Date';
      case 'url':
        return 'URL';
      case 'select':
        return 'Select';
      case 'checkbox':
        return 'Checkbox';
      default:
        return 'Text';
    }
  }

  protected metaOptions(meta: NoteMeta): string {
    return meta.options.join(', ');
  }

  /** Time helpers are expanded when the field is committed, not while typing. */
  protected commitMetaValue(metaId: string, type: NoteMetaType, event: Event): void {
    if (type !== 'text' && type !== 'url') return;

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
    if (type === 'subnote') {
      this.store.convertBlockToSubnote(this.note().id, blockId);
    } else {
      this.store.setBlockType(this.note().id, blockId, type);
    }
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

  protected onHeadingSplit(blockId: string, split: { before: string; after: string }): void {
    const block = this.store.splitHeadingBlock(this.note().id, blockId, split);
    if (block) {
      this.focusBlockId.set(block.id);
    }
  }

  protected onFence(blockId: string, fence: FenceShortcut): void {
    this.store.convertTextBlockToCode(this.note().id, blockId, fence);
    this.focusBlockId.set(blockId);
  }

  protected onMarkdownShortcut(blockId: string, shortcut: MarkdownBlockShortcut): void {
    this.store.applyBlockShortcut(this.note().id, blockId, shortcut);
    this.focusBlockId.set(blockId);
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
        sources.push(await this.assets.prepare(await imageFileToDataUrl(file)));
      } catch (error) {
        this.showPasteError(error instanceof Error ? error.message : 'Could not paste that image.');
      }
    }

    if (sources.length === 0) return;

    const blockTarget = this.blockFromTarget(target);
    const targetBlock = blockTarget?.block ?? null;
    const noteId = blockTarget?.noteId ?? this.noteContextFromTarget(target) ?? this.note().id;
    const columnIndex = this.imageColumnAt(target);

    // Pasting into an existing image column replaces only that column's image
    // instead of appending another block. Extra images from the clipboard
    // follow the block.
    if (targetBlock?.type === 'image') {
      const [src, ...rest] = sources;
      const index = columnIndex ?? 0;

      if (index === 0) {
        const shouldFocus = targetBlock.src === '' || targetBlock.mainColumnType !== 'image';
        this.store.updateBlock(noteId, targetBlock.id, {
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

        this.store.updateImageColumn(noteId, targetBlock.id, index - 1, {
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
          noteId,
          targetBlock.id,
          rest.map((image) => createBlock('image', { src: image })),
        );
      }
      return;
    }

    this.store.insertBlocks(
      noteId,
      targetBlock?.id ?? null,
      sources.map((src) => createBlock('image', { src })),
    );
  }

  private showPasteError(message: string): void {
    clearTimeout(this.pasteErrorTimer);
    this.pasteError.set(message);
    this.pasteErrorTimer = setTimeout(() => this.pasteError.set(null), 6000);
  }

  private blockFromTarget(target: Node): { noteId: string; block: NoteBlock } | null {
    const element = target instanceof Element ? target : target.parentElement;
    const blockId = element?.closest('app-note-block')?.getAttribute('data-block-id');
    if (!blockId) return null;

    for (const note of this.store.notes()) {
      const block = note.blocks.find((item) => item.id === blockId);
      if (block) return { noteId: note.id, block };
    }

    return null;
  }

  /** The note whose inline sub-note contains the target, if any. */
  private noteContextFromTarget(target: Node): string | null {
    const element = target instanceof Element ? target : target.parentElement;
    const subnote = element?.closest<HTMLElement>('app-subnote-block[data-note-id]');
    return subnote?.getAttribute('data-note-id') || null;
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
    if (type === 'subnote') {
      const block = this.store.addSubnoteBlock(this.note().id);
      if (block) {
        this.focusBlockId.set(block.id);
      }
      this.menuOpen.set(false);
      return;
    }

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

  protected closePopovers(): void {
    this.iconMenuOpen.set(false);
    this.coverUrlOpen.set(false);
    this.closeMenu();
  }
}

/**
 * Accepts `data:image/…` sources and normal http(s) links (including
 * protocol-relative links) while rejecting anything the browser cannot render.
 */
function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, value));
}

function imageSourceFrom(value: string): string | null {
  if (/^data:image\//i.test(value)) return value;

  const withProtocol = value.startsWith('//') ? `https:${value}` : value;
  try {
    const url = new URL(withProtocol);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

function loadRecentIcons(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_ICONS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((icon): icon is string => typeof icon === 'string').slice(0, 8)
      : [];
  } catch {
    return [];
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
