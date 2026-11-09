import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TypographyService } from './typography';

const WRITING_FONT_KEY = 'the-noter.ui.writing-font';

function setup(): TypographyService {
  TestBed.configureTestingModule({});
  return TestBed.inject(TypographyService);
}

describe('TypographyService', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-writing-font');
    TestBed.resetTestingModule();
  });

  afterEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute('data-writing-font');
    TestBed.resetTestingModule();
  });

  it('starts with the serif typeface and applies it to the document', () => {
    const typography = setup();
    TestBed.tick();

    expect(typography.writingFont()).toBe('serif');
    expect(document.documentElement.getAttribute('data-writing-font')).toBe('serif');
    expect(localStorage.getItem(WRITING_FONT_KEY)).toBe('serif');
  });

  it('restores a stored sans choice', () => {
    localStorage.setItem(WRITING_FONT_KEY, 'sans');

    const typography = setup();
    TestBed.tick();

    expect(typography.writingFont()).toBe('sans');
    expect(document.documentElement.getAttribute('data-writing-font')).toBe('sans');
  });

  it('persists the chosen typeface', () => {
    const typography = setup();
    TestBed.tick();

    typography.setWritingFont('sans');
    TestBed.tick();

    expect(typography.writingFont()).toBe('sans');
    expect(document.documentElement.getAttribute('data-writing-font')).toBe('sans');
    expect(localStorage.getItem(WRITING_FONT_KEY)).toBe('sans');
  });
});
