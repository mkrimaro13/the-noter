import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Focus } from './focus';

@Component({
  standalone: true,
  imports: [Focus],
  template: `
    <textarea [appFocus]="active()" [appFocusOffset]="offset()" (appFocusDone)="done()"></textarea>
  `,
})
class Host {
  readonly active = signal(false);
  readonly offset = signal<number | null>(null);
  readonly done = vi.fn();
}

function setup() {
  const fixture = TestBed.createComponent(Host);
  document.body.appendChild(fixture.nativeElement);
  fixture.detectChanges();
  return fixture;
}

describe('Focus', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.resetTestingModule();
  });

  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  it('does not focus while the input is false', () => {
    const fixture = setup();
    vi.runAllTimers();

    expect(document.activeElement).not.toBe(fixture.nativeElement.querySelector('textarea'));
  });

  it('focuses the element when the input becomes true', () => {
    const fixture = setup();

    fixture.componentInstance.active.set(true);
    fixture.detectChanges();
    vi.runAllTimers();

    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('textarea'));
  });

  it('places the caret at the requested offset', () => {
    const fixture = setup();
    const textarea = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    textarea.value = 'hello world';

    fixture.componentInstance.offset.set(5);
    fixture.componentInstance.active.set(true);
    fixture.detectChanges();
    vi.runAllTimers();

    expect(textarea.selectionStart).toBe(5);
    expect(textarea.selectionEnd).toBe(5);
  });

  it('emits appFocusDone when a focused element receives focus', () => {
    const fixture = setup();
    const textarea = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;

    textarea.dispatchEvent(new FocusEvent('focus'));
    expect(fixture.componentInstance.done).not.toHaveBeenCalled();

    fixture.componentInstance.active.set(true);
    fixture.detectChanges();
    textarea.dispatchEvent(new FocusEvent('focus'));

    expect(fixture.componentInstance.done).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the element is no longer connected', () => {
    const fixture = setup();
    const textarea = fixture.nativeElement.querySelector('textarea') as HTMLTextAreaElement;
    fixture.componentInstance.active.set(true);
    fixture.detectChanges();
    textarea.remove();

    expect(() => vi.runAllTimers()).not.toThrow();
    expect(document.activeElement).not.toBe(textarea);
  });
});
