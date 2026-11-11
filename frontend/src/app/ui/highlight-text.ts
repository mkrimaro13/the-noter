import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { HighlightSegment, splitHighlights } from '../search';

/**
 * Paints `text` with case-insensitive matches of `query` wrapped in marks, so
 * the sidebar, editor, and palette can show why a note matched a search.
 */
@Component({
  selector: 'app-highlight-text',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (segment of segments(); track $index) {
      @if (segment.hit) {
        <mark class="hit">{{ segment.text }}</mark>
      } @else {
        <span>{{ segment.text }}</span>
      }
    }
  `,
  styles: `
    :host {
      display: inline;
    }

    mark.hit {
      padding: 0 0.1em;
      border-radius: 3px;
      background: color-mix(in srgb, var(--accent) 22%, transparent);
      color: var(--ink);
    }
  `,
})
export class HighlightText {
  readonly text = input.required<string>();
  readonly query = input('');

  protected readonly segments = computed<HighlightSegment[]>(() =>
    splitHighlights(this.text(), this.query()),
  );
}
