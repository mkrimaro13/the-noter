import { ChangeDetectionStrategy, Component, input } from '@angular/core';

export type IconName =
  | 'plus'
  | 'search'
  | 'trash'
  | 'grip'
  | 'text'
  | 'heading'
  | 'list'
  | 'image'
  | 'x'
  | 'check'
  | 'menu'
  | 'note'
  | 'upload'
  | 'columns'
  | 'logo'
  | 'panel-left-close'
  | 'panel-left-open'
  | 'panel-right-close'
  | 'panel-right-open';

@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <svg
      [attr.width]="size()"
      [attr.height]="size()"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      [attr.stroke-width]="strokeWidth()"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      @switch (name()) {
        @case ('plus') {
          <path d="M12 5v14M5 12h14" />
        }
        @case ('search') {
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        }
        @case ('trash') {
          <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
        }
        @case ('grip') {
          <circle cx="9" cy="6" r="1" fill="currentColor" stroke="none" />
          <circle cx="15" cy="6" r="1" fill="currentColor" stroke="none" />
          <circle cx="9" cy="12" r="1" fill="currentColor" stroke="none" />
          <circle cx="15" cy="12" r="1" fill="currentColor" stroke="none" />
          <circle cx="9" cy="18" r="1" fill="currentColor" stroke="none" />
          <circle cx="15" cy="18" r="1" fill="currentColor" stroke="none" />
        }
        @case ('text') {
          <path d="M4 6h16M4 12h16M4 18h10" />
        }
        @case ('heading') {
          <path d="M6 4v16M18 4v16M6 12h12" />
        }
        @case ('list') {
          <path d="M9 6h11M9 12h11M9 18h11" />
          <circle cx="4.5" cy="6" r="0.9" fill="currentColor" stroke="none" />
          <circle cx="4.5" cy="12" r="0.9" fill="currentColor" stroke="none" />
          <circle cx="4.5" cy="18" r="0.9" fill="currentColor" stroke="none" />
        }
        @case ('image') {
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <circle cx="8.5" cy="9.5" r="1.5" />
          <path d="m21 16-5-5L5 20" />
        }
        @case ('x') {
          <path d="M6 6l12 12M18 6 6 18" />
        }
        @case ('check') {
          <path d="m5 12 5 5L20 7" />
        }
        @case ('menu') {
          <path d="M4 7h16M4 12h16M4 17h16" />
        }
        @case ('note') {
          <path d="M6 3h9l4 4v14H6z" />
          <path d="M15 3v5h5M9 13h7M9 17h5" />
        }
        @case ('upload') {
          <path d="M12 16V4M7 9l5-5 5 5M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
        }
        @case ('columns') {
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M12 4v16" />
        }
        @case ('logo') {
          <rect x="2.5" y="2.5" width="19" height="19" rx="4.5" fill="currentColor" stroke="none" />
          <path d="M7 8h10M7 12h10M7 16h6" stroke="var(--accent-contrast)" />
        }
        @case ('panel-left-close') {
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M9 4v16M17 9l-3 3 3 3" />
        }
        @case ('panel-left-open') {
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M9 4v16M13 9l3 3-3 3" />
        }
        @case ('panel-right-close') {
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M15 4v16M7 9l3 3-3 3" />
        }
        @case ('panel-right-open') {
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M15 4v16M11 9l-3 3 3 3" />
        }
      }
    </svg>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex: none;
    }

    svg {
      display: block;
    }
  `,
})
export class Icon {
  readonly name = input.required<IconName>();
  readonly size = input(18);
  readonly strokeWidth = input(1.7);
}
