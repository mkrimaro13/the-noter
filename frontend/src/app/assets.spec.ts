import { TestBed } from '@angular/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AssetStore,
  assetHash,
  blobToBase64,
  blobToDataUrl,
  dataUrlToBlob,
  hashBlob,
  hashBytes,
  isAssetRef,
  isDataImage,
} from './assets';

function dataUrl(text: string, type = 'image/png'): string {
  return `data:${type};base64,${btoa(text)}`;
}

describe('assets', () => {
  afterEach(() => TestBed.resetTestingModule());

  it('recognises asset references and inline images', () => {
    expect(isAssetRef('asset:abc')).toBe(true);
    expect(isAssetRef('data:image/png;base64,abc')).toBe(false);
    expect(assetHash('asset:abc')).toBe('abc');
    expect(assetHash('https://example.com/a.png')).toBe('https://example.com/a.png');

    expect(isDataImage('data:image/png;base64,abc')).toBe(true);
    expect(isDataImage('data:image/svg+xml,<svg />')).toBe(true);
    expect(isDataImage('https://example.com/a.png')).toBe(false);
  });

  it('round-trips a data URL through a blob', async () => {
    const source = dataUrl('hello');
    const blob = dataUrlToBlob(source);

    expect(blob.type).toBe('image/png');
    expect(await blobToDataUrl(blob)).toBe(source);
    expect(await blobToBase64(blob)).toBe(btoa('hello'));
  });

  it('hashes deterministically and by content', async () => {
    const first = await hashBytes(new TextEncoder().encode('hello'));
    const second = await hashBytes(new TextEncoder().encode('hello'));
    const other = await hashBytes(new TextEncoder().encode('bye'));

    expect(first).toHaveLength(64);
    expect(first).toBe(second);
    expect(first).not.toBe(other);
    expect(await hashBlob(new Blob(['hello']))).toBe(first);
  });

  it('stores, resolves, and reuses blobs by content hash', async () => {
    const store = TestBed.inject(AssetStore);

    const ref = await store.putDataUrl(dataUrl('hello'));
    expect(ref).toMatch(/^asset:[0-9a-f]{64}$/);
    expect(await store.has(ref)).toBe(true);

    const blob = await store.getBlob(ref);
    expect(blob?.type).toBe('image/png');
    expect(await store.resolve(ref)).toMatch(/^(blob:|data:image\/png)/);

    // The same bytes always produce the same reference and never duplicate.
    expect(await store.putDataUrl(dataUrl('hello'))).toBe(ref);
  });

  it('leaves non-data sources untouched and ignores unknown refs', async () => {
    const store = TestBed.inject(AssetStore);

    expect(await store.prepare('https://example.com/a.png')).toBe('https://example.com/a.png');
    expect(await store.prepare('asset:missing')).toBe('asset:missing');
    expect(await store.getBlob('https://example.com/a.png')).toBeNull();
    expect(await store.resolve('https://example.com/a.png')).toBe('https://example.com/a.png');

    const missing = `asset:${'0'.repeat(64)}`;
    expect(await store.has(missing)).toBe(false);
    expect(await store.resolve(missing)).toBe('');
  });
});
