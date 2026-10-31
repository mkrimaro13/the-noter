import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VisibleImageColumn } from '../../models';
import { ImageColumn } from './image-column';

function column(patch: Partial<VisibleImageColumn> = {}): VisibleImageColumn {
  return {
    id: 'c_1',
    type: 'text',
    text: '',
    src: '',
    caption: '',
    main: false,
    ...patch,
  };
}

function setup(value: VisibleImageColumn, index = 0) {
  const fixture = TestBed.createComponent(ImageColumn);
  fixture.componentRef.setInput('column', value);
  fixture.componentRef.setInput('index', index);
  fixture.detectChanges();
  return fixture;
}

describe('ImageColumn', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders a text column and emits text changes', () => {
    const fixture = setup(column({ text: 'hello' }));
    const textarea = fixture.nativeElement.querySelector('.column-text') as HTMLTextAreaElement;
    const changed = vi.fn();
    fixture.componentInstance.changed.subscribe(changed);

    expect(textarea.value).toBe('hello');
    textarea.value = 'updated';
    textarea.dispatchEvent(new Event('input'));

    expect(changed).toHaveBeenCalledWith({ text: 'updated' });
  });

  it('switches between text and image columns', () => {
    const fixture = setup(column());
    const changed = vi.fn();
    fixture.componentInstance.changed.subscribe(changed);

    fixture.nativeElement.querySelectorAll('.column-types button')[1].click();

    expect(changed).toHaveBeenCalledWith({ type: 'image' });
  });

  it('does not emit when selecting the current column type', () => {
    const fixture = setup(column());
    const changed = vi.fn();
    fixture.componentInstance.changed.subscribe(changed);

    fixture.nativeElement.querySelectorAll('.column-types button')[0].click();

    expect(changed).not.toHaveBeenCalled();
  });

  it('renders an image with a caption and removes only the picture', () => {
    const fixture = setup(
      column({ type: 'image', src: 'photo.png', caption: 'A photo', main: true }),
    );
    const changed = vi.fn();
    fixture.componentInstance.changed.subscribe(changed);

    const image = fixture.nativeElement.querySelector('img') as HTMLImageElement;
    expect(image.getAttribute('src')).toBe('photo.png');
    expect(image.getAttribute('alt')).toBe('A photo');

    const caption = fixture.nativeElement.querySelector('.caption') as HTMLInputElement;
    caption.value = 'New caption';
    caption.dispatchEvent(new Event('input'));
    expect(changed).toHaveBeenCalledWith({ caption: 'New caption' });

    fixture.nativeElement.querySelector('.image-remove').click();
    expect(changed).toHaveBeenCalledWith({ src: '' });
  });

  it('shows a broken-image state and can clear it', () => {
    const fixture = setup(column({ type: 'image', src: 'broken.png' }));
    const changed = vi.fn();
    fixture.componentInstance.changed.subscribe(changed);

    const image = fixture.nativeElement.querySelector('img') as HTMLImageElement;
    image.dispatchEvent(new Event('error'));
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.image-broken')?.textContent).toContain(
      'This image couldn’t be loaded.',
    );

    fixture.nativeElement.querySelector('.image-broken .text-button').click();
    expect(changed).toHaveBeenCalledWith({ src: '', caption: '' });
  });

  it('accepts an image URL on Enter', () => {
    const fixture = setup(column({ type: 'image' }));
    const changed = vi.fn();
    fixture.componentInstance.changed.subscribe(changed);
    const input = fixture.nativeElement.querySelector('.image-url') as HTMLInputElement;

    input.value = 'https://example.com/a.png';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(changed).toHaveBeenCalledWith({ src: 'https://example.com/a.png' });
    expect(input.value).toBe('');
  });

  it('ignores an empty URL and other keys', () => {
    const fixture = setup(column({ type: 'image' }));
    const changed = vi.fn();
    fixture.componentInstance.changed.subscribe(changed);
    const input = fixture.nativeElement.querySelector('.image-url') as HTMLInputElement;

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    input.value = 'a.png';
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a' }));

    expect(changed).not.toHaveBeenCalled();
  });

  it('tracks drag-over state on the drop zone', () => {
    const fixture = setup(column({ type: 'image' }));
    const drop = fixture.nativeElement.querySelector('.image-drop') as HTMLElement;

    drop.dispatchEvent(new Event('dragover'));
    fixture.detectChanges();
    expect(drop.classList.contains('over')).toBe(true);

    drop.dispatchEvent(new Event('dragleave'));
    fixture.detectChanges();
    expect(drop.classList.contains('over')).toBe(false);
  });

  it('reports an error when a non-image file is chosen', async () => {
    const fixture = setup(column({ type: 'image' }));
    const input = fixture.nativeElement.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['text'], 'notes.txt', { type: 'text/plain' });
    Object.defineProperty(input, 'files', { configurable: true, value: [file] });

    input.dispatchEvent(new Event('change'));

    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector('.image-error')?.textContent).toContain(
        'That file is not an image.',
      );
    });
  });

  it('browses for a file from an empty or filled column', () => {
    const empty = setup(column({ type: 'image' }));
    const emptyInput = empty.nativeElement.querySelector('input[type="file"]') as HTMLInputElement;
    const emptyClick = vi.spyOn(emptyInput, 'click').mockImplementation(() => undefined);
    empty.nativeElement.querySelector('.image-drop .text-button').click();
    expect(emptyClick).toHaveBeenCalled();

    const filled = setup(column({ type: 'image', src: 'photo.png' }));
    const filledInput = filled.nativeElement.querySelector(
      'input[type="file"]',
    ) as HTMLInputElement;
    const filledClick = vi.spyOn(filledInput, 'click').mockImplementation(() => undefined);
    filled.nativeElement.querySelector('.image-replace').click();
    expect(filledClick).toHaveBeenCalled();
  });

  it('imports a dropped image and ignores drops without files', async () => {
    const fixture = setup(column({ type: 'image' }));
    const changed = vi.fn();
    fixture.componentInstance.changed.subscribe(changed);
    const drop = fixture.nativeElement.querySelector('.image-drop') as HTMLElement;

    const empty = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(empty, 'dataTransfer', { value: { files: [] } });
    drop.dispatchEvent(empty);
    expect(changed).not.toHaveBeenCalled();

    const event = new Event('drop', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'dataTransfer', {
      value: { files: [new File(['image'], 'photo.png', { type: 'image/png' })] },
    });
    drop.dispatchEvent(event);

    await vi.waitFor(() =>
      expect(changed).toHaveBeenCalledWith(
        expect.objectContaining({ src: expect.stringMatching(/^data:image\/png/) }),
      ),
    );
    expect(event.defaultPrevented).toBe(true);
  });

  it('emits focused when a focusable field receives focus', () => {
    const fixture = setup(column({ text: 'hello' }));
    fixture.componentRef.setInput('focusOnInit', true);
    fixture.detectChanges();
    const focused = vi.fn();
    fixture.componentInstance.focused.subscribe(focused);

    (fixture.nativeElement.querySelector('.column-text') as HTMLTextAreaElement).dispatchEvent(
      new Event('focus'),
    );

    expect(focused).toHaveBeenCalled();
  });

  it('renders markup previews for text and image captions', () => {
    const text = setup(column({ text: '`code`' }));
    expect(text.nativeElement.querySelector('.column-text-preview')).not.toBeNull();

    const caption = setup(
      column({ type: 'image', src: 'photo.png', caption: '[link](https://example.com)' }),
    );
    expect(caption.nativeElement.querySelector('.caption-preview')).not.toBeNull();
  });
});
