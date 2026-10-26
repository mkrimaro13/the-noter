import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { stripMathDelimiters } from '../latex';

/**
 * KaTeX is a sizeable dependency, so it is loaded the first time a math block
 * actually asks for a preview. The rest of the editor keeps working while the
 * chunk arrives.
 */
let katexModule: Promise<typeof import('katex')> | null = null;

function loadKatex(): Promise<typeof import('katex')> {
  katexModule ??= import('katex');
  return katexModule;
}

function renderMath(source: string): Promise<string> {
  return loadKatex().then((module) =>
    module.default.renderToString(source, {
      displayMode: true,
      throwOnError: false,
      strict: 'ignore',
      trust: false,
    }),
  );
}

/** Renders a function block's LaTeX source. The block keeps the raw text. */
@Component({
  selector: 'app-latex',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div class="latex" [innerHTML]="html()"></div>`,
  styles: `
    :host {
      display: block;
      min-width: 0;
    }

    .latex {
      overflow-x: auto;
      overflow-y: hidden;
      padding: 3px 0 2px;
      color: var(--ink);
      font-size: 15px;
      line-height: 1.5;
      text-align: center;
    }

    .latex:empty {
      display: none;
    }
  `,
})
export class Latex {
  readonly text = input.required<string>();

  private readonly sanitizer = inject(DomSanitizer);
  private readonly htmlSource = signal('');
  protected readonly html = computed<SafeHtml>(() =>
    this.sanitizer.bypassSecurityTrustHtml(this.htmlSource()),
  );

  /** Prevents an older async render from replacing a newer one. */
  private renderToken = 0;

  constructor() {
    effect(() => {
      const source = stripMathDelimiters(this.text());
      const token = ++this.renderToken;

      if (!source) {
        this.htmlSource.set('');
        return;
      }

      void renderMath(source)
        .then((rendered) => {
          if (token === this.renderToken) {
            this.htmlSource.set(rendered);
          }
        })
        .catch(() => {
          if (token === this.renderToken) {
            this.htmlSource.set('');
          }
        });
    });
  }
}
