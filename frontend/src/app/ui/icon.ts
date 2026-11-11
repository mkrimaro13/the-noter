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
  | 'code'
  | 'function'
  | 'subnote'
  | 'x'
  | 'check'
  | 'close'
  | 'menu'
  | 'note'
  | 'upload'
  | 'download'
  | 'move'
  | 'columns'
  | 'smile'
  | 'info'
  | 'chevron-right'
  | 'chevron-down'
  | 'corner-down-right'
  | 'undo'
  | 'redo'
  | 'logo'
  | 'panel-left-close'
  | 'panel-left-open'
  | 'panel-right-close'
  | 'panel-right-open'
  | 'link'
  | 'refresh'
  | 'star'
  | 'star-filled'
  | 'alert';

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
        @case ('code') {
          <path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.5 5l-3 14" />
        }
        @case ('function') {
          <path d="M8 5h8M11 5c-1.7 0-2.2 1-2.5 2.7L7.3 16c-.4 2.6-1.3 3.5-3.1 3.5" />
          <path d="M7 10h6" />
        }
        @case ('subnote') {
          <path d="M5 4h8l3 3v13H5z" />
          <path d="M13 4v4h4M8 12h5M8 15h4" />
          <path d="M16 8h3v12H8v-2" />
        }
        @case ('x') {
          <path d="M6 6l12 12M18 6 6 18" />
        }
        @case ('close') {
          <path d="M6 6l12 12M18 6 6 18" />
        }
        @case ('check') {
          <path d="m5 12 5 5L20 7" />
        }
        @case ('info') {
          <circle cx="12" cy="12" r="9" />
          <path d="M12 16v-4M12 8h.01" />
        }
        @case ('smile') {
          <circle cx="12" cy="12" r="9" />
          <path d="M8.5 14.5a4.5 4.5 0 0 0 7 0" />
          <circle cx="9" cy="10" r="0.85" fill="currentColor" stroke="none" />
          <circle cx="15" cy="10" r="0.85" fill="currentColor" stroke="none" />
        }
        @case ('chevron-right') {
          <path d="m9 6 6 6-6 6" />
        }
        @case ('chevron-down') {
          <path d="m6 9 6 6 6-6" />
        }
        @case ('corner-down-right') {
          <path d="M5 5v7a3 3 0 0 0 3 3h11" />
          <path d="m15 11 4 4-4 4" />
        }
        @case ('undo') {
          <path d="M9 14 4 9l5-5" />
          <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
        }
        @case ('redo') {
          <path d="m15 14 5-5-5-5" />
          <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
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
        @case ('download') {
          <path d="M12 4v12M7 11l5 5 5-5M4 16v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
        }
        @case ('move') {
          <path d="M12 3v18M3 12h18" />
          <path d="m9 6 3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3" />
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
        @case ('link') {
          <path d="M10 13a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1.2 1.2" />
          <path d="M14 11a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1.2-1.2" />
        }
        @case ('refresh') {
          <path d="M21 12a9 9 0 1 1-9-9c2.5 0 4.9 1 6.4 2.6L21 8" />
          <path d="M21 3v5h-5" />
        }
        @case ('alert') {
          <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z" />
          <path d="M12 9v4M12 17h.01" />
        }
        @case ('star') {
          <path d="m12 3.6 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 17l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9Z" />
        }
        @case ('star-filled') {
          <path
            d="m12 3.6 2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 17l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9Z"
            fill="currentColor"
            stroke="none"
          />
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
