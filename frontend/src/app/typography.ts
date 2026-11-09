import { Injectable, effect, signal } from '@angular/core';

/** The two writing typefaces available in the right-hand bar. */
export type WritingFont = 'serif' | 'sans';

const WRITING_FONT_KEY = 'the-noter.ui.writing-font';

@Injectable({ providedIn: 'root' })
export class TypographyService {
  readonly writingFont = signal<WritingFont>(readWritingFont());

  constructor() {
    effect(() => {
      const font = this.writingFont();
      document.documentElement.setAttribute('data-writing-font', font);
      try {
        localStorage.setItem(WRITING_FONT_KEY, font);
      } catch {
        // The selection still works for this session when storage is unavailable.
      }
    });
  }

  setWritingFont(font: WritingFont): void {
    this.writingFont.set(font);
  }
}

function readWritingFont(): WritingFont {
  try {
    return localStorage.getItem(WRITING_FONT_KEY) === 'sans' ? 'sans' : 'serif';
  } catch {
    return 'serif';
  }
}
