import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FontSelector } from './font-selector';

const WRITING_FONT_KEY = 'the-noter.ui.writing-font';

function setup(compact = false) {
  TestBed.configureTestingModule({});
  const fixture = TestBed.createComponent(FontSelector);
  fixture.componentRef.setInput('compact', compact);
  fixture.detectChanges();
  return fixture;
}

describe('FontSelector', () => {
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

  it('marks the active typeface and switches to sans', () => {
    const fixture = setup();
    const element = fixture.nativeElement as HTMLElement;
    const serif = element.querySelector<HTMLButtonElement>('.font-option--serif')!;
    const sans = element.querySelector<HTMLButtonElement>('.font-option--sans')!;

    expect(serif.getAttribute('aria-pressed')).toBe('true');
    expect(sans.getAttribute('aria-pressed')).toBe('false');

    sans.click();
    fixture.detectChanges();
    TestBed.tick();

    expect(serif.getAttribute('aria-pressed')).toBe('false');
    expect(sans.getAttribute('aria-pressed')).toBe('true');
    expect(document.documentElement.getAttribute('data-writing-font')).toBe('sans');
    expect(localStorage.getItem(WRITING_FONT_KEY)).toBe('sans');
  });

  it('switches back to serif', () => {
    localStorage.setItem(WRITING_FONT_KEY, 'sans');
    const fixture = setup();
    const element = fixture.nativeElement as HTMLElement;

    element.querySelector<HTMLButtonElement>('.font-option--serif')!.click();
    fixture.detectChanges();
    TestBed.tick();

    expect(localStorage.getItem(WRITING_FONT_KEY)).toBe('serif');
  });

  it('exposes a compact layout for the collapsed rail', () => {
    const fixture = setup(true);

    expect((fixture.nativeElement as HTMLElement).classList.contains('compact')).toBe(true);
  });
});
