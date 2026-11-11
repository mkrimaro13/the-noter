import { TestBed } from '@angular/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AssetStore } from './assets';
import { Note, createNote } from './models';
import { RemoteApply, SyncHandlers, SyncService } from './sync';

const STATE_KEY = 'the-noter.sync.v1';
const CONFLICTS_KEY = 'the-noter.conflicts.v1';
const DISABLED_KEY = 'the-noter.sync.disabled';

function note(id: string, patch: Partial<Note> = {}): Note {
  return { ...createNote(), id, title: id, updatedAt: 10, ...patch };
}

function seedState(
  patch: Partial<{
    since: number | string | null;
    revs: Record<string, string>;
    dirty: string[];
    removed: string[];
  }> = {},
): void {
  localStorage.setItem(
    STATE_KEY,
    JSON.stringify({ since: 0, revs: {}, dirty: [], removed: [], ...patch }),
  );
}

function response(body: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  };
}

function blobResponse(blob: Blob, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => blob,
    text: async () => '',
    blob: async () => blob,
  };
}

const config = {
  enabled: true,
  url: 'http://couch:5984/notes/',
  username: 'user',
  password: 'secret',
};

function handlersFor(notes: Note[]): SyncHandlers & { applyRemote: ReturnType<typeof vi.fn> } {
  const applyRemote = vi.fn((change: RemoteApply) => {
    for (const incoming of change.notes) {
      const note = { ...incoming.data, id: incoming.id } as Note;
      const index = notes.findIndex((existing) => existing.id === note.id);
      if (index >= 0) notes[index] = note;
      else notes.unshift(note);
    }
    for (const copy of change.copies) {
      notes.unshift({ ...copy.data, id: copy.id } as Note);
    }
    for (const id of change.deletes) {
      const index = notes.findIndex((existing) => existing.id === id);
      if (index >= 0) notes.splice(index, 1);
    }
    return true;
  });
  return { getNotes: () => notes, applyRemote };
}

function routeFetch(routes: {
  bulk?: (body: unknown) => unknown;
  changes?: () => unknown;
  doc?: (url: string, init?: RequestInit) => unknown;
  config?: unknown;
  configOk?: boolean;
  asset?: (url: string, init?: RequestInit) => unknown;
  assetBlob?: (url: string) => Blob | null;
  db?: () => unknown;
  maintenance?: () => unknown;
}) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const href = String(url);
    if (href === '/sync-config.json') {
      return routes.configOk === false
        ? response('', false, 404)
        : response('config' in routes ? routes.config : config);
    }
    // parseConfig strips trailing slashes, so the database root is fetched
    // without one even though the fixture keeps it.
    if (href === config.url.replace(/\/+$/, '')) {
      return response(routes.db ? routes.db() : { doc_count: 0 });
    }
    if (decodeURIComponent(href).includes('meta:maintenance')) {
      return response(routes.maintenance ? routes.maintenance() : { firstRun: 1 });
    }
    if (href.endsWith('/_bulk_docs')) {
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      const result = routes.bulk ? routes.bulk(body) : [];
      return result && typeof result === 'object' && 'ok' in result ? result : response(result);
    }
    if (href.includes('/_changes')) {
      return response(routes.changes ? routes.changes() : { results: [], last_seq: 1 });
    }
    if (decodeURIComponent(href).includes('/asset:')) {
      if (href.endsWith('/blob')) {
        const blob = routes.assetBlob ? routes.assetBlob(href) : null;
        return blob ? blobResponse(blob) : response('', false, 404);
      }
      return routes.asset ? routes.asset(href, init) : response({ ok: true });
    }
    if (href.includes('?revs=false') || href.includes('?rev=')) {
      const result = routes.doc ? routes.doc(href, init) : {};
      return result && typeof result === 'object' && 'ok' in result ? result : response(result);
    }
    throw new Error(`Unexpected request: ${href}`);
  });
}

function callsTo(fetchMock: ReturnType<typeof routeFetch>, suffix: string) {
  return fetchMock.mock.calls.filter(([url]) => String(url).includes(suffix));
}

function state(): {
  since: number | string | null;
  revs: Record<string, string>;
  dirty: string[];
  removed: string[];
  assets: string[];
} {
  return JSON.parse(localStorage.getItem(STATE_KEY) ?? '{}');
}

function storedConflicts(): Record<string, unknown> {
  return JSON.parse(localStorage.getItem(CONFLICTS_KEY) ?? '{}');
}

function seedConflict(
  id: string,
  patch: Partial<{
    theirsRev: string;
    theirs: Record<string, unknown> | null;
    origin: string;
    deletedLocally: boolean;
  }> = {},
): void {
  localStorage.setItem(
    CONFLICTS_KEY,
    JSON.stringify({
      [id]: {
        id,
        theirsRev: '2-server',
        theirs: { id, title: 'Server copy', updatedAt: 50, blocks: [], metadata: [] },
        origin: 'push',
        deletedLocally: false,
        at: 1,
        ...patch,
      },
    }),
  );
}

