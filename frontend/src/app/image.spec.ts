import { afterEach, describe, expect, it, vi } from 'vitest';
import { imageFileToDataUrl } from './image';

function fileOf(type: string, content = 'x', size?: number): File {
  const file = new File([content], 'image', { type });
  if (size !== undefined) {
    Object.defineProperty(file, 'size', { value: size });
  }
  return file;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('imageFileToDataUrl', () => {
  it('rejects files that are not images', async () => {
    await expect(imageFileToDataUrl(fileOf('text/plain'))).rejects.toThrow(
      'That file is not an image.',
    );
  });

  it('rejects images larger than 15 MB', async () => {
    await expect(imageFileToDataUrl(fileOf('image/png', 'x', 16 * 1024 * 1024))).rejects.toThrow(
      'Images must be smaller than 15 MB.',
    );
  });

  it('returns a data URL for a small image', async () => {
    const result = await imageFileToDataUrl(fileOf('image/png', 'small'));

    expect(result.startsWith('data:image/png')).toBe(true);
  });

  it('keeps SVG and GIF files untouched even when large', async () => {
    const svg = await imageFileToDataUrl(fileOf('image/svg+xml', 'svg', 400_000));
    const gif = await imageFileToDataUrl(fileOf('image/gif', 'gif', 400_000));

    expect(svg.startsWith('data:image/svg+xml')).toBe(true);
    expect(gif.startsWith('data:image/gif')).toBe(true);
  });

  it('keeps large photographs that already fit the maximum dimension', async () => {
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 800;
        naturalHeight = 600;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_value: string) {
          this.onload?.();
        }
      },
    );

    const result = await imageFileToDataUrl(fileOf('image/jpeg', 'photo', 400_000));

    expect(result.startsWith('data:image/jpeg')).toBe(true);
  });

  it('scales large photographs down to the maximum dimension', async () => {
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 3200;
        naturalHeight = 1600;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_value: string) {
          this.onload?.();
        }
      },
    );

    const context = {
      imageSmoothingQuality: 'low',
      drawImage: vi.fn(),
    };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
      toDataURL: vi.fn(() => 'data:image/webp;base64,scaled'),
    };
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) =>
      tag === 'canvas' ? (canvas as unknown as HTMLElement) : createElement(tag),
    );

    const result = await imageFileToDataUrl(fileOf('image/jpeg', 'photo', 400_000));

    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(800);
    expect(context.imageSmoothingQuality).toBe('high');
    expect(context.drawImage).toHaveBeenCalled();
    expect(result).toBe('data:image/webp;base64,scaled');
  });

  it('falls back to the original when the canvas has no context', async () => {
    vi.stubGlobal(
      'Image',
      class {
        naturalWidth = 3200;
        naturalHeight = 1600;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_value: string) {
          this.onload?.();
        }
      },
    );
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) =>
      tag === 'canvas'
        ? ({ getContext: () => null } as unknown as HTMLElement)
        : createElement(tag),
    );

    const result = await imageFileToDataUrl(fileOf('image/png', 'photo', 400_000));

    expect(result.startsWith('data:image/png')).toBe(true);
  });

  it('falls back to the original when decoding fails', async () => {
    vi.stubGlobal(
      'Image',
      class {
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        set src(_value: string) {
          this.onerror?.();
        }
      },
    );

    const result = await imageFileToDataUrl(fileOf('image/png', 'photo', 400_000));

    expect(result.startsWith('data:image/png')).toBe(true);
  });
});
