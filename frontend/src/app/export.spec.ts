import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssetStore } from './assets';
import { downloadText, exportFileName, noteToHtml, noteToMarkdown, printHtml } from './export';
import { Note, createBlock, createNote } from './models';

function note(patch: Partial<Note> = {}): Note {
  return {
    ...createNote(),
    id: 'n_export',
    title: 'Trip notes',
    metadata: [{ id: 'm_1', key: 'Place', value: 'Lisbon', type: 'text', options: [] }],
    blocks: [
      { ...createBlock('heading', { text: 'Day **one**', level: 2 }), id: 'b_head' },
      { ...createBlock('text', { columns: ['Hello *world*'] }), id: 'b_text' },
      { ...createBlock('list', { items: ['Coffee', 'Tram'] }), id: 'b_list' },
      { ...createBlock('code', { text: 'print("hi")', language: 'py' }), id: 'b_code' },
      {
        ...createBlock('image', { src: 'https://example.com/photo.png', caption: 'A view' }),
        id: 'b_image',
      },
    ],
    ...patch,
  };
}

describe('export', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    TestBed.resetTestingModule();
  });

  it('builds a Markdown document with metadata, blocks, and images', async () => {
    const markdown = await noteToMarkdown(note());

    expect(markdown).toContain('# Trip notes');
    expect(markdown).toContain('- **Place:** Lisbon');
    expect(markdown).toContain('## Day **one**');
    expect(markdown).toContain('Hello *world*');
    expect(markdown).toContain('- Coffee\n- Tram');
    expect(markdown).toContain('```py\nprint("hi")\n```');
    expect(markdown).toContain('![A view](https://example.com/photo.png)');
  });

  it('inlines asset images when an AssetStore is provided', async () => {
    const assets = TestBed.inject(AssetStore);
    const ref = await assets.putDataUrl(`data:image/png;base64,${btoa('photo')}`);
    const source = note({
      blocks: [{ ...createBlock('image', { src: ref, caption: 'Local' }), id: 'b_image' }],
    });

    const markdown = await noteToMarkdown(source, { assets });
    expect(markdown).toContain('![Local](data:image/png;base64,');
  });

  it('renders a standalone HTML document with escaped content', async () => {
    const html = await noteToHtml(
      note({
        title: 'A <script> title',
        blocks: [
          { ...createBlock('text', { columns: ['Safe <b>text</b>'] }), id: 'b_text' },
          { ...createBlock('heading', { text: 'Code', level: 3 }), id: 'b_head' },
        ],
      }),
    );

    expect(html).toContain('<!doctype html>');
    expect(html).toContain('A &lt;script&gt; title');
    expect(html).toContain('Safe &lt;b&gt;text&lt;/b&gt;');
    expect(html).toContain('<h3>Code</h3>');
    expect(html).toContain('<dt>Place</dt><dd>Lisbon</dd>');
  });

  it('derives safe file names from titles', () => {
    expect(exportFileName(note({ title: '  Héllo, World!  ' }), 'md')).toBe('h-llo-world.md');
    expect(exportFileName(note({ title: '   ' }), 'html')).toBe('untitled.html');
  });

  it('downloads text through a temporary object URL', () => {
    const create = vi.fn(() => 'blob:note');
    const revoke = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      value: create,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: revoke,
      configurable: true,
      writable: true,
    });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    downloadText('note.md', '# Note', 'text/markdown');

    expect(create).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith('blob:note');
    expect(click).toHaveBeenCalledTimes(1);
  });

  it('prints through a new window and reports blocked popups', () => {
    vi.useFakeTimers();
    const print = vi.fn();
    const win = {
      document: {
        open: vi.fn(),
        write: vi.fn(),
        close: vi.fn(),
        title: '',
      },
      print,
    };
    const open = vi.fn((): typeof win | null => win);
    vi.spyOn(window, 'open').mockImplementation(open as unknown as typeof window.open);

    expect(printHtml('<p>Hi</p>', 'Note')).toBe(true);
    expect(win.document.write).toHaveBeenCalledWith('<p>Hi</p>');
    expect(win.document.title).toBe('Note');
    vi.runAllTimers();
    expect(print).toHaveBeenCalledTimes(1);

    open.mockReturnValue(null);
    expect(printHtml('<p>Hi</p>', 'Note')).toBe(false);
  });
});
