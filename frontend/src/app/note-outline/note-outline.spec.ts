import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Note, createBlock, createNote } from '../models';
import { NoteOutline } from './note-outline';

function noteWithHeadings(): Note {
  return {
    ...createNote(),
    blocks: [
      createBlock('heading', { text: 'First', level: 1 }),
      createBlock('heading', { text: 'Second `code`', level: 3 }),
      createBlock('heading', { text: '   ', level: 2 }),
      createBlock('heading', { text: 'Clamped', level: 99 }),
      createBlock('text', { columns: ['not a heading'] }),
    ],
  };
}

function rect(top: number): DOMRect {
  return {
    top,
    bottom: top,
    left: 0,
    right: 0,
    width: 0,
    height: 0,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function setup(note: Note = noteWithHeadings()) {
  const fixture = TestBed.createComponent(NoteOutline);
  fixture.componentRef.setInput('note', note);
  fixture.detectChanges();
  return fixture;
}

describe('NoteOutline', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('lists non-empty headings and strips inline markup', () => {
    const fixture = setup();
    const links = fixture.nativeElement.querySelectorAll('.outline-link');

    expect(links).toHaveLength(3);
    expect(links[0].textContent).toContain('First');
    expect(links[1].textContent).toContain('Second code');
    expect(links[2].textContent).toContain('Clamped');
    expect(fixture.nativeElement.querySelector('.outline-count')?.textContent).toContain('3');
  });

  it('indents headings by level', () => {
    const fixture = setup();
    const links = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
      '.outline-link',
    );

    expect(links[0].style.paddingLeft).toBe('0px');
    expect(links[1].style.paddingLeft).toBe('24px');
    expect(links[2].getAttribute('data-level')).toBe('6');
    expect(links[2].style.paddingLeft).toBe('60px');
  });

  it('highlights the heading at the current scroll position', () => {
    const note = noteWithHeadings();
    const container = document.createElement('div');
    container.className = 'main-scroll';
    const tops = new Map<string, number>();

    note.blocks.forEach((block, index) => {
      if (block.type !== 'heading') return;
      tops.set(block.id, index * 100);
      const wrapper = document.createElement('app-note-block');
      wrapper.setAttribute('data-block-id', block.id);
      const heading = document.createElement('textarea');
      heading.className = 'heading-input';
      heading.getBoundingClientRect = () => rect(tops.get(block.id) ?? 0);
      wrapper.appendChild(heading);
      container.appendChild(wrapper);
    });

    Object.defineProperty(container, 'scrollTop', { value: 0, writable: true });
    Object.defineProperty(container, 'clientHeight', { value: 400, configurable: true });
    Object.defineProperty(container, 'scrollHeight', { value: 1000, configurable: true });
    container.getBoundingClientRect = () => rect(0);
    document.body.appendChild(container);

    try {
      const fixture = setup(note);
      const links = (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
        '.outline-link',
      );

      expect(links[0].classList.contains('active')).toBe(true);

      tops.set(note.blocks[0].id, -200);
      tops.set(note.blocks[1].id, 40);
      container.dispatchEvent(new Event('scroll'));
      fixture.detectChanges();

      expect(links[0].classList.contains('active')).toBe(false);
      expect(links[1].classList.contains('active')).toBe(true);
      expect(links[1].getAttribute('aria-current')).toBe('location');
    } finally {
      container.remove();
    }
  });

  it('emits the heading id when clicked', () => {
    const fixture = setup();
    const selected = vi.fn();
    fixture.componentInstance.selected.subscribe(selected);

    fixture.nativeElement.querySelector('.outline-link').click();

    expect(selected).toHaveBeenCalledWith(fixture.componentInstance.note().blocks[0].id);
  });

  it('emits collapse', () => {
    const fixture = setup();
    const collapse = vi.fn();
    fixture.componentInstance.collapse.subscribe(collapse);

    fixture.nativeElement.querySelector('.outline-collapse').click();

    expect(collapse).toHaveBeenCalled();
  });

  it('keeps the typeface selector in the pinned footer', () => {
    const fixture = setup();

    expect(fixture.nativeElement.querySelector('.outline-footer app-font-selector')).not.toBeNull();
  });

  it('shows an empty message without headings', () => {
    const fixture = setup({ ...createNote(), blocks: [] });

    expect(fixture.nativeElement.querySelector('.outline-empty')?.textContent).toContain(
      'Headings you add will appear here.',
    );
    expect(fixture.nativeElement.querySelector('.outline-count')).toBeNull();
  });
});
