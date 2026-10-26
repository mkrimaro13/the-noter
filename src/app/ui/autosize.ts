import { AfterViewInit, Directive, ElementRef, inject } from '@angular/core';

/** Keeps a textarea exactly as tall as the text it contains. */
@Directive({
  selector: 'textarea[appAutosize]',
  host: {
    '(input)': 'resize()',
    '(window:resize)': 'resize()',
  },
})
export class Autosize implements AfterViewInit {
  private readonly element = inject<ElementRef<HTMLTextAreaElement>>(ElementRef);

  ngAfterViewInit(): void {
    this.resize();

    // Variable fonts can settle after the first paint, changing line heights.
    void document.fonts?.ready.then(() => {
      if (this.element.nativeElement.isConnected) {
        this.resize();
      }
    });
  }

  resize(): void {
    const textarea = this.element.nativeElement;
    textarea.style.height = 'auto';
    textarea.style.height = `${textarea.scrollHeight}px`;
  }
}
