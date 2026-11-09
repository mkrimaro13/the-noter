import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MarkdownInline } from './markdown-inline';

function render(text: string): HTMLElement {
  const fixture = TestBed.createComponent(MarkdownInline);
  fixture.componentRef.setInput('text', text);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('MarkdownInline', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders plain text', () => {
    const element = render('hello world');

    expect(element.textContent).toContain('hello world');
    expect(element.querySelector('code')).toBeNull();
    expect(element.querySelector('a')).toBeNull();
  });

  it('renders inline code', () => {
    const element = render('use `npm test`');

    expect(element.querySelector('.md-code')?.textContent).toBe('npm test');
  });

  it('renders links with safe target attributes', () => {
    const element = render('[docs](https://example.com/docs)');
    const link = element.querySelector('a')!;

    expect(link.textContent).toBe('docs');
    expect(link.getAttribute('href')).toBe('https://example.com/docs');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noreferrer noopener');
    expect(link.getAttribute('tabindex')).toBe('-1');
  });

  it('leaves unsafe links as text', () => {
    const element = render('[x](javascript:alert(1))');

    expect(element.querySelector('a')).toBeNull();
    expect(element.textContent).toContain('[x](javascript:alert(1))');
  });

  it('renders bold, italic, and strikethrough marks', () => {
    const bold = render('**bold**');
    const italic = render('*italic*');
    const strike = render('~~gone~~');

    expect(bold.querySelector('.md-bold')?.textContent).toBe('bold');
    expect(italic.querySelector('.md-italic')?.textContent).toBe('italic');
    expect(strike.querySelector('.md-strike')?.textContent).toBe('gone');
  });

  it('renders nested marks on inline code and links', () => {
    const code = render('**use `npm test`**');
    const link = render('*[docs](https://example.com)*');

    expect(code.querySelector('.md-bold .md-code')?.textContent).toBe('npm test');
    expect(link.querySelector('.md-italic a')?.textContent).toBe('docs');
  });

  it('renders inline math with KaTeX', async () => {
    const element = render('energy $E = mc^2$ here');

    await vi.waitFor(() => {
      expect(element.querySelector('.md-math .katex')).not.toBeNull();
    });

    expect(element.textContent).toContain('energy');
    expect(element.textContent).toContain('here');
  });

  it('renders display math from double dollars', async () => {
    const element = render('$$\\frac{a}{b}$$');

    await vi.waitFor(() => {
      expect(element.querySelector('.md-math .katex')).not.toBeNull();
    });

    expect(element.querySelector('.md-math .latex')?.classList.contains('inline')).toBe(false);
  });
});
