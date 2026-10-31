import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NoteBlock as NoteBlockData, createBlock, createImageColumn } from '../models';
import { NoteBlock } from './note-block';

function setup(block: NoteBlockData, index = 0, total = 1) {
  const fixture = TestBed.createComponent(NoteBlock);
  fixture.componentRef.setInput('block', block);
  fixture.componentRef.setInput('index', index);
  fixture.componentRef.setInput('total', total);
  fixture.detectChanges();
  return fixture;
}

function textarea(element: HTMLElement, selector: string): HTMLTextAreaElement {
  return element.querySelector(selector) as HTMLTextAreaElement;
}

function inputEvent(): Event {
  return new Event('input', { bubbles: true });
}

function keyEvent(key: string, patch: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...patch });
}

describe('NoteBlock', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    TestBed.resetTestingModule();
  });

  it('renders a text block and emits column edits', () => {
    const fixture = setup(createBlock('text', { columns: ['hello'], columnCount: 1 }));
    const element = fixture.nativeElement as HTMLElement;
    const changed = vi.fn();
    fixture.componentInstance.columnChanged.subscribe(changed);

    const field = textarea(element, '.text-input');
    expect(field.value).toBe('hello');
    expect(field.getAttribute('aria-label')).toBe('Text block');

    field.value = 'updated';
    field.dispatchEvent(inputEvent());

    expect(changed).toHaveBeenCalledWith({ index: 0, value: 'updated' });
  });

  it('labels each column when a text block has several', () => {
    const fixture = setup(createBlock('text', { columns: ['one', 'two'], columnCount: 2 }));
    const fields = (fixture.nativeElement as HTMLElement).querySelectorAll('.text-input');

    expect(fields).toHaveLength(2);
    expect(fields[1].getAttribute('aria-label')).toBe('Text block, column 2 of 2');
  });

  it('turns a pasted fenced block into a fence shortcut', () => {
    const fixture = setup(createBlock('text'));
    const element = fixture.nativeElement as HTMLElement;
    const fence = vi.fn();
    fixture.componentInstance.fence.subscribe(fence);

    const field = textarea(element, '.text-input');
    field.value = '```ts\nconst x = 1;\n```';
    field.dispatchEvent(inputEvent());

    expect(fence).toHaveBeenCalledWith({ language: 'ts', text: 'const x = 1;' });
  });

  it('recognises extended block shortcuts at the start of the first column', () => {
    const fixture = setup(createBlock('text'));
    const element = fixture.nativeElement as HTMLElement;
    const changed = vi.fn();
    const typeChanged = vi.fn();
    fixture.componentInstance.columnChanged.subscribe(changed);
    fixture.componentInstance.typeChanged.subscribe(typeChanged);

    const field = textarea(element, '.text-input');
    field.value = '$$\\frac{a}{b}$$';
    field.dispatchEvent(inputEvent());

    expect(changed).toHaveBeenCalledWith({ index: 0, value: '\\frac{a}{b}' });
    expect(typeChanged).toHaveBeenCalledWith('function');

    field.value = '``const x = 1;';
    field.dispatchEvent(inputEvent());

    expect(changed).toHaveBeenCalledWith({ index: 0, value: 'const x = 1;' });
    expect(typeChanged).toHaveBeenCalledWith('code');

    field.value = '#>Child note';
    field.dispatchEvent(inputEvent());

    expect(changed).toHaveBeenCalledWith({ index: 0, value: 'Child note' });
    expect(typeChanged).toHaveBeenCalledWith('subnote');
  });

  it('recognises Markdown heading and list prefixes', () => {
    const fixture = setup(createBlock('text'));
    const element = fixture.nativeElement as HTMLElement;
    const shortcut = vi.fn();
    fixture.componentInstance.shortcut.subscribe(shortcut);

    const field = textarea(element, '.text-input');
    field.value = '## Title';
    field.dispatchEvent(inputEvent());
    expect(shortcut).toHaveBeenCalledWith({ kind: 'heading', level: 2, text: 'Title' });

    field.value = '- first';
    field.dispatchEvent(inputEvent());
    expect(shortcut).toHaveBeenCalledWith({ kind: 'list', ordered: false, items: ['first'] });
  });

  it('splits a text block on plain Enter but not with modifiers', () => {
    const fixture = setup(createBlock('text', { columns: ['ab'], columnCount: 1 }));
    const element = fixture.nativeElement as HTMLElement;
    const split = vi.fn();
    fixture.componentInstance.split.subscribe(split);
    const field = textarea(element, '.text-input');
    field.value = 'ab';
    field.setSelectionRange(1, 1);

    const modified = keyEvent('Enter', { shiftKey: true });
    field.dispatchEvent(modified);
    expect(split).not.toHaveBeenCalled();
    expect(modified.defaultPrevented).toBe(false);

    const plain = keyEvent('Enter');
    field.dispatchEvent(plain);

    expect(plain.defaultPrevented).toBe(true);
    expect(split).toHaveBeenCalledWith({ column: 0, before: 'a', after: 'b' });
  });

  it('turns a fence opening line into a fence on Enter', () => {
    const fixture = setup(createBlock('text'));
    const element = fixture.nativeElement as HTMLElement;
    const fence = vi.fn();
    fixture.componentInstance.fence.subscribe(fence);
    const field = textarea(element, '.text-input');
    field.value = '```python';

    field.dispatchEvent(keyEvent('Enter'));

    expect(fence).toHaveBeenCalledWith({ language: 'python', text: '' });
  });

  it('applies Ctrl+Alt block shortcuts', () => {
    const fixture = setup(createBlock('text'));
    const element = fixture.nativeElement as HTMLElement;
    const changed = vi.fn();
    const typeChanged = vi.fn();
    fixture.componentInstance.changed.subscribe(changed);
    fixture.componentInstance.typeChanged.subscribe(typeChanged);
    const field = textarea(element, '.text-input');

    const heading = keyEvent('3', { ctrlKey: true, altKey: true });
    field.dispatchEvent(heading);
    expect(heading.defaultPrevented).toBe(true);
    expect(changed).toHaveBeenCalledWith({ level: 3 });
    expect(typeChanged).toHaveBeenCalledWith('heading');

    field.dispatchEvent(keyEvent('e', { ctrlKey: true, altKey: true }));
    expect(typeChanged).toHaveBeenCalledWith('code');

    field.dispatchEvent(keyEvent('f', { ctrlKey: true, altKey: true }));
    expect(typeChanged).toHaveBeenCalledWith('function');

    field.dispatchEvent(keyEvent('p', { ctrlKey: true, altKey: true }));
    expect(typeChanged).toHaveBeenCalledWith('subnote');
  });

  it('rewrites heading prefixes and splits headings on Enter', () => {
    const fixture = setup(createBlock('heading', { text: 'Titlebody', level: 2 }));
    const element = fixture.nativeElement as HTMLElement;
    const changed = vi.fn();
    const headingSplit = vi.fn();
    fixture.componentInstance.changed.subscribe(changed);
    fixture.componentInstance.headingSplit.subscribe(headingSplit);
    const field = textarea(element, '.heading-input');

    field.value = '### New title';
    field.setSelectionRange(4, 4);
    field.dispatchEvent(inputEvent());

    expect(changed).toHaveBeenCalledWith({ text: 'New title', level: 3 });
    expect(field.value).toBe('New title');

    field.value = 'Titlebody';
    field.setSelectionRange(5, 5);
    field.dispatchEvent(keyEvent('Enter'));

    expect(headingSplit).toHaveBeenCalledWith({ before: 'Title', after: 'body' });
  });

  it('manages list items and ordering', () => {
    const fixture = setup(createBlock('list', { items: ['first', ''], ordered: false }));
    const element = fixture.nativeElement as HTMLElement;
    const changed = vi.fn();
    const removed = vi.fn();
    fixture.componentInstance.changed.subscribe(changed);
    fixture.componentInstance.removed.subscribe(removed);

    const inputs = element.querySelectorAll<HTMLInputElement>('.list-input');
    expect(inputs).toHaveLength(2);

    inputs[0].dispatchEvent(keyEvent('Enter'));
    expect(changed).toHaveBeenCalledWith({ items: ['first', '', ''] });

    inputs[1].dispatchEvent(keyEvent('Backspace'));
    expect(changed).toHaveBeenCalledWith({ items: ['first'] });

    element.querySelector<HTMLButtonElement>('.list-toggle')!.click();
    expect(changed).toHaveBeenCalledWith({ ordered: true });

    element.querySelector<HTMLButtonElement>('.add-item')!.click();
    expect(changed).toHaveBeenCalledWith({ items: ['first', '', ''] });

    const single = setup(createBlock('list', { items: [''], ordered: false }));
    single.componentInstance.removed.subscribe(removed);
    (single.nativeElement as HTMLElement)
      .querySelector<HTMLInputElement>('.list-input')!
      .dispatchEvent(keyEvent('Backspace'));
    expect(removed).toHaveBeenCalled();
  });

  it('maps changes on image columns to the main block or extra columns', () => {
    const fixture = setup(
      createBlock('image', {
        src: 'main.png',
        caption: 'Main',
        imageColumns: [createImageColumn('text', { text: 'extra' })],
        columnCount: 2,
      }),
    );
    const element = fixture.nativeElement as HTMLElement;
    const changed = vi.fn();
    const imageColumnChanged = vi.fn();
    fixture.componentInstance.changed.subscribe(changed);
    fixture.componentInstance.imageColumnChanged.subscribe(imageColumnChanged);

    const caption = element.querySelector<HTMLInputElement>('.caption')!;
    caption.value = 'New caption';
    caption.dispatchEvent(inputEvent());
    expect(changed).toHaveBeenCalledWith({ caption: 'New caption' });

    const extra = element.querySelector<HTMLTextAreaElement>('.column-text')!;
    extra.value = 'updated extra';
    extra.dispatchEvent(inputEvent());
    expect(imageColumnChanged).toHaveBeenCalledWith({ index: 0, patch: { text: 'updated extra' } });
  });

  it('renders code with a language field and emits code edits', () => {
    const fixture = setup(createBlock('code', { text: 'const x = 1;', language: 'ts' }));
    const element = fixture.nativeElement as HTMLElement;
    const changed = vi.fn();
    fixture.componentInstance.changed.subscribe(changed);

    const language = element.querySelector<HTMLInputElement>('.code-language')!;
    expect(language.value).toBe('ts');
    language.value = 'python';
    language.dispatchEvent(inputEvent());
    expect(changed).toHaveBeenCalledWith({ language: 'python' });

    const code = textarea(element, '.code-input');
    code.value = 'print(1)';
    code.dispatchEvent(inputEvent());
    expect(changed).toHaveBeenCalledWith({ text: 'print(1)' });
    expect(element.querySelector('.code-highlight')?.textContent).toContain('const');
  });

  it('toggles LaTeX rendering for function blocks', () => {
    const plain = setup(createBlock('function', { text: 'x^2', language: 'plain' }));
    const changed = vi.fn();
    plain.componentInstance.changed.subscribe(changed);

    (plain.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.math-toggle')!.click();

    expect(changed).toHaveBeenCalledWith({ language: 'latex' });
  });

  it('opens the block type menu and emits a new type', () => {
    const fixture = setup(createBlock('text'));
    const element = fixture.nativeElement as HTMLElement;
    const typeChanged = vi.fn();
    fixture.componentInstance.typeChanged.subscribe(typeChanged);

    element.querySelector<HTMLButtonElement>('.type-toggle')!.click();
    fixture.detectChanges();

    const menu = element.querySelector('.type-menu')!;
    expect(menu).not.toBeNull();
    const heading = Array.from(menu.querySelectorAll<HTMLButtonElement>('button')).find((button) =>
      button.textContent?.includes('Heading'),
    )!;
    heading.click();

    expect(typeChanged).toHaveBeenCalledWith('heading');
    fixture.detectChanges();
    expect(element.querySelector('.type-menu')).toBeNull();
  });

  it('changes text column count and heading level from their menus', () => {
    const fixture = setup(createBlock('text'));
    const element = fixture.nativeElement as HTMLElement;
    const columnCountChanged = vi.fn();
    fixture.componentInstance.columnCountChanged.subscribe(columnCountChanged);

    element.querySelector<HTMLButtonElement>('.columns-toggle')!.click();
    fixture.detectChanges();
    const twoColumns = element.querySelector<HTMLButtonElement>(
      '.columns-menu button[aria-label="2 columns"]',
    )!;
    twoColumns.click();
    expect(columnCountChanged).toHaveBeenCalledWith(2);

    const headingFixture = setup(createBlock('heading', { text: 'Title', level: 1 }));
    const headingElement = headingFixture.nativeElement as HTMLElement;
    const changed = vi.fn();
    headingFixture.componentInstance.changed.subscribe(changed);

    headingElement.querySelector<HTMLButtonElement>('.heading-toggle')!.click();
    headingFixture.detectChanges();
    headingElement
      .querySelector<HTMLButtonElement>('.heading-menu button[aria-label="Heading 4"]')!
      .click();

    expect(changed).toHaveBeenCalledWith({ level: 4 });
  });

  it('moves the block with arrow keys on the handle', () => {
    const fixture = setup(createBlock('text'), 1, 3);
    const element = fixture.nativeElement as HTMLElement;
    const move = vi.fn();
    fixture.componentInstance.move.subscribe(move);
    const handle = element.querySelector<HTMLButtonElement>('.handle')!;

    handle.dispatchEvent(keyEvent('ArrowUp'));
    expect(move).toHaveBeenCalledWith(0);

    handle.dispatchEvent(keyEvent('ArrowDown'));
    expect(move).toHaveBeenCalledWith(2);

    const first = setup(createBlock('text'), 0, 1);
    const firstMove = vi.fn();
    first.componentInstance.move.subscribe(firstMove);
    const firstHandle = (first.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      '.handle',
    )!;
    firstHandle.dispatchEvent(keyEvent('ArrowUp'));
    firstHandle.dispatchEvent(keyEvent('ArrowDown'));
    expect(firstMove).not.toHaveBeenCalled();
  });

  it('emits delete when the trash action is pressed', () => {
    const fixture = setup(createBlock('text'));
    const removed = vi.fn();
    fixture.componentInstance.removed.subscribe(removed);

    (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.remove')!.click();

    expect(removed).toHaveBeenCalled();
  });

  it('closes menus on outside clicks and Escape, restoring focus', () => {
    vi.useFakeTimers();
    const fixture = setup(createBlock('text'));
    const element = fixture.nativeElement as HTMLElement;
    const columnsToggle = element.querySelector<HTMLButtonElement>('.columns-toggle')!;

    columnsToggle.click();
    fixture.detectChanges();
    expect(element.querySelector('.columns-menu')).not.toBeNull();

    document.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    expect(element.querySelector('.columns-menu')).toBeNull();

    columnsToggle.click();
    fixture.detectChanges();
    element
      .querySelector<HTMLElement>('.columns-menu')!
      .dispatchEvent(new MouseEvent('click', { bubbles: true }));
    fixture.detectChanges();
    expect(element.querySelector('.columns-menu')).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    vi.runAllTimers();
    fixture.detectChanges();

    expect(element.querySelector('.columns-menu')).toBeNull();
    expect(document.activeElement).toBe(columnsToggle);
  });

  it('keeps menus mutually exclusive and refocuses on the same selection', () => {
    vi.useFakeTimers();
    const fixture = setup(createBlock('text', { columnCount: 1 }));
    const element = fixture.nativeElement as HTMLElement;
    const typeToggle = element.querySelector<HTMLButtonElement>('.type-toggle')!;

    element.querySelector<HTMLButtonElement>('.columns-toggle')!.click();
    fixture.detectChanges();
    typeToggle.click();
    fixture.detectChanges();
    expect(element.querySelector('.columns-menu:not(.type-menu)')).toBeNull();
    expect(element.querySelector('.type-menu')).not.toBeNull();

    const current = Array.from(
      element.querySelectorAll<HTMLButtonElement>('.type-menu button'),
    ).find((button) => button.textContent?.includes('Text'))!;
    current.click();
    vi.runAllTimers();
    expect(document.activeElement).toBe(typeToggle);

    element.querySelector<HTMLButtonElement>('.columns-toggle')!.click();
    fixture.detectChanges();
    element
      .querySelector<HTMLButtonElement>('.columns-menu button[aria-label="1 column"]')!
      .click();
    vi.runAllTimers();
    expect(document.activeElement).toBe(element.querySelector('.columns-toggle'));

    const changed = vi.fn();
    fixture.componentInstance.columnCountChanged.subscribe(changed);
    const component = fixture.componentInstance as unknown as {
      setColumns(count: number): void;
      setHeadingLevel(level: number): void;
    };
    component.setColumns(0);
    component.setColumns(9);
    expect(changed).not.toHaveBeenCalled();
  });

  it('changes heading levels, ignoring out-of-range levels', () => {
    const fixture = setup(createBlock('heading', { text: 'Title', level: 2 }));
    const element = fixture.nativeElement as HTMLElement;
    const changed = vi.fn();
    fixture.componentInstance.changed.subscribe(changed);

    const component = fixture.componentInstance as unknown as {
      setHeadingLevel(level: number): void;
    };
    component.setHeadingLevel(0);
    component.setHeadingLevel(9);
    expect(changed).not.toHaveBeenCalled();

    element.querySelector<HTMLButtonElement>('.heading-toggle')!.click();
    fixture.detectChanges();
    element
      .querySelector<HTMLButtonElement>('.heading-menu button[aria-label="Heading 1"]')!
      .click();
    expect(changed).toHaveBeenCalledWith({ level: 1 });
  });

  it('edits list items and ignores composition and non-empty backspace', () => {
    const fixture = setup(createBlock('list', { items: ['first', 'second'], ordered: false }));
    const element = fixture.nativeElement as HTMLElement;
    const changed = vi.fn();
    fixture.componentInstance.changed.subscribe(changed);

    const inputs = element.querySelectorAll<HTMLInputElement>('.list-input');
    inputs[0].value = 'changed';
    inputs[0].dispatchEvent(inputEvent());
    expect(changed).toHaveBeenCalledWith({ items: ['changed', 'second'] });

    changed.mockClear();
    inputs[1].dispatchEvent(keyEvent('Backspace'));
    inputs[1].dispatchEvent(keyEvent('Enter', { isComposing: true }));
    expect(changed).not.toHaveBeenCalled();

    element.querySelectorAll<HTMLButtonElement>('.item-remove')[0].click();
    expect(changed).toHaveBeenCalledWith({ items: ['second'] });
  });

  it('renders LaTeX only when a function block has visible math', () => {
    const detected = setup(createBlock('function', { text: 'x^2', language: '' }));
    const detectedElement = detected.nativeElement as HTMLElement;
    expect(detectedElement.querySelector('.function-preview')).not.toBeNull();

    const latex = setup(createBlock('function', { text: '', language: 'latex' }));
    const latexElement = latex.nativeElement as HTMLElement;
    const changed = vi.fn();
    latex.componentInstance.changed.subscribe(changed);
    expect(latexElement.querySelector('.function-preview')).toBeNull();

    latexElement.querySelector<HTMLButtonElement>('.math-toggle')!.click();
    expect(changed).toHaveBeenCalledWith({ language: 'plain' });

    const plain = setup(createBlock('function', { text: '', language: 'plain' }));
    expect((plain.nativeElement as HTMLElement).querySelector('.function-preview')).toBeNull();
  });

  it('reports focus from image columns', () => {
    const fixture = setup(
      createBlock('image', {
        src: 'main.png',
        columnCount: 2,
        imageColumns: [createImageColumn('text', { text: 'extra' })],
      }),
    );
    const focused = vi.fn();
    fixture.componentInstance.focused.subscribe(focused);
    fixture.componentRef.setInput('focusOnInit', true);
    fixture.detectChanges();

    const caption = (fixture.nativeElement as HTMLElement).querySelector<HTMLInputElement>(
      '.caption',
    )!;
    caption.dispatchEvent(new Event('focus'));
    expect(focused).toHaveBeenCalled();
  });

  it('ignores document clicks and menu closes when no menu is open', () => {
    const fixture = setup(createBlock('text'));
    const component = fixture.componentInstance as unknown as {
      onDocumentClick(event: MouseEvent): void;
      closeMenus(restoreFocus?: boolean): void;
    };

    expect(() => {
      component.onDocumentClick(new MouseEvent('click'));
      component.closeMenus();
      component.closeMenus(true);
    }).not.toThrow();
  });
});
