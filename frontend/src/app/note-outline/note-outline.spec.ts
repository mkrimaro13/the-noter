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

  it('shows an empty message without headings', () => {
    const fixture = setup({ ...createNote(), blocks: [] });

    expect(fixture.nativeElement.querySelector('.outline-empty')?.textContent).toContain(
      'Headings you add will appear here.',
    );
    expect(fixture.nativeElement.querySelector('.outline-count')).toBeNull();
  });
});
