import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { parseInline } from '../markdown';

/**
 * Renders the small inline Markdown subset next to an editor field. The raw
 * textarea stays in place for editing; this component only paints the preview.
 */
@Component({
  selector: 'app-markdown-inline',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (token of tokens(); track $index) {
      @switch (token.kind) {
        @case ('code') {
          <code class="md-code">{{ token.text }}</code>
        }
        @case ('link') {
          <a
            class="md-link"
            [href]="token.href"
            target="_blank"
            rel="noreferrer noopener"
            tabindex="-1"
            >{{ token.text }}</a
          >
        }
        @default {
          <span>{{ token.text }}</span>
        }
      }
    }
  `,
  styles: `
    :host {
      display: inline;
      white-space: inherit;
    }

    .md-code {
      padding: 0.05em 0.32em;
      border: 1px solid color-mix(in srgb, var(--accent) 16%, var(--line-soft));
      border-radius: 4px;
      background: var(--accent-soft);
      color: var(--ink);
      font-family: ui-monospace, 'SFMono-Regular', Menlo, Consolas, monospace;
      font-size: 0.86em;
      letter-spacing: 0;
      white-space: pre-wrap;
    }

    .md-link {
      color: var(--accent);
      text-decoration: underline;
      text-decoration-thickness: 1px;
      text-underline-offset: 2px;
      pointer-events: auto;
    }

    .md-link:hover {
      color: var(--ink);
    }
  `,
})
export class MarkdownInline {
  readonly text = input.required<string>();
  protected readonly tokens = computed(() => parseInline(this.text()));
}
