import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Autosize } from './autosize';

@Component({
  imports: [Autosize],
  template: `<textarea appAutosize></textarea>`,
})
class Host {}

function stubFonts(): Promise<void> {
  const ready = Promise.resolve();
  Object.defineProperty(document, 'fonts', { configurable: true, value: { ready } });
  return ready;
}

describe('Autosize', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    vi.restoreAllMocks();
  });

  it('resizes again after fonts settle', async () => {
    const ready = stubFonts();
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();

    await ready;
    await Promise.resolve();

    const textarea = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    expect(textarea.style.height).toBe(`${textarea.scrollHeight}px`);
  });

  it('skips the font-settle resize when the textarea was removed', async () => {
    const ready = stubFonts();
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const textarea = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    textarea.remove();

    await ready;
    await Promise.resolve();

    expect(textarea.isConnected).toBe(false);
  });
});
