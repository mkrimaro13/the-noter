import { AssetStore } from './assets';
import { Note, NoteBlock, blockPlainText, visibleImageColumns, visibleTextColumns } from './models';
import { InlineMark, parseInline } from './markdown';

/** Resolves image sources (including `asset:` refs) for self-contained exports. */
export interface ExportContext {
  assets?: AssetStore;
}

/** Builds a Markdown document from a single note. */
export async function noteToMarkdown(note: Note, context: ExportContext = {}): Promise<string> {
  const parts: string[] = [`# ${note.title.trim() || 'Untitled note'}`];
  const meta = metaLines(note);
  if (meta.length > 0) parts.push(meta.join('\n'));

  for (const block of note.blocks) {
    const text = await blockToMarkdown(block, context);
    if (text.trim().length > 0) parts.push(text);
  }

  return `${parts.join('\n\n')}\n`;
}

/** Builds a standalone HTML document suitable for the browser and for print. */
export async function noteToHtml(note: Note, context: ExportContext = {}): Promise<string> {
  const title = note.title.trim() || 'Untitled note';
  const meta = metaLines(note);
  const body: string[] = [];

  if (meta.length > 0) {
    body.push(
      `<dl class="meta">${note.metadata
        .filter((item) => item.key.trim().length > 0)
        .map(
          (item) => `<div><dt>${escapeHtml(item.key)}</dt><dd>${escapeHtml(item.value)}</dd></div>`,
        )
        .join('')}</dl>`,
    );
  }

  for (const block of note.blocks) {
    const html = await blockToHtml(block, context);
    if (html.trim().length > 0) body.push(html);
  }

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light; }
  body {
    margin: 0 auto;
    max-width: 42rem;
    padding: 3rem 1.5rem;
    color: #1d1d1f;
    background: #fff;
    font: 16px/1.65 ui-serif, Georgia, 'Times New Roman', serif;
  }
  h1 { font-size: 2rem; line-height: 1.2; margin: 0 0 1rem; }
  h2, h3, h4, h5, h6 { line-height: 1.25; margin: 1.6rem 0 0.6rem; }
  p { margin: 0 0 1rem; }
  ul, ol { margin: 0 0 1rem; padding-left: 1.4rem; }
  li { margin: 0.2rem 0; }
  code { font: 0.9em ui-monospace, SFMono-Regular, Menlo, monospace; background: #f2f2f4; padding: 0.1em 0.3em; border-radius: 4px; }
  pre { overflow-x: auto; padding: 1rem; border-radius: 8px; background: #f6f6f8; }
  pre code { background: none; padding: 0; }
  img { max-width: 100%; height: auto; border-radius: 6px; }
  figure { margin: 0 0 1rem; }
  figcaption { color: #666; font-size: 0.85rem; margin-top: 0.3rem; }
  .meta { display: grid; gap: 0.35rem; margin: 0 0 1.5rem; padding: 0.8rem 1rem; background: #fafafa; border-radius: 8px; }
  .meta div { display: flex; gap: 0.6rem; }
  .meta dt { font-weight: 600; min-width: 7rem; }
  .meta dd { margin: 0; }
  .columns { display: grid; gap: 1rem; }
  .columns > div > p:last-child { margin-bottom: 0; }
  .math { font-family: ui-serif, Georgia, serif; font-style: italic; }
  .subnote { color: #666; font-style: italic; }
  @media print {
    body { padding: 0; max-width: none; }
    a { color: inherit; text-decoration: none; }
  }
</style>
</head>
<body>
<h1>${escapeHtml(title)}</h1>
${body.join('\n')}
</body>
</html>`;
}

/** Downloads text content with the given file name. */
export function downloadText(filename: string, text: string, mime = 'text/plain'): void {
  const blob = new Blob([text], { type: `${mime};charset=utf-8` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Opens a print dialog for the exported HTML. Browsers offer “Save as PDF”
 * there, which keeps the PDF path dependency-free.
 */
export function printHtml(html: string, title: string): boolean {
  const win = window.open('', '_blank', 'width=820,height=900');
  if (!win) return false;

  win.document.open();
  win.document.write(html);
  win.document.close();
  win.document.title = title;
  // Give the document a tick to lay out before opening the print dialog.
  setTimeout(() => win.print(), 150);
  return true;
}

/** A file name derived from the note title, safe for every filesystem. */
export function exportFileName(note: Note, extension: string): string {
  const base =
    note.title
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'untitled';
  return `${base}.${extension}`;
}

function metaLines(note: Note): string[] {
  return note.metadata
    .filter((item) => item.key.trim().length > 0)
    .map((item) => `- **${item.key.trim()}:** ${item.value}`);
}

async function blockToMarkdown(block: NoteBlock, context: ExportContext): Promise<string> {
  switch (block.type) {
    case 'text':
      return visibleTextColumns(block)
        .filter((column) => column.trim().length > 0)
        .join('\n\n');
    case 'heading':
      return block.text.trim().length > 0
        ? `${'#'.repeat(Math.min(Math.max(block.level, 1), 6))} ${block.text.trim()}`
        : '';
    case 'list':
      return block.items
        .filter((item) => item.trim().length > 0)
        .map((item, index) => (block.ordered ? `${index + 1}. ${item}` : `- ${item}`))
        .join('\n');
    case 'image': {
      const columns = await Promise.all(
        visibleImageColumns(block).map(async (column) => {
          if (column.type === 'text') return column.text;
          if (!column.src) return '';
          const src = await resolveImage(column.src, context);
          if (!src) return '';
          const alt = column.caption.replace(/[\]]/g, '\\]');
          return `![${alt}](${src})`;
        }),
      );
      return columns.filter((value) => value.trim().length > 0).join('\n\n');
    }
    case 'code':
      return `\`\`\`${block.language}\n${block.text}\n\`\`\``;
    case 'function':
      return `\`\`\`text\n${block.text}\n\`\`\``;
    case 'subnote':
      return blockPlainText(block);
  }
}

async function blockToHtml(block: NoteBlock, context: ExportContext): Promise<string> {
  switch (block.type) {
    case 'text': {
      const columns = visibleTextColumns(block).filter((column) => column.trim().length > 0);
      if (columns.length === 0) return '';
      if (columns.length === 1) return `<p>${inlineToHtml(columns[0])}</p>`;
      return `<div class="columns" style="grid-template-columns: repeat(${columns.length}, 1fr)">${columns
        .map((column) => `<div><p>${inlineToHtml(column)}</p></div>`)
        .join('')}</div>`;
    }
    case 'heading': {
      if (block.text.trim().length === 0) return '';
      const level = Math.min(Math.max(block.level, 1), 6);
      return `<h${level}>${inlineToHtml(block.text)}</h${level}>`;
    }
    case 'list': {
      const items = block.items.filter((item) => item.trim().length > 0);
      if (items.length === 0) return '';
      const tag = block.ordered ? 'ol' : 'ul';
      return `<${tag}>${items.map((item) => `<li>${inlineToHtml(item)}</li>`).join('')}</${tag}>`;
    }
    case 'image': {
      const parts = await Promise.all(
        visibleImageColumns(block).map(async (column) => {
          if (column.type === 'text') {
            return column.text.trim().length > 0 ? `<p>${inlineToHtml(column.text)}</p>` : '';
          }
          if (!column.src) return '';
          const src = await resolveImage(column.src, context);
          if (!src) return '';
          const caption =
            column.caption.trim().length > 0
              ? `<figcaption>${escapeHtml(column.caption)}</figcaption>`
              : '';
          return `<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(column.caption)}" />${caption}</figure>`;
        }),
      );
      return parts.filter((value) => value.length > 0).join('');
    }
    case 'code':
      return `<pre><code class="language-${escapeHtml(block.language)}">${escapeHtml(block.text)}</code></pre>`;
    case 'function':
      return `<pre><code>${escapeHtml(block.text)}</code></pre>`;
    case 'subnote':
      return '<p class="subnote">Sub-note</p>';
  }
}

async function resolveImage(src: string, context: ExportContext): Promise<string> {
  if (!context.assets) return src;
  return context.assets.dataUrl(src);
}

function inlineToHtml(value: string): string {
  return parseInline(value)
    .map((token) => {
      const text =
        token.kind === 'math'
          ? `<span class="math">${escapeHtml(token.text)}</span>`
          : token.kind === 'code'
            ? `<code>${escapeHtml(token.text)}</code>`
            : token.kind === 'link'
              ? `<a href="${escapeHtml(token.href)}" target="_blank" rel="noreferrer noopener">${escapeHtml(token.text)}</a>`
              : escapeHtml(token.text);
      return applyMarks(text, token.marks ?? []);
    })
    .join('');
}

function applyMarks(html: string, marks: InlineMark[]): string {
  let result = html;
  if (marks.includes('bold')) result = `<strong>${result}</strong>`;
  if (marks.includes('italic')) result = `<em>${result}</em>`;
  if (marks.includes('strike')) result = `<s>${result}</s>`;
  return result;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
