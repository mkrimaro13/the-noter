import { describe, expect, it } from 'vitest';
import { looksLikeLatex, normalizeLatex, stripMathDelimiters } from './latex';

describe('looksLikeLatex', () => {
  it('detects common math expressions', () => {
    expect(looksLikeLatex('E = mc^2')).toBe(true);
    expect(looksLikeLatex('x_1')).toBe(true);
    expect(looksLikeLatex('\\frac{a}{b}')).toBe(true);
    expect(looksLikeLatex('$$x$$')).toBe(true);
    expect(looksLikeLatex('a & b \\\\ c & d')).toBe(true);
  });

  it('leaves plain signatures and prose alone', () => {
    expect(looksLikeLatex('')).toBe(false);
    expect(looksLikeLatex('formatDate(date, pattern)')).toBe(false);
    expect(looksLikeLatex('AT&T')).toBe(false);
    expect(looksLikeLatex('a & b')).toBe(false);
    expect(looksLikeLatex('a \\\\ b')).toBe(false);
  });
});

describe('stripMathDelimiters', () => {
  it('removes one pair of outer math delimiters', () => {
    expect(stripMathDelimiters('$$x^2$$')).toBe('x^2');
    expect(stripMathDelimiters('$x^2$')).toBe('x^2');
    expect(stripMathDelimiters('\\[x^2\\]')).toBe('x^2');
    expect(stripMathDelimiters('\\(x^2\\)')).toBe('x^2');
  });

  it('trims but otherwise leaves un-delimited input unchanged', () => {
    expect(stripMathDelimiters('  x^2  ')).toBe('x^2');
    expect(stripMathDelimiters('$$')).toBe('$$');
  });
});

describe('normalizeLatex', () => {
  it('keeps the body of a complete document', () => {
    const document = String.raw`\documentclass[12pt]{article}
\usepackage{amsmath}
\title{Example}
\author{Ada}
\begin{document}
E = mc^2
\end{document}`;

    expect(normalizeLatex(document)).toBe('E = mc^2');
  });

  it('preserves row spacing such as \\\\[2ex]', () => {
    const source = String.raw`\begin{aligned} a &= b \\[2ex] c &= d \end{aligned}`;

    expect(normalizeLatex(source)).toContain(String.raw`\\[2ex]`);
  });

  it('removes inline delimiters instead of turning them into dollar signs', () => {
    expect(normalizeLatex(String.raw`\(a\) + \(b\)`)).toBe('a + b');
    expect(normalizeLatex(String.raw`\[a + b\]`)).toBe('a + b');
  });

  it('normalizes starred macro definitions', () => {
    expect(normalizeLatex(String.raw`\newcommand*{\R}{\mathbb{R}} \R`)).toBe(
      String.raw`\newcommand{\R}{\mathbb{R}} \R`,
    );
    expect(normalizeLatex(String.raw`\renewcommand*{\R}{x}`)).toBe(
      String.raw`\renewcommand{\R}{x}`,
    );
    expect(normalizeLatex(String.raw`\providecommand*{\R}{x}`)).toBe(
      String.raw`\providecommand{\R}{x}`,
    );
  });

  it('converts tabular, tabular*, and tabularx to array', () => {
    expect(normalizeLatex(String.raw`\begin{tabular}{c|c} a & b \end{tabular}`)).toBe(
      String.raw`\begin{array}{c|c} a & b \end{array}`,
    );
    expect(
      normalizeLatex(String.raw`\begin{tabular*}{0.8\textwidth}[t]{c|c} a & b \end{tabular*}`),
    ).toBe(String.raw`\begin{array}{c|c} a & b \end{array}`);
    expect(normalizeLatex(String.raw`\begin{tabularx}{\textwidth}{lX} a & b \end{tabularx}`)).toBe(
      String.raw`\begin{array}{ll} a & b \end{array}`,
    );
  });

  it('normalizes width-based array columns', () => {
    expect(normalizeLatex(String.raw`\begin{tabular}{|p{3cm}|m{2cm}|} a & b \end{tabular}`)).toBe(
      String.raw`\begin{array}{|l|l|} a & b \end{array}`,
    );
  });

  it('removes table and figure wrappers and their unsupported metadata', () => {
    const source = String.raw`\begin{table}[htbp]
\centering
\caption{A table}
\label{tab:one}
\begin{tabular}{c|c}
a & b
\end{tabular}
\end{table}`;

    expect(normalizeLatex(source)).toBe(String.raw`\begin{array}{c|c}
a & b
\end{array}`);
  });

  it('removes figure and centering wrappers', () => {
    expect(
      normalizeLatex(
        String.raw`\begin{figure}[h]\centering\caption{Plot}\label{fig:a}x\end{figure}`,
      ),
    ).toBe('x');
  });

  it('converts multline and eqnarray to aligned', () => {
    expect(normalizeLatex(String.raw`\begin{multline} a \\ b \end{multline}`)).toBe(
      String.raw`\begin{aligned} a \\ b \end{aligned}`,
    );
    expect(normalizeLatex(String.raw`\begin{eqnarray*} a &=& b \end{eqnarray*}`)).toBe(
      String.raw`\begin{aligned} a &=& b \end{aligned}`,
    );
  });

  it('leaves environments KaTeX supports alone', () => {
    const gather = String.raw`\begin{gather} a \\ b \end{gather}`;
    const align = String.raw`\begin{align} a &= b \end{align}`;

    expect(normalizeLatex(gather)).toBe(gather);
    expect(normalizeLatex(align)).toBe(align);
  });

  it('removes displaymath and math wrappers', () => {
    expect(normalizeLatex(String.raw`\begin{displaymath}x\end{displaymath}`)).toBe('x');
    expect(normalizeLatex(String.raw`\begin{math}x\end{math}`)).toBe('x');
  });

  it('removes common preamble commands', () => {
    expect(
      normalizeLatex(
        String.raw`\documentclass{article}\usepackage{amsmath}\title{T}\author{A}\date{D}\maketitle\tableofcontents\newpage x`,
      ),
    ).toBe('x');
  });
});
