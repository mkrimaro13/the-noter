import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { CodeHighlight, highlightCode } from './highlight';

describe('highlightCode', () => {
  it('returns an empty string for empty code', () => {
    expect(highlightCode('', 'ts')).toBe('');
  });

  it('escapes plain text instead of highlighting it', () => {
    expect(highlightCode('<b> & "quoted"', 'text')).toBe('&lt;b&gt; &amp; &quot;quoted&quot;');
    expect(highlightCode('<b>', '')).toBe('&lt;b&gt;');
    expect(highlightCode('<b>', 'plaintext')).toBe('&lt;b&gt;');
  });

  it('highlights a known language', () => {
    const html = highlightCode('const x = 1;', 'ts');

    expect(html).toContain('hljs-keyword');
    expect(html).toContain('x');
  });

  it('auto-detects an unknown language', () => {
    const html = highlightCode('function greet() { return 1; }', 'not-a-language');

    expect(html.length).toBeGreaterThan(0);
    expect(html).toContain('greet');
  });
});

describe('CodeHighlight', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders highlighted code', () => {
    const fixture = TestBed.createComponent(CodeHighlight);
    fixture.componentRef.setInput('code', 'const x = 1;');
    fixture.componentRef.setInput('language', 'ts');
    fixture.detectChanges();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('code.hljs')?.innerHTML).toContain('hljs-keyword');
  });
});
