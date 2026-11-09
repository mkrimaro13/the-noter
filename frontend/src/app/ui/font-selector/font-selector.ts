import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { TypographyService, type WritingFont } from '../../typography';

@Component({
  selector: 'app-font-selector',
  templateUrl: './font-selector.html',
  styleUrl: './font-selector.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.compact]': 'compact()',
  },
})
export class FontSelector {
  /** Compact mode stacks the options in the narrow collapsed outline rail. */
  readonly compact = input(false);

  protected readonly typography = inject(TypographyService);

  protected select(font: WritingFont): void {
    this.typography.setWritingFont(font);
  }
}
