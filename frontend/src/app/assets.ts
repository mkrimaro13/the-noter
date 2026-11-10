import { Injectable, signal } from '@angular/core';

const DB_NAME = 'the-noter.assets.v1';
const STORE_NAME = 'blobs';
const ASSET_PREFIX = 'asset:';

/** True for content-addressed references such as `asset:ab12…`. */
export function isAssetRef(value: string): boolean {
  return value.startsWith(ASSET_PREFIX);
}

/** The hash part of an `asset:` reference. */
export function assetHash(ref: string): string {
  return isAssetRef(ref) ? ref.slice(ASSET_PREFIX.length) : ref;
}

/** True for inline base64 images, which are the ones that must leave the JSON. */
export function isDataImage(value: string): boolean {
  return /^data:image\//i.test(value);
}

/**
 * Turns uploaded images into content-addressed `asset:<hash>` references and
 * keeps the actual bytes in IndexedDB. Notes only store the short reference, so
 * `localStorage` no longer carries the base64 payload.
 *
 * A memory map mirrors every blob written during the session. It is both a
 * fast path and the fallback when IndexedDB is unavailable (private mode,
 * tests, very old browsers).
 */
@Injectable({ providedIn: 'root' })
export class AssetStore {
  /** Bumped whenever a blob is added, so image bindings retry missing refs. */
  readonly revision = signal(0);

  private readonly memory = new Map<string, Blob>();
  private readonly urls = new Map<string, string>();
  private dbPromise: Promise<IDBDatabase | null> | null = null;

  /** Converts inline image data to an asset ref; leaves other sources alone. */
  async prepare(src: string): Promise<string> {
    if (!isDataImage(src)) return src;
    return this.putDataUrl(src);
  }

  async putDataUrl(dataUrl: string): Promise<string> {
    return this.putBlob(dataUrlToBlob(dataUrl));
  }

  /** Stores a blob under its content hash and returns the asset reference. */
  async putBlob(blob: Blob): Promise<string> {
    const hash = await hashBlob(blob);
    const ref = `${ASSET_PREFIX}${hash}`;
    await this.store(ref, blob);
    return ref;
  }

  /** Stores bytes under an already known reference, used when downloading. */
  async putBlobAt(ref: string, blob: Blob): Promise<void> {
    if (!isAssetRef(ref)) return;
    await this.store(ref, blob);
  }

  async getBlob(ref: string): Promise<Blob | null> {
    if (!isAssetRef(ref)) return null;

    const cached = this.memory.get(ref);
    if (cached) return cached;

    const blob = await this.read(ref);
    if (blob) this.memory.set(ref, blob);
    return blob;
  }

  async has(ref: string): Promise<boolean> {
    return (await this.getBlob(ref)) !== null;
  }

  /** Resolves an asset ref to a displayable URL; other sources pass through. */
  async resolve(src: string): Promise<string> {
    if (!isAssetRef(src)) return src;

    const cached = this.urls.get(src);
    if (cached) return cached;

    const blob = await this.getBlob(src);
    if (!blob) return '';

    const url = await blobToUrl(blob);
    if (url) this.urls.set(src, url);
    return url;
  }

  private async store(ref: string, blob: Blob): Promise<void> {
    this.memory.set(ref, blob);
    await this.write(ref, blob);
    this.revision.update((value) => value + 1);
  }

  private openDb(): Promise<IDBDatabase | null> {
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve) => {
      if (typeof indexedDB === 'undefined') {
        resolve(null);
        return;
      }

      let request: IDBOpenDBRequest;
      try {
        request = indexedDB.open(DB_NAME, 1);
      } catch {
        resolve(null);
        return;
      }

      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME);
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(null);
      request.onblocked = () => resolve(null);
    });

    return this.dbPromise;
  }

  private async write(ref: string, blob: Blob): Promise<void> {
    const db = await this.openDb();
    if (!db) return;

    await new Promise<void>((resolve) => {
      try {
        const transaction = db.transaction(STORE_NAME, 'readwrite');
        transaction.objectStore(STORE_NAME).put(blob, ref);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => resolve();
        transaction.onabort = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  private async read(ref: string): Promise<Blob | null> {
    const db = await this.openDb();
    if (!db) return null;

    return new Promise((resolve) => {
      try {
        const transaction = db.transaction(STORE_NAME, 'readonly');
        const request = transaction.objectStore(STORE_NAME).get(ref);
        request.onsuccess = () => resolve(request.result instanceof Blob ? request.result : null);
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
}

/** Parses a data URL into a Blob without relying on `fetch(data:)`. */
export function dataUrlToBlob(dataUrl: string): Blob {
  const match = /^data:([^;,]*)(;base64)?,([\s\S]*)$/i.exec(dataUrl);
  if (!match) throw new Error('Could not read that image.');

  const type = match[1] || 'application/octet-stream';
  const payload = match[3] ?? '';

  if (match[2]) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new Blob([bytes], { type });
  }

  return new Blob([decodeURIComponent(payload)], { type });
}

/** Reads a Blob back into a data URL, used by the backup export. */
export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    if (typeof FileReader === 'undefined') {
      void blob
        .arrayBuffer()
        .then((buffer) => {
          let binary = '';
          const bytes = new Uint8Array(buffer);
          for (const byte of bytes) binary += String.fromCharCode(byte);
          resolve(`data:${blob.type || 'application/octet-stream'};base64,${btoa(binary)}`);
        })
        .catch(reject);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') resolve(reader.result);
      else reject(new Error('Could not read the image.'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the image.'));
    reader.readAsDataURL(blob);
  });
}

/** Base64 payload only, for CouchDB inline attachments. */
export async function blobToBase64(blob: Blob): Promise<string> {
  const dataUrl = await blobToDataUrl(blob);
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}

export async function hashBlob(blob: Blob): Promise<string> {
  return hashBytes(new Uint8Array(await blob.arrayBuffer()));
}

/** SHA-256 when WebCrypto is available, deterministic fallback otherwise. */
export async function hashBytes(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (subtle) {
    try {
      const digest = await subtle.digest('SHA-256', new Uint8Array(bytes));
      return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
    } catch {
      // Fall through to the deterministic fallback below.
    }
  }

  const seeds = [0x811c9dc5, 0x7f4a7c15, 0x9e3779b9, 0x85ebca6b];
  return seeds
    .map((seed) => fnv1a(bytes, seed))
    .join('')
    .padEnd(64, '0')
    .slice(0, 64);
}

function fnv1a(bytes: Uint8Array, seed: number): string {
  let hash = seed >>> 0;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

async function blobToUrl(blob: Blob): Promise<string> {
  if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    try {
      return URL.createObjectURL(blob);
    } catch {
      // jsdom and some embedded browsers do not implement object URLs.
    }
  }

  try {
    return await blobToDataUrl(blob);
  } catch {
    return '';
  }
}
