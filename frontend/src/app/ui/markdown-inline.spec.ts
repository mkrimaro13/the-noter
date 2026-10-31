import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
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
});
