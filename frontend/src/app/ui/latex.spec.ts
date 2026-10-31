import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Latex } from './latex';

async function render(source: string): Promise<HTMLElement> {
  const fixture = TestBed.createComponent(Latex);
  fixture.componentRef.setInput('text', source);
  fixture.detectChanges();

  await vi.waitFor(() => {
    expect(fixture.nativeElement.querySelector('.katex')).not.toBeNull();
  });

  return fixture.nativeElement as HTMLElement;
}

describe('Latex', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('renders a simple expression', async () => {
    const element = await render('x^2');

    expect(element.querySelector('.katex')).not.toBeNull();
    expect(element.textContent).toContain('x');
  });

  it('renders a complete document body', async () => {
    const element = await render(
      String.raw`\documentclass{article}\begin{document}E = mc^2\end{document}`,
    );

    expect(element.querySelector('.katex')).not.toBeNull();
    expect(element.textContent).toContain('E');
    expect(element.textContent).toContain('mc');
  });

  it('renders the same \\newcommand source more than once', async () => {
    const source = String.raw`\newcommand{\MyR}{\mathbb{R}} \MyR`;

    const first = await render(source);
    expect(first.querySelector('.katex')).not.toBeNull();

    TestBed.resetTestingModule();

    const second = await render(source);
    expect(second.querySelector('.katex')).not.toBeNull();
  });

  it('renders safe links', async () => {
    const element = await render(String.raw`\href{https://example.com}{example}`);

    const link = element.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.com');
  });

  it('does not create javascript: links', async () => {
    const element = await render(String.raw`\href{javascript:alert(1)}{click}`);

    expect(element.querySelector('a[href^="javascript:"]')).toBeNull();
  });

  it('does not render embedded images or HTML extensions', async () => {
    const element = await render(
      String.raw`\includegraphics{https://example.com/a.png}\htmlStyle{color:red}{x}`,
    );

    expect(element.querySelector('img')).toBeNull();
    expect(element.querySelector('.enclosing[style]')).toBeNull();
    expect(element.querySelector('[style="color:red"]')).toBeNull();
  });

  it('renders nothing for empty source', () => {
    const fixture = TestBed.createComponent(Latex);
    fixture.componentRef.setInput('text', '   ');
    fixture.detectChanges();

    expect((fixture.nativeElement as HTMLElement).querySelector('.latex')?.innerHTML).toBe('');
  });
});
