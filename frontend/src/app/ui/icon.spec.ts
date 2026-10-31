import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { Icon, IconName } from './icon';

function render(name: IconName, size?: number, strokeWidth?: number): HTMLElement {
  const fixture = TestBed.createComponent(Icon);
  fixture.componentRef.setInput('name', name);
  if (size !== undefined) fixture.componentRef.setInput('size', size);
  if (strokeWidth !== undefined) fixture.componentRef.setInput('strokeWidth', strokeWidth);
  fixture.detectChanges();
  return fixture.nativeElement as HTMLElement;
}

describe('Icon', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('renders an svg with the default size and stroke width', () => {
    const element = render('plus');
    const svg = element.querySelector('svg')!;

    expect(svg.getAttribute('width')).toBe('18');
    expect(svg.getAttribute('height')).toBe('18');
    expect(svg.getAttribute('stroke-width')).toBe('1.7');
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.querySelectorAll('path')).toHaveLength(1);
  });

  it('honours explicit size and stroke width', () => {
    const svg = render('search', 24, 2).querySelector('svg')!;

    expect(svg.getAttribute('width')).toBe('24');
    expect(svg.getAttribute('height')).toBe('24');
    expect(svg.getAttribute('stroke-width')).toBe('2');
    expect(svg.querySelectorAll('circle')).toHaveLength(1);
  });

  it('renders different paths for different names', () => {
    const plus = render('plus').querySelector('path')?.getAttribute('d');
    const trash = render('trash').querySelector('path')?.getAttribute('d');

    expect(plus).not.toBe(trash);
  });

  it('renders nothing for an unknown name', () => {
    const element = render('unknown' as IconName);

    expect(element.querySelectorAll('path, circle, rect')).toHaveLength(0);
  });
});
