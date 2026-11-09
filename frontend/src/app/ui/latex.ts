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
import type { TrustContext } from 'katex';
import { normalizeLatex, stripMathDelimiters } from '../latex';

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

const COMMON_MACROS = {
  '\\RR': '\\mathbb{R}',
  '\\NN': '\\mathbb{N}',
  '\\ZZ': '\\mathbb{Z}',
  '\\QQ': '\\mathbb{Q}',
  '\\CC': '\\mathbb{C}',
  '\\PP': '\\mathbb{P}',
  '\\EE': '\\mathbb{E}',
  '\\dd': '\\mathrm{d}',
  '\\dx': '\\mathrm{d}x',
  '\\dy': '\\mathrm{d}y',
  '\\dz': '\\mathrm{d}z',
  '\\dt': '\\mathrm{d}t',
  '\\celsius': '^\\circ\\mathrm{C}',
  '\\degree': '^\\circ',
  '\\angstrom': '\\text{\\AA}',
};

const SAFE_LINK_PROTOCOLS = new Set(['http', 'https', 'mailto', '_relative']);

/**
 * Math notes are synced from CouchDB, so the renderer must not create
 * executable links. `\href`/`\url` are useful; HTML extensions and embedded
 * images are not worth the risk.
 */
function isTrustedMathCommand(context: TrustContext): boolean {
  if (context.command !== '\\href' && context.command !== '\\url') return false;
  return context.protocol !== undefined && SAFE_LINK_PROTOCOLS.has(context.protocol);
}

export function renderMath(source: string, displayMode = true): Promise<string> {
  const normalized = normalizeLatex(source);
  return loadKatex().then((module) => {
    const katex = module.default;
    return katex.renderToString(normalized, {
      displayMode,
      throwOnError: false,
      strict: 'ignore',
      trust: isTrustedMathCommand,
      macros: COMMON_MACROS,
      fleqn: false,
      leqno: false,
      output: 'htmlAndMathml',
    });
  });
}

/**
 * Renders LaTeX source. Display math is the default (function blocks); inline
 * math sets `display` to false and is laid out inside a line of writing.
 */
@Component({
  selector: 'app-latex',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.display]': 'display()',
  },
  template: `<span class="latex" [class.inline]="!display()" [innerHTML]="html()"></span>`,
  styles: `
    :host {
      display: inline;
      min-width: 0;
    }

    :host(.display) {
      display: block;
    }

    .latex {
      color: var(--ink);
      font-size: 15px;
      line-height: 1.5;
    }

    .latex.inline {
      display: inline-block;
      vertical-align: baseline;
      max-width: 100%;
      overflow-x: auto;
      overflow-y: hidden;
    }

    .latex.display {
      display: block;
      overflow-x: auto;
      overflow-y: hidden;
      padding: 3px 0 2px;
      text-align: center;
    }

    .latex:empty {
      display: none;
    }
  `,
})
export class Latex {
  readonly text = input.required<string>();
  readonly display = input(true);

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
      const displayMode = this.display();
      const token = ++this.renderToken;

      if (!source) {
        this.htmlSource.set('');
        return;
      }

      void renderMath(source, displayMode)
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