describe('SyncService', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('stays disabled when localStorage asks for offline mode', async () => {
    localStorage.setItem(DISABLED_KEY, '1');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const service = TestBed.inject(SyncService);
    service.start(handlersFor([]));

    await vi.waitFor(() => expect(service.status()).toBe('disabled'));
    expect(service.message()).toContain('Sync is not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('stays disabled when the config file is missing or incomplete', async () => {
    const missing = routeFetch({ configOk: false });
    vi.stubGlobal('fetch', missing);
    const service = TestBed.inject(SyncService);
    service.start(handlersFor([]));

    await vi.waitFor(() => expect(service.status()).toBe('disabled'));

    TestBed.resetTestingModule();

    const incomplete = routeFetch({
      config: { enabled: true, url: 'http://couch', username: '', password: '' },
    });
    vi.stubGlobal('fetch', incomplete);
    const second = TestBed.inject(SyncService);
    second.start(handlersFor([]));

    await vi.waitFor(() => expect(second.status()).toBe('disabled'));
  });

  it('queues dirty ids once and moves deletes between queues', () => {
    const service = TestBed.inject(SyncService);

    service.markDirty('n_a');
    service.markDirty('n_a');
    expect(state().dirty).toEqual(['n_a']);

    service.markDeleted('n_a');
    expect(state().dirty).toEqual([]);
    expect(state().removed).toEqual(['n_a']);

    service.markDirty('n_a');
    expect(state().dirty).toEqual(['n_a']);
    expect(state().removed).toEqual([]);
  });

  it('loads only well-formed pending state', () => {
    localStorage.setItem(
      STATE_KEY,
      JSON.stringify({
        since: '42-abc',
        revs: { n_a: '1-a', bad: 5 },
        dirty: ['n_a', 7, 'n_b'],
        removed: ['n_c', false],
      }),
    );

    const service = TestBed.inject(SyncService);
    service.markDirty('n_new');

    expect(state()).toEqual({
      since: '42-abc',
      revs: { n_a: '1-a' },
      dirty: ['n_a', 'n_b', 'n_new'],
      removed: ['n_c'],
      assets: [],
    });
  });

  it('ignores corrupt pending state', () => {
    localStorage.setItem(STATE_KEY, 'not json');

    const service = TestBed.inject(SyncService);
    service.markDirty('n_a');

    expect(state()).toEqual({ since: null, revs: {}, dirty: ['n_a'], removed: [], assets: [] });
  });

  it('pushes dirty notes, pulls changes, and reports success', async () => {
    const local = note('n_1');
    const handlers = handlersFor([local]);
    const fetchMock = routeFetch({
      bulk: () => [{ id: 'note:n_1', rev: '1-a', ok: true }],
      changes: () => ({ results: [], last_seq: 7 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = TestBed.inject(SyncService);
    service.start(handlers);

    await vi.waitFor(() => expect(service.status()).toBe('synced'));

    expect(service.message()).toContain('Everything is saved');
    expect(service.lastSyncedAt()).not.toBeNull();
    expect(state()).toMatchObject({ since: 7, revs: { n_1: '1-a' }, dirty: [] });

    const bulkCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/_bulk_docs'))!;
    const bulkBody = JSON.parse(String(bulkCall[1]?.body));
    expect(bulkBody.docs[0]).toMatchObject({
      _id: 'note:n_1',
      type: 'note',
      schema: 2,
      title: 'n_1',
    });
    expect(bulkCall[0]).toBe('http://couch:5984/notes/_bulk_docs');
    expect(bulkCall[1]?.headers).toMatchObject({
      authorization: `Basic ${btoa('user:secret')}`,
      'content-type': 'application/json',
    });

    const changesCall = fetchMock.mock.calls.find(([url]) => String(url).includes('/_changes'))!;
    expect(String(changesCall[0])).toContain('since=0');
    expect(String(changesCall[0])).toContain('include_docs=true');
    expect(String(changesCall[0])).toContain('conflicts=true');
  });

  it('applies remote notes and tombstones', async () => {
    seedState({ since: 3 });
    const handlers = handlersFor([note('n_gone', { updatedAt: 1 })]);
    vi.stubGlobal(
      'fetch',
      routeFetch({
        changes: () => ({
          results: [
            {
              id: 'note:n_remote',
              changes: [{ rev: '1-r' }],
              doc: {
                _id: 'note:n_remote',
                _rev: '1-r',
                type: 'note',
                schema: 2,
                title: 'Remote note',
                updatedAt: 100,
                createdAt: 5,
                blocks: [],
                metadata: [],
              },
            },
            {
              id: 'note:n_gone',
              changes: [{ rev: '2-g' }],
              deleted: true,
            },
          ],
          last_seq: 9,
        }),
      }),
    );

    const service = TestBed.inject(SyncService);
    service.start(handlers);

    await vi.waitFor(() => expect(service.status()).toBe('synced'));

    expect(handlers.applyRemote).toHaveBeenCalledWith({
      notes: [
        {
          id: 'n_remote',
          rev: '1-r',
          data: expect.objectContaining({ id: 'n_remote', title: 'Remote note', updatedAt: 100 }),
        },
      ],
      deletes: ['n_gone'],
      copies: [],
    });
    expect(state()).toMatchObject({ since: 9, revs: { n_remote: '1-r' } });
  });

  it('uploads referenced assets before the note document', async () => {
    const assets = TestBed.inject(AssetStore);
    const ref = await assets.putDataUrl(`data:image/png;base64,${btoa('hello')}`);
    const handlers = handlersFor([note('n_1', { cover: ref })]);
    const fetchMock = routeFetch({
      bulk: () => [{ id: 'note:n_1', rev: '1-a', ok: true }],
      changes: () => ({ results: [], last_seq: 7 }),
      asset: () => response({ ok: true }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = TestBed.inject(SyncService);
    service.start(handlers);

    await vi.waitFor(() => expect(service.status()).toBe('synced'));

    const assetIndex = fetchMock.mock.calls.findIndex(
      ([url, init]) =>
        decodeURIComponent(String(url)).includes('/asset:') && init?.method === 'PUT',
    );
    const bulkIndex = fetchMock.mock.calls.findIndex(([url]) =>
      String(url).endsWith('/_bulk_docs'),
    );
    expect(assetIndex).toBeGreaterThanOrEqual(0);
    expect(assetIndex).toBeLessThan(bulkIndex);

    const [assetUrl, assetInit] = fetchMock.mock.calls[assetIndex];
    expect(String(assetUrl)).toBe(
      `http://couch:5984/notes/${encodeURIComponent('asset:' + ref.slice('asset:'.length))}`,
    );
    expect(JSON.parse(String(assetInit?.body))).toMatchObject({
      _id: 'asset:' + ref.slice('asset:'.length),
      type: 'asset',
      schema: 1,
      _attachments: {
        blob: { content_type: 'image/png', data: btoa('hello') },
      },
    });
    expect(state().assets).toContain(ref);
  });

  it('treats an existing asset as already uploaded', async () => {
    const assets = TestBed.inject(AssetStore);
    const ref = await assets.putDataUrl(`data:image/png;base64,${btoa('hello')}`);
    const handlers = handlersFor([note('n_1', { icon: ref })]);
    const fetchMock = routeFetch({
      bulk: () => [{ id: 'note:n_1', rev: '1-a', ok: true }],
      changes: () => ({ results: [], last_seq: 7 }),
      asset: () => response('conflict', false, 409),
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = TestBed.inject(SyncService);
    service.start(handlers);

    await vi.waitFor(() => expect(service.status()).toBe('synced'));
    expect(state().assets).toContain(ref);
    expect(callsTo(fetchMock, '/_bulk_docs')).toHaveLength(1);
  });

  it('downloads assets referenced by pulled notes', async () => {
    seedState({ since: 3 });
    const hash = 'a'.repeat(64);
    const ref = `asset:${hash}`;
    const handlers = handlersFor([]);
    const fetchMock = routeFetch({
      changes: () => ({
        results: [
          {
            id: 'note:n_remote',
            changes: [{ rev: '1-r' }],
            doc: {
              _id: 'note:n_remote',
              _rev: '1-r',
              type: 'note',
              schema: 2,
              title: 'Remote note',
              updatedAt: 100,
              createdAt: 5,
              blocks: [],
              metadata: [],
              icon: ref,
            },
          },
        ],
        last_seq: 9,
      }),
      assetBlob: () => new Blob(['image'], { type: 'image/png' }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = TestBed.inject(SyncService);
    service.start(handlers);

    await vi.waitFor(() => expect(service.status()).toBe('synced'));

    const assets = TestBed.inject(AssetStore);
    expect(await assets.has(ref)).toBe(true);
    const blobCall = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/blob'));
    expect(String(blobCall?.[0])).toBe(
      `http://couch:5984/notes/${encodeURIComponent(`asset:${hash}`)}/blob`,
    );
    expect(state().assets).toContain(ref);
  });

  it('keeps a newer local note and queues it for upload', async () => {
    seedState({ since: 3 });
    const local = note('n_1', { updatedAt: 500 });
    const handlers = handlersFor([local]);
    vi.stubGlobal(
      'fetch',
      routeFetch({
        changes: () => ({
          results: [
            {
              id: 'note:n_1',
              changes: [{ rev: '1-old' }],
              doc: {
                _id: 'note:n_1',
                _rev: '1-old',
                title: 'Old server copy',
                updatedAt: 100,
              },
            },
          ],
          last_seq: 4,
        }),
      }),
    );

    const service = TestBed.inject(SyncService);
    service.start(handlers);

    await vi.waitFor(() => expect(service.status()).toBe('syncing'));

    expect(service.message()).toBe('Finishing sync…');
    expect(state()).toMatchObject({ since: 4, dirty: ['n_1'], revs: { n_1: '1-old' } });
  });

  it('turns a push conflict into a pending decision and freezes the note', async () => {
    seedState({ since: 0, dirty: ['n_1'] });
    const local = note('n_1');
    const handlers = handlersFor([local]);
    vi.stubGlobal(
      'fetch',
      routeFetch({
        bulk: () => [{ id: 'note:n_1', error: 'conflict' }],
        doc: () => ({
          _id: 'note:n_1',
          _rev: '2-server',
          title: 'Server copy',
          updatedAt: 50,
          blocks: [],
          metadata: [],
          createdAt: 1,
        }),
        changes: () => ({ results: [], last_seq: 5 }),
      }),
    );

    const service = TestBed.inject(SyncService);
    service.start(handlers);

    await vi.waitFor(() => expect(service.conflicts()).toHaveLength(1));

    expect(service.conflicts()[0]).toMatchObject({
      id: 'n_1',
      theirsRev: '2-server',
      origin: 'push',
      deletedLocally: false,
    });
    expect(service.conflicts()[0].theirs).toMatchObject({ id: 'n_1', title: 'Server copy' });
    // Nothing is written to the store until the user decides, but the local
    // edit stays queued and the server revision is remembered.
    expect(handlers.applyRemote).not.toHaveBeenCalled();
    expect(state()).toMatchObject({ revs: { n_1: '2-server' }, dirty: ['n_1'] });
    expect(storedConflicts()).toHaveProperty('n_1');
    expect(service.message()).toContain('your decision');
  });

  it('reports a login failure as an error', async () => {
    seedState({ since: 0, dirty: ['n_1'] });
    vi.stubGlobal(
      'fetch',
      routeFetch({
        bulk: () => response('Unauthorized', false, 401),
      }),
    );

    const service = TestBed.inject(SyncService);
    service.start(handlersFor([note('n_1')]));

    await vi.waitFor(() => expect(service.status()).toBe('error'));

    expect(service.message()).toContain('Sync login failed');
  });

  it('reports an unreachable server as offline', async () => {
    seedState({ since: 0, dirty: ['n_1'] });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (String(url) === '/sync-config.json') return response(config);
        throw new TypeError('Failed to fetch');
      }),
    );

    const service = TestBed.inject(SyncService);
    service.start(handlersFor([note('n_1')]));

    await vi.waitFor(() => expect(service.status()).toBe('offline'));

    expect(service.message()).toContain('The server is unreachable');
  });

  it('does not schedule work when nothing is pending', () => {
    const service = TestBed.inject(SyncService);

    service.notifyPersisted();

    expect(service.status()).toBe('idle');
    expect(localStorage.getItem(STATE_KEY)).toBeNull();
  });

  it('treats malformed, incomplete, or unsupported configs as disabled', async () => {
    const configs = [
      null,
      { enabled: false },
      { enabled: true, url: 'ftp://couch/notes', username: 'user', password: 'secret' },
      { enabled: true, url: '/notes', username: '', password: 'secret' },
      { enabled: true, url: 42, username: 'user', password: 'secret' },
    ];

    for (const value of configs) {
      TestBed.resetTestingModule();
      vi.stubGlobal('fetch', routeFetch({ config: value }));
      const service = TestBed.inject(SyncService);
      service.start(handlersFor([]));
      await vi.waitFor(() => expect(service.status()).toBe('disabled'));
    }
  });

  it('stays disabled when the config cannot be fetched or parsed', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('Failed to fetch');
      }),
    );
    const offline = TestBed.inject(SyncService);
    offline.start(handlersFor([]));
    await vi.waitFor(() => expect(offline.status()).toBe('disabled'));

    TestBed.resetTestingModule();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token');
        },
        text: async () => '',
      })),
    );
    const corrupt = TestBed.inject(SyncService);
    corrupt.start(handlersFor([]));
    await vi.waitFor(() => expect(corrupt.status()).toBe('disabled'));
  });

  it('accepts a root-relative config URL and strips trailing slashes', async () => {
    seedState({ since: 0, dirty: ['n_1'] });
    const fetchMock = routeFetch({
      config: { enabled: true, url: '/couchdb/notes/', username: 'user', password: 'secret' },
      bulk: () => [{ id: 'note:n_1', rev: '1-a' }],
      changes: () => ({ results: [], last_seq: 2 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = TestBed.inject(SyncService);
    service.start(handlersFor([note('n_1')]));

    await vi.waitFor(() => expect(service.status()).toBe('synced'));

    expect(String(callsTo(fetchMock, '/_bulk_docs')[0][0])).toBe('/couchdb/notes/_bulk_docs');
  });

  it('reads the config only once when start is called twice', async () => {
    const fetchMock = routeFetch({ changes: () => ({ results: [], last_seq: 1 }) });
    vi.stubGlobal('fetch', fetchMock);

    const service = TestBed.inject(SyncService);
    const handlers = handlersFor([]);
    service.start(handlers);
    service.start(handlers);

    await vi.waitFor(() => expect(service.status()).toBe('synced'));

    expect(
      fetchMock.mock.calls.filter(([url]) => String(url) === '/sync-config.json'),
    ).toHaveLength(1);
  });

  it('schedules a sync after persisted changes', async () => {
    seedState({ since: 0 });
    const fetchMock = routeFetch({
      bulk: () => [{ id: 'note:n_1', rev: '1-a' }],
      changes: () => ({ results: [], last_seq: 2 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = TestBed.inject(SyncService);
    service.start(handlersFor([note('n_1')]));
    await vi.waitFor(() => expect(service.status()).toBe('synced'));

    service.markDirty('n_1');
    service.notifyPersisted();

    await vi.waitFor(() => expect(callsTo(fetchMock, '/_bulk_docs')).toHaveLength(1), {
      timeout: 2000,
      interval: 50,
    });
    await vi.waitFor(() => expect(service.status()).toBe('synced'));
  });

  it('syncs when the browser reconnects or the page becomes visible', async () => {
    seedState({ since: 0 });
    const fetchMock = routeFetch({ changes: () => ({ results: [], last_seq: 2 }) });
    vi.stubGlobal('fetch', fetchMock);

    const service = TestBed.inject(SyncService);
    service.start(handlersFor([]));
    await vi.waitFor(() => expect(service.status()).toBe('synced'));

    const changesBefore = callsTo(fetchMock, '/_changes').length;
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() =>
      expect(callsTo(fetchMock, '/_changes').length).toBeGreaterThan(changesBefore),
    );

    const afterOnline = callsTo(fetchMock, '/_changes').length;
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() =>
      expect(callsTo(fetchMock, '/_changes').length).toBeGreaterThan(afterOnline),
    );
  });

  it('turns a vanished dirty note into a dated tombstone', async () => {
    seedState({ since: 0, dirty: ['n_gone'], revs: { n_gone: '1-old' } });
    const fetchMock = routeFetch({
      bulk: () => [{ id: 'note:n_gone', rev: '2-deleted' }],
      changes: () => ({ results: [], last_seq: 3 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = TestBed.inject(SyncService);
    service.start(handlersFor([]));

    await vi.waitFor(() => expect(service.status()).toBe('synced'));

    const body = JSON.parse(String(callsTo(fetchMock, '/_bulk_docs')[0][1]?.body));
    expect(body.docs).toHaveLength(1);
    expect(body.docs[0]).toMatchObject({
      _id: 'note:n_gone',
      _deleted: true,
      type: 'note',
      _rev: '1-old',
    });
    expect(typeof body.docs[0].deletedAt).toBe('number');
    expect(state()).toMatchObject({ dirty: [], removed: [] });
  });

  it('reports a rejected note and keeps it queued', async () => {
    seedState({ since: 0, dirty: ['n_bad'] });
    vi.stubGlobal(
      'fetch',
      routeFetch({
        bulk: () => [
          42,
          { id: 'other:n_bad', rev: '1-a' },
          { id: 'note:n_bad', error: 'forbidden' },
        ],
      }),
    );

    const service = TestBed.inject(SyncService);
    service.start(handlersFor([note('n_bad')]));

    await vi.waitFor(() => expect(service.status()).toBe('error'));

    expect(service.message()).toBe('CouchDB rejected "n_bad" (forbidden).');
    expect(state().dirty).toEqual(['n_bad']);
  });

  it('reports an unexpected bulk response', async () => {
    seedState({ since: 0, dirty: ['n_1'] });
    vi.stubGlobal('fetch', routeFetch({ bulk: () => ({}) }));

    const service = TestBed.inject(SyncService);
    service.start(handlersFor([note('n_1')]));

    await vi.waitFor(() => expect(service.status()).toBe('error'));

    expect(service.message()).toBe('Unexpected response from CouchDB.');
  });

  it('drops the revision when the server no longer has the note', async () => {
    seedState({ since: 0, dirty: ['n_1'], revs: { n_1: '1-old' } });
    vi.stubGlobal(
      'fetch',
      routeFetch({
        bulk: () => [{ id: 'note:n_1', error: 'not_found' }],
        changes: () => ({ results: [], last_seq: 2 }),
      }),
    );

    const service = TestBed.inject(SyncService);
    service.start(handlersFor([note('n_1')]));

    await vi.waitFor(() => expect(service.status()).toBe('syncing'));

    expect(state()).toMatchObject({ dirty: ['n_1'], revs: {} });
  });

  it('keeps the edit queued when a conflict revision has vanished', async () => {
    seedState({ since: 0, dirty: ['n_1'], revs: { n_1: '1-old' } });
    const fetchMock = routeFetch({
      bulk: () => [{ id: 'note:n_1', error: 'conflict' }],
      doc: () => response('', false, 404),
      changes: () => ({ results: [], last_seq: 2 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const handlers = handlersFor([note('n_1')]);
    const service = TestBed.inject(SyncService);
    service.start(handlers);

    await vi.waitFor(() => expect(service.status()).toBe('syncing'));

    expect(handlers.applyRemote).not.toHaveBeenCalled();
    expect(state()).toMatchObject({ dirty: ['n_1'], revs: {} });
  });

  it('registers server conflict branches as a pending decision', async () => {
    seedState({ since: 3 });
    const fetchMock = routeFetch({
      changes: () => ({
        results: [
          {
            id: 'note:n_1',
            changes: [{ rev: '1-win' }],
            doc: {
              _id: 'note:n_1',
              _rev: '1-win',
              schema: 2,
              title: 'Winning copy',
              updatedAt: 50,
              blocks: [],
              metadata: [],
              _conflicts: ['2-lose'],
            },
          },
        ],
        last_seq: 10,
      }),
      doc: (url, init) => {
        if (init?.method === 'DELETE') return response({ ok: true });
        return {
          _id: 'note:n_1',
          _rev: '2-lose',
          title: 'Losing copy',
          updatedAt: 40,
          blocks: [],
          metadata: [],
        };
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    const handlers = handlersFor([]);
    const service = TestBed.inject(SyncService);
    service.start(handlers);

    await vi.waitFor(() => expect(service.conflicts()).toHaveLength(1));

    expect(service.conflicts()[0]).toMatchObject({
      id: 'n_1',
      theirsRev: '2-lose',
      origin: 'pull',
    });
    expect(service.conflicts()[0].theirs).toMatchObject({ id: 'n_1', title: 'Losing copy' });
    // The winning note is applied normally; the losing revision survives on
    // the server until the user decides.
    const applied = handlers.applyRemote.mock.calls[0][0];
    expect(applied.notes[0].data['title']).toBe('Winning copy');
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    expect(state()).toMatchObject({ since: 10, revs: { n_1: '1-win' } });
  });

  it('keeps the losing revision registered when the store cannot save', async () => {
    seedState({ since: 3 });
    const fetchMock = routeFetch({
      changes: () => ({
        results: [
          {
            id: 'note:n_1',
            changes: [{ rev: '1-win' }],
            doc: {
              _id: 'note:n_1',
              _rev: '1-win',
              schema: 2,
              title: 'Winning copy',
              updatedAt: 50,
              _conflicts: ['2-lose'],
            },
          },
        ],
        last_seq: 10,
      }),
      doc: () => ({
        _id: 'note:n_1',
        _rev: '2-lose',
        title: 'Losing copy',
        updatedAt: 40,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const handlers = handlersFor([]);
    handlers.applyRemote.mockReturnValue(false);
    const service = TestBed.inject(SyncService);
    service.start(handlers);

    await vi.waitFor(() => expect(service.conflicts()).toHaveLength(1));

    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'DELETE')).toBe(false);
    expect(storedConflicts()).toHaveProperty('n_1');
  });

  it('defers tombstones and documents that have pending local work', async () => {
    seedState({
      since: 3,
      dirty: ['n_edit', 'n_edit_two'],
      removed: ['n_removed'],
    });
    vi.stubGlobal(
      'fetch',
      routeFetch({
        changes: () => ({
          results: [
            { id: 'note:n_edit', changes: [{ rev: '2-delete' }], deleted: true },
            { id: 'note:n_edit_two', changes: [{ rev: '2-edit' }], doc: { updatedAt: 9 } },
            { id: 'note:n_removed', changes: [{ rev: '2-removed' }], doc: { updatedAt: 9 } },
          ],
          last_seq: 4,
        }),
      }),
    );

    const handlers = handlersFor([note('n_edit'), note('n_edit_two')]);
    const service = TestBed.inject(SyncService);
    service.start(handlers);

    await vi.waitFor(() => expect(service.status()).toBe('syncing'));

    expect(service.message()).toBe('Finishing sync…');
    expect(handlers.applyRemote).not.toHaveBeenCalled();
    expect(state()).toMatchObject({
      since: 4,
      revs: { n_edit: '2-delete', n_edit_two: '2-edit' },
      dirty: ['n_edit', 'n_edit_two'],
      removed: ['n_removed'],
    });
  });

  it('ignores malformed change rows and uses the document revision as a fallback', async () => {
    seedState({ since: 3 });
    vi.stubGlobal(
      'fetch',
      routeFetch({
        changes: () => ({
          results: [
            42,
            { id: 'other:n_1', changes: [] },
            { id: 'note:n_missing_doc', changes: [{ rev: '1-a' }] },
            {
              id: 'note:n_doc',
              doc: { _rev: '1-doc', schema: 2, title: 'From doc', updatedAt: 5, _conflicts: [42] },
            },
          ],
          last_seq: 'seq-2',
        }),
      }),
    );

    const handlers = handlersFor([]);
    const service = TestBed.inject(SyncService);
    service.start(handlers);

    await vi.waitFor(() => expect(service.status()).toBe('synced'));

    expect(handlers.applyRemote).toHaveBeenCalledWith({
      notes: [
        {
          id: 'n_doc',
          rev: '1-doc',
          data: expect.objectContaining({ id: 'n_doc', title: 'From doc' }),
        },
      ],
      deletes: [],
      copies: [],
    });
    expect(state()).toMatchObject({ since: 'seq-2', revs: { n_doc: '1-doc' } });
  });

  it('reports malformed changes responses and server errors with details', async () => {
    seedState({ since: 0 });
    vi.stubGlobal('fetch', routeFetch({ changes: () => null }));
    const malformed = TestBed.inject(SyncService);
    malformed.start(handlersFor([]));
    await vi.waitFor(() => expect(malformed.status()).toBe('error'));
    expect(malformed.message()).toBe('Unexpected response from CouchDB.');

    TestBed.resetTestingModule();
    seedState({ since: 0, dirty: ['n_1'] });
    vi.stubGlobal('fetch', routeFetch({ bulk: () => response('Bad request', false, 400) }));
    const rejected = TestBed.inject(SyncService);
    rejected.start(handlersFor([note('n_1')]));
    await vi.waitFor(() => expect(rejected.status()).toBe('error'));
    expect(rejected.message()).toBe('CouchDB answered 400: Bad request');
  });

  it('survives unreadable state and unwritable storage', async () => {
    localStorage.setItem(STATE_KEY, JSON.stringify({ since: false, revs: [], dirty: 'nope' }));
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceeded');
    });

    const service = TestBed.inject(SyncService);
    expect(() => service.markDirty('n_1')).not.toThrow();
    expect(service.status()).toBe('idle');
  });

  it('reads the config when localStorage is unavailable', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('Storage is blocked');
    });
    const fetchMock = routeFetch({ changes: () => ({ results: [], last_seq: 1 }) });
    vi.stubGlobal('fetch', fetchMock);

    const service = TestBed.inject(SyncService);
    service.start(handlersFor([]));

    await vi.waitFor(() => expect(service.status()).toBe('synced'));
    expect(fetchMock.mock.calls.some(([url]) => String(url) === '/sync-config.json')).toBe(true);
  });

  it('reloads pending conflicts from storage', () => {
    seedConflict('n_1', { origin: 'pull', theirsRev: '9-lose' });
    localStorage.removeItem(STATE_KEY);

    const service = TestBed.inject(SyncService);

    expect(service.conflicts()).toHaveLength(1);
    expect(service.conflicts()[0]).toMatchObject({
      id: 'n_1',
      theirsRev: '9-lose',
      origin: 'pull',
      deletedLocally: false,
    });
  });

  it('holds pushes for notes with a pending conflict', async () => {
    seedState({ since: 0, dirty: ['n_1', 'n_2'] });
    seedConflict('n_1');
    const fetchMock = routeFetch({
      bulk: () => [{ id: 'note:n_2', rev: '2-b' }],
      changes: () => ({ results: [], last_seq: 2 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = TestBed.inject(SyncService);
    service.start(handlersFor([note('n_1'), note('n_2')]));

    await vi.waitFor(() => expect(service.status()).toBe('synced'));

    const body = JSON.parse(String(callsTo(fetchMock, '/_bulk_docs')[0][1]?.body));
    expect(body.docs).toHaveLength(1);
    expect(body.docs[0]['_id']).toBe('note:n_2');
    // The conflicted note stays queued but does not count as pending work,
    // so the retry loop stops while the user decides.
    expect(state().dirty).toEqual(['n_1']);
    expect(service.pendingCount()).toBe(0);
  });

  it('holds remote changes for notes with a pending conflict', async () => {
    seedState({ since: 3 });
    seedConflict('n_remote', { origin: 'pull', theirsRev: '2-lose' });
    const fetchMock = routeFetch({
      changes: () => ({
        results: [
          {
            id: 'note:n_remote',
            changes: [{ rev: '1-r' }],
            doc: {
              _id: 'note:n_remote',
              _rev: '1-r',
              schema: 2,
              title: 'Remote',
              updatedAt: 100,
              blocks: [],
              metadata: [],
            },
          },
        ],
        last_seq: 5,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const handlers = handlersFor([]);
    const service = TestBed.inject(SyncService);
    service.start(handlers);

    await vi.waitFor(() => expect(service.status()).toBe('synced'));

    expect(handlers.applyRemote).not.toHaveBeenCalled();
    expect(state()).toMatchObject({ since: 5, revs: {} });
  });

  it('does not duplicate a conflict when the same branch is seen again', async () => {
    seedState({ since: 3 });
    const fetchMock = routeFetch({
      changes: () => ({
        results: [
          {
            id: 'note:n_1',
            changes: [{ rev: '1-win' }],
            doc: {
              _id: 'note:n_1',
              _rev: '1-win',
              schema: 2,
              title: 'Winning copy',
              updatedAt: 50,
              blocks: [],
              metadata: [],
              _conflicts: ['2-lose'],
            },
          },
        ],
        last_seq: 10,
      }),
      doc: () => ({
        _id: 'note:n_1',
        _rev: '2-lose',
        schema: 2,
        title: 'Losing copy',
        updatedAt: 40,
        blocks: [],
        metadata: [],
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const handlers = handlersFor([]);
    const service = TestBed.inject(SyncService);
    service.start(handlers);

    await vi.waitFor(() => expect(service.status()).toBe('synced'));

    await service.syncNow();

    expect(service.conflicts()).toHaveLength(1);
    const losingFetches = fetchMock.mock.calls.filter(([url]) =>
      decodeURIComponent(String(url)).includes('rev=2-lose'),
    );
    expect(losingFetches).toHaveLength(1);
  });

  it('retries the local version when the user keeps this device', async () => {
    seedState({ since: 0, dirty: ['n_1'], revs: { n_1: '2-server' } });
    seedConflict('n_1', { theirsRev: '2-server' });
    const fetchMock = routeFetch({
      bulk: () => [{ id: 'note:n_1', rev: '3-local' }],
      changes: () => ({ results: [], last_seq: 2 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const handlers = handlersFor([note('n_1', { title: 'Local copy', updatedAt: 99 })]);
    const service = TestBed.inject(SyncService);
    service.start(handlers);

    await vi.waitFor(() => expect(service.status()).toBe('synced'));

    await service.resolveConflict('n_1', 'mine');
    await service.syncNow();

    // The local edit is written against the server revision.
    const body = JSON.parse(String(callsTo(fetchMock, '/_bulk_docs')[0][1]?.body));
    expect(body.docs[0]).toMatchObject({ _id: 'note:n_1', _rev: '2-server', title: 'Local copy' });
    expect(state()).toMatchObject({ dirty: [], revs: { n_1: '3-local' } });
    expect(service.conflicts()).toHaveLength(0);
    expect(storedConflicts()).toEqual({});
  });

  it('keeps the deletion when the user keeps this device on a delete conflict', async () => {
    seedState({ since: 0, removed: ['n_1'], revs: { n_1: '2-server' } });
    seedConflict('n_1', { theirsRev: '2-server', deletedLocally: true });
    const fetchMock = routeFetch({
      bulk: () => [{ id: 'note:n_1', rev: '3-gone' }],
      changes: () => ({ results: [], last_seq: 2 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const handlers = handlersFor([]);
    const service = TestBed.inject(SyncService);
    service.start(handlers);

    await vi.waitFor(() => expect(service.status()).toBe('synced'));

    await service.resolveConflict('n_1', 'mine');
    await service.syncNow();

    const body = JSON.parse(String(callsTo(fetchMock, '/_bulk_docs')[0][1]?.body));
    expect(body.docs[0]).toMatchObject({
      _id: 'note:n_1',
      _deleted: true,
      _rev: '2-server',
    });
    expect(state()).toMatchObject({ dirty: [], removed: [] });
    expect(storedConflicts()).toEqual({});
  });

  it('adopts the server version when the user keeps the server', async () => {
    seedState({ since: 0, dirty: ['n_1'], revs: { n_1: '2-server' } });
    seedConflict('n_1', {
      theirsRev: '2-server',
      theirs: { id: 'n_1', title: 'Server copy', updatedAt: 50, blocks: [], metadata: [] },
    });
    const fetchMock = routeFetch({
      bulk: () => [{ id: 'note:n_1', rev: '3-x' }],
      changes: () => ({ results: [], last_seq: 2 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const handlers = handlersFor([note('n_1', { title: 'Local copy', updatedAt: 99 })]);
    const service = TestBed.inject(SyncService);
    service.start(handlers);

    await vi.waitFor(() => expect(service.status()).toBe('synced'));

    await service.resolveConflict('n_1', 'theirs');

    const applied = handlers.applyRemote.mock.calls[0][0];
    expect(applied).toMatchObject({ force: true });
    expect(applied.notes[0]).toMatchObject({ id: 'n_1', rev: '2-server' });
    expect(handlers.getNotes()[0].title).toBe('Server copy');
    // The server already has this version: nothing is queued for upload.
    expect(state()).toMatchObject({ dirty: [], removed: [] });
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/_bulk_docs'))).toBe(false);
    expect(storedConflicts()).toEqual({});
  });

  it('adopts the losing branch and pushes it when the user keeps the server', async () => {
    seedState({ since: 0, revs: { n_1: '1-win' } });
    seedConflict('n_1', {
      origin: 'pull',
      theirsRev: '2-lose',
      theirs: {
        id: 'n_1',
        title: 'Losing copy',
        updatedAt: 40,
        blocks: [],
        metadata: [],
      },
    });
    const fetchMock = routeFetch({
      bulk: () => [{ id: 'note:n_1', rev: '3-kept' }],
      changes: () => ({ results: [], last_seq: 2 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const handlers = handlersFor([note('n_1', { title: 'Winning copy', updatedAt: 50 })]);
    const service = TestBed.inject(SyncService);
    service.start(handlers);

    await vi.waitFor(() => expect(service.status()).toBe('synced'));

    await service.resolveConflict('n_1', 'theirs');
    await service.syncNow();

    // The losing revision leaves the server only after the decision.
    const deletes = fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE');
    expect(deletes).toHaveLength(1);
    expect(String(deletes[0][0])).toContain('rev=2-lose');

    // The adopted version overwrites the winner.
    const body = JSON.parse(String(callsTo(fetchMock, '/_bulk_docs')[0][1]?.body));
    expect(body.docs[0]).toMatchObject({ _id: 'note:n_1', _rev: '1-win', title: 'Losing copy' });
    expect(handlers.getNotes()[0].title).toBe('Losing copy');
    expect(storedConflicts()).toEqual({});
  });

  it('keeps the winning version when the user keeps this device', async () => {
    seedState({ since: 0, revs: { n_1: '1-win' } });
    seedConflict('n_1', {
      origin: 'pull',
      theirsRev: '2-lose',
      theirs: {
        id: 'n_1',
        title: 'Losing copy',
        updatedAt: 40,
        blocks: [],
        metadata: [],
      },
    });
    const fetchMock = routeFetch({ changes: () => ({ results: [], last_seq: 2 }) });
    vi.stubGlobal('fetch', fetchMock);

    const handlers = handlersFor([note('n_1', { title: 'Winning copy', updatedAt: 50 })]);
    const service = TestBed.inject(SyncService);
    service.start(handlers);

    await vi.waitFor(() => expect(service.status()).toBe('synced'));

    await service.resolveConflict('n_1', 'mine');

    // The local copy already matches the winning revision, so nothing is
    // pushed; only the losing revision is dropped from the server.
    expect(state()).toMatchObject({ dirty: [], removed: [] });
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/_bulk_docs'))).toBe(false);
    const deletes = fetchMock.mock.calls.filter(([, init]) => init?.method === 'DELETE');
    expect(deletes).toHaveLength(1);
    expect(String(deletes[0][0])).toContain('rev=2-lose');
    expect(storedConflicts()).toEqual({});
  });

  it('keeps both versions when the user asks for both', async () => {
    seedState({ since: 0, dirty: ['n_1'], revs: { n_1: '2-server' } });
    seedConflict('n_1', {
      theirsRev: '2-server',
      theirs: {
        id: 'n_1',
        title: 'Server copy',
        updatedAt: 50,
        blocks: [{ id: 'b_1', type: 'text', text: 'server text' }],
        metadata: [],
      },
    });
    const fetchMock = routeFetch({
      bulk: () => [{ id: 'note:n_1', rev: '3-local' }],
      changes: () => ({ results: [], last_seq: 2 }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const handlers = handlersFor([note('n_1', { title: 'Local copy', updatedAt: 99 })]);
    const service = TestBed.inject(SyncService);
    service.start(handlers);

    await vi.waitFor(() => expect(service.status()).toBe('synced'));

    await service.resolveConflict('n_1', 'both');
    await service.syncNow();

    // The server version survives as its own note.
    expect(handlers.getNotes()).toHaveLength(2);
    const copy = handlers.getNotes().find((item) => item.id !== 'n_1')!;
    expect(copy.title).toMatch(/^Server copy \(conflict .+\)$/);
    // The local version is pushed against the server revision.
    const body = JSON.parse(String(callsTo(fetchMock, '/_bulk_docs')[0][1]?.body));
    expect(body.docs[0]).toMatchObject({ _id: 'note:n_1', _rev: '2-server', title: 'Local copy' });
    expect(storedConflicts()).toEqual({});
  });

  it('migrates legacy documents on pull and pushes the upgraded version', async () => {
    seedState({ since: 3 });
    let pulls = 0;
    const fetchMock = routeFetch({
      bulk: (raw) => {
        const body = raw as { docs: Array<{ _id: string }> };
        return body.docs.map((doc) => ({ id: doc._id, rev: '2-mig' }));
      },
      changes: () => {
        pulls += 1;
        return pulls === 1
          ? {
              results: [
                {
                  id: 'note:n_legacy',
                  changes: [{ rev: '1-old' }],
                  doc: {
                    _id: 'note:n_legacy',
                    _rev: '1-old',
                    type: 'note',
                    title: 'Legacy doc',
                    updatedAt: 100,
                    createdAt: 5,
                    blocks: [],
                    metadata: [{ id: 'm_1', key: 'Tag', value: 'x' }],
                  },
                },
              ],
              last_seq: 4,
            }
          : { results: [], last_seq: 4 };
      },
    });
    vi.stubGlobal('fetch', fetchMock);

    const handlers = handlersFor([]);
    const service = TestBed.inject(SyncService);
    service.start(handlers);

    // The pulled note lands with typed metadata and is queued for re-upload.
    await vi.waitFor(() => expect(handlers.applyRemote).toHaveBeenCalled());
    const applied = handlers.applyRemote.mock.calls[0][0];
    expect(applied.notes[0].data['metadata']).toEqual([
      { id: 'm_1', key: 'Tag', value: 'x', type: 'text', options: [] },
    ]);
    expect(state().dirty).toContain('n_legacy');

    await service.syncNow();

    const body = JSON.parse(String(callsTo(fetchMock, '/_bulk_docs')[0][1]?.body));
    expect(body.docs[0]).toMatchObject({ _id: 'note:n_legacy', _rev: '1-old', schema: 2 });
    expect(body.docs[0]['metadata']).toEqual([
      { id: 'm_1', key: 'Tag', value: 'x', type: 'text', options: [] },
    ]);
    expect(state()).toMatchObject({ dirty: [], revs: { n_legacy: '2-mig' } });
    expect(service.status()).toBe('synced');
  });

  it('runs a full pass on demand and reads the diagnostics', async () => {
    seedState({ since: 0, dirty: ['n_1'] });
    const fetchMock = routeFetch({
      bulk: () => [{ id: 'note:n_1', rev: '1-a' }],
      changes: () => ({ results: [], last_seq: 2 }),
      db: () => ({ doc_count: 7, doc_del_count: 2, purge_seq: '3-g', compact_running: false }),
      maintenance: () => ({
        firstRun: 10,
        lastCompaction: 20,
        lastPurge: 30,
        purged: 4,
        intervalSeconds: 3600,
      }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const service = TestBed.inject(SyncService);
    service.start(handlersFor([note('n_1')]));

    await vi.waitFor(() => expect(service.status()).toBe('synced'));

    await service.syncNow();

    expect(service.status()).toBe('synced');
    expect(service.lastSyncedAt()).not.toBeNull();
    expect(service.diagnostics()).toMatchObject({
      docCount: 7,
      deletedCount: 2,
      purgeSeq: '3-g',
      compactRunning: false,
    });
    expect(service.diagnostics()!.maintenance).toMatchObject({
      lastCompaction: 20,
      lastPurge: 30,
      purged: 4,
      intervalSeconds: 3600,
    });
  });

  it('tolerates a missing maintenance document', async () => {
    seedState({ since: 0 });
    vi.stubGlobal(
      'fetch',
      routeFetch({
        changes: () => ({ results: [], last_seq: 1 }),
        db: () => ({ doc_count: 3, compact_running: true }),
        maintenance: () => {
          throw new Error('missing');
        },
      }),
    );

    const service = TestBed.inject(SyncService);
    service.start(handlersFor([]));
    await vi.waitFor(() => expect(service.status()).toBe('synced'));

    await service.syncNow();

    expect(service.diagnostics()).toMatchObject({ docCount: 3, compactRunning: true });
    expect(service.diagnostics()!.maintenance).toBeNull();
  });

  it('keeps the last diagnostics when the counters cannot be read', async () => {
    seedState({ since: 0 });
    vi.stubGlobal(
      'fetch',
      routeFetch({
        changes: () => ({ results: [], last_seq: 1 }),
        db: () => ({ doc_count: 5, doc_del_count: 1 }),
        maintenance: () => ({ lastPurge: 9 }),
      }),
    );

    const service = TestBed.inject(SyncService);
    service.start(handlersFor([]));
    await vi.waitFor(() => expect(service.status()).toBe('synced'));

    await service.syncNow();
    expect(service.diagnostics()).toMatchObject({ docCount: 5 });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('network down');
      }),
    );
    await service.refreshDiagnostics();

    expect(service.diagnostics()).toMatchObject({ docCount: 5 });
  });
});
