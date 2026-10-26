import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { stripInlineMarkdown } from '../markdown';
import { MAX_HEADING_LEVEL, Note } from '../models';
import { Icon } from '../ui/icon';

interface OutlineEntry {
  id: string;
  text: string;
  level: number;
}

@Component({
  selector: 'app-note-outline',
  imports: [Icon],
  templateUrl: './note-outline.html',
  styleUrl: './note-outline.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class NoteOutline {
  readonly note = input.required<Note>();
  readonly selected = output<string>();
  readonly collapse = output<void>();

  protected readonly headings = computed<OutlineEntry[]>(() =>
    this.note()
      .blocks.filter((block) => block.type === 'heading')
      .map((block) => ({
        id: block.id,
        text: stripInlineMarkdown(block.text).trim(),
        level: Math.min(Math.max(block.level, 1), MAX_HEADING_LEVEL),
      }))
      .filter((heading) => heading.text.length > 0),
  );

  protected indent(level: number): number {
    return (level - 1) * 12;
  }
}
