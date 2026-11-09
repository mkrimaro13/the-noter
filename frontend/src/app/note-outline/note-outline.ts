import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
} from '@angular/core';
import { stripInlineMarkdown } from '../markdown';
import { MAX_HEADING_LEVEL, Note } from '../models';
import { FontSelector } from '../ui/font-selector/font-selector';
import { Icon } from '../ui/icon';

/** Space above a heading before it is considered the section being read. */
const ACTIVE_OFFSET = 96;

interface OutlineEntry {
  id: string;
  text: string;
  level: number;
}

@Component({
  selector: 'app-note-outline',
  imports: [FontSelector, Icon],
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

  /** The heading currently at the top of the reading area. */
  protected readonly activeId = signal<string | null>(null);

  constructor() {
    effect((onCleanup) => {
      const headings = this.headings();
      if (typeof document === 'undefined') return;

      const container = document.querySelector<HTMLElement>('.main-scroll');
      if (!container) return;

      const update = () => this.updateActive(container, headings);
      update();
      container.addEventListener('scroll', update, { passive: true });
      window.addEventListener('resize', update);

      onCleanup(() => {
        container.removeEventListener('scroll', update);
        window.removeEventListener('resize', update);
      });
    });
  }

  protected indent(level: number): number {
    return (level - 1) * 12;
  }

  private updateActive(container: HTMLElement, headings: OutlineEntry[]): void {
    if (headings.length === 0) {
      this.activeId.set(null);
      return;
    }

    const blocks = Array.from(container.querySelectorAll<HTMLElement>('app-note-block'));
    const threshold = container.getBoundingClientRect().top + ACTIVE_OFFSET;
    let active = headings[0].id;

    for (const heading of headings) {
      const block = blocks.find((item) => item.getAttribute('data-block-id') === heading.id);
      const element = block?.querySelector<HTMLElement>('.heading-input');
      if (!element) continue;
      if (element.getBoundingClientRect().top <= threshold) {
        active = heading.id;
      } else {
        break;
      }
    }

    // At the very bottom the final heading may never reach the top offset.
    if (container.scrollTop + container.clientHeight >= container.scrollHeight - 2) {
      active = headings[headings.length - 1].id;
    }

    this.activeId.set(active);
  }
}
