import { Directive, ElementRef, effect, inject, input, output } from '@angular/core';

/**
 * Focuses an element when `appFocus` becomes true. Emits once the focus has
 * landed so the parent can clear its one-shot focus request.
 */
@Directive({
  selector: '[appFocus]',
  host: {
    '(focus)': 'handleFocus()',
  },
})
export class Focus {
  readonly appFocus = input(false);
  /** Optional caret position to set after focusing a text field. */
  readonly appFocusOffset = input<number | null>(null);
  readonly appFocusDone = output<void>();

  private readonly element = inject<ElementRef<HTMLElement>>(ElementRef);

  constructor() {
    effect(() => {
      if (!this.appFocus()) return;

      setTimeout(() => {
        const element = this.element.nativeElement;
        if (!element.isConnected) return;

        element.focus();

        const offset = this.appFocusOffset();
        if (offset !== null && element instanceof HTMLTextAreaElement) {
          element.setSelectionRange(offset, offset);
        }
      });
    });
  }

  protected handleFocus(): void {
    if (this.appFocus()) {
      this.appFocusDone.emit();
    }
  }
}
