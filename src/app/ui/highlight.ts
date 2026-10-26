import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import c from 'highlight.js/lib/languages/c';
import cpp from 'highlight.js/lib/languages/cpp';
import csharp from 'highlight.js/lib/languages/csharp';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import dockerfile from 'highlight.js/lib/languages/dockerfile';
import go from 'highlight.js/lib/languages/go';
import ini from 'highlight.js/lib/languages/ini';
import java from 'highlight.js/lib/languages/java';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import kotlin from 'highlight.js/lib/languages/kotlin';
import markdown from 'highlight.js/lib/languages/markdown';
import php from 'highlight.js/lib/languages/php';
import python from 'highlight.js/lib/languages/python';
import ruby from 'highlight.js/lib/languages/ruby';
import rust from 'highlight.js/lib/languages/rust';
import scss from 'highlight.js/lib/languages/scss';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

/**
 * A focused set of languages keeps the bundle small. Aliases such as `ts`,
 * `js`, `html`, `sh`, `yml`, and `md` are registered by the modules themselves.
 */
const LANGUAGES = {
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  dockerfile,
  go,
  ini,
  java,
  javascript,
  json,
  kotlin,
  markdown,
  php,
  python,
  ruby,
  rust,
  scss,
  sql,
  typescript,
  xml,
  yaml,
};

for (const [name, language] of Object.entries(LANGUAGES)) {
  hljs.registerLanguage(name, language);
}

/** Used by auto-detection when a code block has no language label. */
const AUTO_LANGUAGES = Object.keys(LANGUAGES);

/** Labels that mean "no highlighting" rather than an unknown language. */
const PLAIN_LANGUAGES = new Set(['', 'text', 'txt', 'plain', 'plaintext', 'none', 'output']);

export function highlightCode(code: string, language: string): string {
  if (!code) return '';

  const label = language.trim().toLowerCase();
  if (PLAIN_LANGUAGES.has(label)) return escapeHtml(code);

  if (hljs.getLanguage(label)) {
    return hljs.highlight(code, { language: label, ignoreIllegals: true }).value;
  }

  return hljs.highlightAuto(code, AUTO_LANGUAGES).value;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

/**
 * Paints highlighted code behind a transparent textarea. highlight.js escapes
 * its input, so the generated HTML only contains markup and `hljs-*` classes.
 */
@Component({
  selector: 'app-code-highlight',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<code class="hljs" [innerHTML]="html()"></code>`,
  styles: `
    :host {
      display: block;
    }

    .hljs {
      display: block;
      padding: 0;
      background: transparent;
      color: inherit;
      font: inherit;
      white-space: inherit;
      overflow-wrap: inherit;
      word-break: inherit;
      tab-size: inherit;
    }
  `,
})
export class CodeHighlight {
  readonly code = input.required<string>();
  readonly language = input('');

  protected readonly html = computed(() => highlightCode(this.code(), this.language()));
}
