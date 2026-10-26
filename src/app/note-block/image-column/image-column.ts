import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  effect,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { imageFileToDataUrl } from '../../image';
import { ImageColumnPatch, ImageColumnType, VisibleImageColumn } from '../../models';
import { Autosize } from '../../ui/autosize';
import { Focus } from '../../ui/focus';
import { Icon } from '../../ui/icon';

@Component({
  selector: 'app-image-column',
  imports: [Autosize, Focus, Icon],
  templateUrl: './image-column.html',
  styleUrl: './image-column.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'image-column-host',
    '[attr.data-image-column]': 'index()',
  },
})
export class ImageColumn {
  readonly column = input.required<VisibleImageColumn>();
  readonly index = input.required<number>();
  readonly fill = input(false);
  readonly focusOnInit = input(false);

  readonly changed = output<ImageColumnPatch>();
  readonly focused = output<void>();

  protected readonly imageError = signal<string | null>(null);
  protected readonly imageFailed = signal(false);
  protected readonly dragOver = signal(false);

  private readonly filePicker = viewChild<ElementRef<HTMLInputElement>>('filePicker');

  constructor() {
    effect(() => {
      // Reset failed/error states whenever the source is replaced.
      this.column().src;
      this.imageFailed.set(false);
      this.imageError.set(null);
    });
  }

  protected onText(event: Event): void {
    this.changed.emit({ text: (event.target as HTMLTextAreaElement).value });
  }

  protected onCaption(event: Event): void {
    this.changed.emit({ caption: (event.target as HTMLInputElement).value });
  }

  protected setType(type: ImageColumnType): void {
    if (this.column().type === type) return;
    this.changed.emit({ type });
  }

  protected onFileInput(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    void this.importImage(file);
  }

  protected onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(true);
  }

  protected onDragLeave(): void {
    this.dragOver.set(false);
  }

  protected onDrop(event: DragEvent): void {
    event.preventDefault();
    this.dragOver.set(false);
    void this.importImage(event.dataTransfer?.files?.[0] ?? null);
  }

  protected onUrlKeydown(event: KeyboardEvent): void {
    if (event.key !== 'Enter') return;

    const input = event.target as HTMLInputElement;
    const url = input.value.trim();
    if (!url) return;

    event.preventDefault();
    this.imageError.set(null);
    this.imageFailed.set(false);
    this.changed.emit({ src: url });
    input.value = '';
  }

  protected onImageError(): void {
    this.imageFailed.set(true);
  }

  protected clearImage(): void {
    this.imageFailed.set(false);
    this.changed.emit({ src: '', caption: '' });
  }

  protected browse(): void {
    this.filePicker()?.nativeElement.click();
  }

  private async importImage(file: File | null): Promise<void> {
    if (!file) return;

    this.imageError.set(null);
    try {
      const src = await imageFileToDataUrl(file);
      this.imageFailed.set(false);
      this.changed.emit({ src });
    } catch (error) {
      this.imageError.set(error instanceof Error ? error.message : 'Could not read that image.');
    }
  }
}
