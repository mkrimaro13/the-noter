import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { AssetStore, assetHash, blobToBase64, isAssetRef } from './assets';
import { Note, uid } from './models';
import { CURRENT_SCHEMA, migrateNoteDoc } from './schema';

const CONFIG_URL = '/sync-config.json';
const STATE_KEY = 'the-noter.sync.v1';
const CONFLICTS_KEY = 'the-noter.conflicts.v1';
/** Set to `1` to run the app without a server (used by offline/automation runs). */
const DISABLED_KEY = 'the-noter.sync.disabled';
const SYNC_DELAY = 400;
const PUSH_RETRY_BASE = 5_000;
const PUSH_RETRY_MAX = 60_000;
const POLL_INTERVAL = 30_000;
const REQUEST_TIMEOUT = 15_000;
/** Document id where the backend maintenance script records its progress. */
const MAINTENANCE_DOC_ID = 'meta:maintenance';

export type SyncStatus = 'disabled' | 'idle' | 'syncing' | 'synced' | 'offline' | 'error';

interface SyncConfig {
  enabled: boolean;
  url?: string;
  username?: string;
  password?: string;
}

interface SyncState {
  /** Last `_changes` sequence that was applied. */
  since: number | string | null;
  /** Known CouchDB revision for every note that exists on the server. */
  revs: Record<string, string>;
  /** Notes changed locally and waiting to be pushed. */
  dirty: string[];
  /** Notes deleted locally and waiting for a tombstone push. */
  removed: string[];
  /** Asset refs already present on the server. */
  assets: string[];
}

/** A note document as it travels between the store and CouchDB. */
export interface RemoteNoteDoc {
  id: string;
  rev: string;
  /** Note fields with `id` filled in; CouchDB metadata is stripped. */
  data: Record<string, unknown>;
}

export interface RemoteApply {
  notes: RemoteNoteDoc[];
  deletes: string[];
  /** Losing conflict revisions, copied into new notes so nothing is lost. */
  copies: RemoteNoteDoc[];
  /**
   * Skips the "a newer local note wins" guard so a conflict resolution is
   * applied even when the local copy looks newer.
   */
  force?: boolean;
}

/** What the user picked for a sync conflict. */
export type ConflictChoice = 'mine' | 'theirs' | 'both';

/** Where a conflict was detected; it changes what resolution has to do. */
export type ConflictOrigin = 'push' | 'pull';

export interface NoteConflict {
  /** Note id the conflict is about. */
  id: string;
  /** Revision of the other side, used to dedup repeated detections. */
  theirsRev: string;
  /** The other side's note fields, or null when it is gone from the server. */
  theirs: Record<string, unknown> | null;
  origin: ConflictOrigin;
  /** True when the local side is a delete waiting to be pushed. */
  deletedLocally: boolean;
  at: number;
}

/** Progress of the backend compaction/purge schedule, read from `meta:maintenance`. */
export interface MaintenanceInfo {
  firstRun: number | null;
  lastCompaction: number | null;
  lastPurge: number | null;
  purged: number | null;
  intervalSeconds: number | null;
}

/** Server-side counters shown by the sync diagnostics popover. */
export interface SyncDiagnostics {
  at: number;
  docCount: number | null;
  deletedCount: number | null;
  purgeSeq: number | string | null;
  compactRunning: boolean | null;
  maintenance: MaintenanceInfo | null;
}

export interface SyncHandlers {
  getNotes(): Note[];
  /** Returns false when the change could not be written to localStorage. */
  applyRemote(change: RemoteApply): boolean;
}

class SyncHttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'SyncHttpError';
  }
}

class SyncError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SyncError';
  }
}

/**
 * Local-first, write-through sync.
 *
 * The note store writes to `localStorage` immediately and then calls
 * {@link notifyPersisted}. This service only talks to CouchDB after that call,
 * so the browser copy is always the first one written. Pending note ids are
 * kept in `localStorage` too, which means a change made while the server is
 * down is pushed on the next start.
 */
@Injectable({ providedIn: 'root' })
export class SyncService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly assets = inject(AssetStore);

  /** Current sync state, rendered by the sidebar. */
  readonly status = signal<SyncStatus>('idle');
  /** Human-readable explanation for the current status. */
  readonly message = signal('Waiting to sync.');
  readonly lastSyncedAt = signal<number | null>(null);
  /** Conflicts waiting for the user's decision. */
  readonly conflicts = signal<NoteConflict[]>([]);
  /** Local edits and deletes that still need a push, ignoring conflicted ids. */
  readonly pendingCount = signal(0);
  /** Last server-side counters read by {@link refreshDiagnostics}. */
  readonly diagnostics = signal<SyncDiagnostics | null>(null);

  private config: SyncConfig | null = null;
  private handlers: SyncHandlers | null = null;
  private state: SyncState = loadState();
  private conflictMap: Record<string, NoteConflict> = loadConflicts();
  private running = false;
  private again = false;
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private started = false;

  constructor() {
    this.conflicts.set(Object.values(this.conflictMap));
    this.refreshPending();
  }

  start(handlers: SyncHandlers): void {
    if (this.started) return;
    this.started = true;
    this.handlers = handlers;

    void this.bootstrap();
  }

  /**
   * Called by the store after the notes array was written to `localStorage`.
   * This is the only place that starts a normal sync, which keeps the local
   * write strictly before the network write.
   */
  notifyPersisted(): void {
    if (!this.config?.enabled) return;
    if (this.pendingCount() === 0) return;
    if (this.running) {
      this.again = true;
      return;
    }
    this.schedule(SYNC_DELAY);
  }

  /** Records a note that must be sent to CouchDB. */
  markDirty(noteId: string): void {
    if (this.state.removed.includes(noteId)) {
      this.state.removed = this.state.removed.filter((id) => id !== noteId);
    }
    if (!this.state.dirty.includes(noteId)) {
      this.state.dirty.push(noteId);
      this.saveState();
    }
  }

  /** Records a local delete so it travels as a CouchDB tombstone. */
  markDeleted(noteId: string): void {
    this.state.dirty = this.state.dirty.filter((id) => id !== noteId);
    if (!this.state.removed.includes(noteId)) {
      this.state.removed.push(noteId);
      this.saveState();
    }
  }

  private async bootstrap(): Promise<void> {
    const config = await this.readConfig();
    if (!config.enabled) {
      this.config = config;
      this.status.set('disabled');
      this.message.set('Sync is not configured. Notes stay in this browser.');
      return;
    }

    this.config = config;

    // A fresh sync state (or one that never reached the server) must push the
    // notes that already exist in localStorage before pulling anything.
    if (this.state.since === null && Object.keys(this.state.revs).length === 0) {
      for (const note of this.handlers?.getNotes() ?? []) this.markDirty(note.id);
    }

    this.status.set('idle');
    this.message.set('Waiting to sync.');

    const onOnline = () => {
      this.failures = 0;
      void this.runSync(true);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void this.runSync(true);
    };

    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);
    this.pollTimer = setInterval(() => {
      if (document.visibilityState !== 'hidden') void this.runSync(true);
    }, POLL_INTERVAL);

    this.destroyRef.onDestroy(() => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(this.pollTimer);
      this.clearTimer();
    });

    void this.runSync(true);
  }

  /**
   * Runs a full pass immediately, for the sidebar's "Sync now" button. Unlike
   * the background triggers this always shows the syncing state.
   */
  async syncNow(): Promise<void> {
    await this.runSync(false);
    await this.refreshDiagnostics();
  }

  private async runSync(quiet = false): Promise<void> {
    if (!this.config?.enabled || !this.handlers) return;
    if (this.running) {
      this.again = true;
      return;
    }

    this.running = true;
    this.again = false;
    this.clearTimer();

    const hasPending = this.pendingCount() > 0;
    if (!quiet || hasPending) this.status.set('syncing');

    try {
      await this.push();
      await this.pull();
      this.failures = 0;

      if (this.pendingCount() > 0 || this.again) {
        // A conflict copy or a local edit arrived while the pass was running.
        this.status.set('syncing');
        this.message.set('Finishing sync…');
      } else {
        this.lastSyncedAt.set(Date.now());
        this.status.set('synced');
        this.message.set(this.statusMessage());
      }
    } catch (error) {
      if (error instanceof SyncHttpError && error.status < 500) {
        this.status.set('error');
        this.message.set(error.message);
      } else if (error instanceof SyncError) {
        this.status.set('error');
        this.message.set(error.message);
      } else {
        this.status.set('offline');
        this.message.set(
          'The server is unreachable. Changes are saved locally and will sync when it returns.',
        );
      }
      this.failures += 1;
    } finally {
      this.running = false;
      this.saveState();

      const pending = this.pendingCount() > 0;
      if (this.failures > 0) {
        const delay = Math.min(PUSH_RETRY_BASE * 2 ** (this.failures - 1), PUSH_RETRY_MAX);
        this.schedule(delay);
      } else if (pending || this.again) {
        this.schedule(SYNC_DELAY);
      }
    }
  }

  /** Success text, mentioning conflicts because they pause the queues. */
  private statusMessage(): string {
    const count = Object.keys(this.conflictMap).length;
    if (count === 0) return 'Everything is saved on this device and on the server.';
    return `${count} note${count === 1 ? '' : 's'} need${count === 1 ? 's' : ''} your decision before syncing.`;
  }

  private async push(): Promise<void> {
    const handlers = this.handlers;
    if (!handlers) return;

    const notes = new Map(handlers.getNotes().map((note) => [note.id, note]));
    const dirty = new Set(this.state.dirty);
    const removed = new Set(this.state.removed);
    const docs: Record<string, unknown>[] = [];

    for (const id of [...dirty]) {
      // A note with a pending conflict stays queued until the user decides;
      // pushing now would either overwrite the other side or 409 again.
      if (this.conflictMap[id]) continue;
      const note = notes.get(id);
      if (!note) {
        // The note disappeared without `markDeleted`; keep the deletion.
        dirty.delete(id);
        removed.add(id);
        continue;
      }
      docs.push(this.toDoc(note, this.state.revs[id]));
    }

    for (const id of removed) {
      if (this.conflictMap[id]) continue;
      // `deletedAt` lets the backend purge schedule age tombstones out.
      const doc: Record<string, unknown> = {
        _id: noteDocId(id),
        _deleted: true,
        type: 'note',
        deletedAt: Date.now(),
      };
      const rev = this.state.revs[id];
      if (rev) doc['_rev'] = rev;
      docs.push(doc);
    }

    this.state.dirty = [...dirty];
    this.state.removed = [...removed];
    if (docs.length === 0) return;

    // The bytes have to exist on the server before a note can reference them.
    // Uploads are content-addressed, so a `409` simply means someone else got
    // there first.
    const pushed = [...dirty].filter((id) => !this.conflictMap[id]).map((id) => notes.get(id));
    await this.pushAssets(pushed.filter((note): note is Note => note !== undefined));

    const result = await this.request('POST', '/_bulk_docs', { docs });
    if (!Array.isArray(result)) throw new SyncError('Unexpected response from CouchDB.');

    for (const entry of result) {
      if (!isRecord(entry)) continue;
      const docId = typeof entry['id'] === 'string' ? entry['id'] : '';
      const id = noteIdFromDoc(docId);
      if (!id) continue;

      const rev = typeof entry['rev'] === 'string' ? entry['rev'] : '';
      if (rev) {
        if (removed.has(id)) {
          delete this.state.revs[id];
          this.state.removed = this.state.removed.filter((item) => item !== id);
        } else {
          this.state.revs[id] = rev;
          this.state.dirty = this.state.dirty.filter((item) => item !== id);
        }
        continue;
      }

      const error = typeof entry['error'] === 'string' ? entry['error'] : 'unknown';
      if (error === 'conflict') {
        await this.registerPushConflict(id, removed.has(id));
        continue;
      }

      if (error === 'not_found' || error === 'missing') {
        delete this.state.revs[id];
        if (removed.has(id)) {
          this.state.removed = this.state.removed.filter((item) => item !== id);
        }
        continue;
      }

      throw new SyncError(`CouchDB rejected "${id}" (${error}).`);
    }

    this.saveState();
  }

  /**
   * Uploads every asset referenced by a note that is about to be pushed. A
   * failure keeps the note dirty, so the next pass retries both together.
   */
  private async pushAssets(notes: Note[]): Promise<void> {
    const refs = new Set<string>();
    for (const note of notes) {
      for (const ref of noteAssetRefs(note)) refs.add(ref);
    }

    for (const ref of refs) {
      if (this.state.assets.includes(ref)) continue;

      const blob = await this.assets.getBlob(ref);
      // The bytes are missing on this device; uploading the note still makes
      // sense because the ref may already exist elsewhere.
      if (!blob) continue;

      const docId = assetDocId(ref);
      const data = await blobToBase64(blob);
      const doc: Record<string, unknown> = {
        _id: docId,
        type: 'asset',
        schema: 1,
        _attachments: {
          blob: { content_type: blob.type || 'application/octet-stream', data },
        },
      };

      try {
        await this.request('PUT', `/${encodeURIComponent(docId)}`, doc);
      } catch (error) {
        // Content-addressed ids are immutable: a conflict means the same bytes
        // are already stored on the server.
        if (!(error instanceof SyncHttpError && error.status === 409)) throw error;
      }

      this.rememberAsset(ref);
    }
  }

  /** Downloads the bytes for asset refs found in freshly pulled notes. */
  private async pullAssets(notes: RemoteNoteDoc[]): Promise<void> {
    const refs = new Set<string>();
    for (const note of notes) {
      for (const ref of docAssetRefs(note.data)) refs.add(ref);
    }

    for (const ref of refs) {
      if (await this.assets.has(ref)) {
        this.rememberAsset(ref);
        continue;
      }

      try {
        const blob = await this.requestBlob(`/${encodeURIComponent(assetDocId(ref))}/blob`);
        await this.assets.putBlobAt(ref, blob);
        this.rememberAsset(ref);
      } catch (error) {
        // A missing asset is not fatal: the note still keeps its reference and
        // a later sync can try again.
        if (error instanceof SyncHttpError && error.status === 404) continue;
        throw error;
      }
    }

    this.saveState();
  }

  private rememberAsset(ref: string): void {
    if (this.state.assets.includes(ref)) return;
    this.state.assets.push(ref);
    this.saveState();
  }

  private async pull(): Promise<void> {
    const handlers = this.handlers;
    if (!handlers) return;

    const query = new URLSearchParams({
      since: this.state.since === null ? '0' : String(this.state.since),
      include_docs: 'true',
      conflicts: 'true',
    });
    const result = await this.request('GET', `/_changes?${query.toString()}`);
    if (!isRecord(result)) throw new SyncError('Unexpected response from CouchDB.');

    const rows = Array.isArray(result['results']) ? result['results'] : [];
    const local = new Map(handlers.getNotes().map((note) => [note.id, note]));
    const apply: RemoteApply = { notes: [], deletes: [], copies: [] };
    let touched = false;

    for (const row of rows) {
      if (!isRecord(row)) continue;
      const id = noteIdFromDoc(typeof row['id'] === 'string' ? row['id'] : '');
      if (!id) continue;

      // Notes with a pending decision are frozen until the user resolves them.
      if (this.conflictMap[id]) continue;

      const rev = firstChangeRev(row);
      const deleted = row['deleted'] === true;

      if (deleted) {
        if (this.state.removed.includes(id) || this.state.dirty.includes(id)) {
          // A local edit/delete will be pushed with this tombstone revision,
          // resurrecting the note instead of losing the local text.
          if (rev) this.state.revs[id] = rev;
          continue;
        }
        if (local.has(id)) {
          apply.deletes.push(id);
          touched = true;
        }
        delete this.state.revs[id];
        continue;
      }

      const doc = isRecord(row['doc']) ? row['doc'] : null;
      if (!doc) continue;
      if (this.state.removed.includes(id)) continue;

      if (this.state.dirty.includes(id)) {
        if (rev) this.state.revs[id] = rev;
        continue;
      }

      const remoteUpdated = numberField(doc, 'updatedAt');
      const current = local.get(id);
      if (current && current.updatedAt > remoteUpdated) {
        // The local copy is newer but was never marked dirty (for example after
        // a partial state loss). Keep it and push it on the next pass.
        this.state.dirty.push(id);
        if (rev) this.state.revs[id] = rev;
        touched = true;
        continue;
      }

      if (rev) this.state.revs[id] = rev;
      const migrated = migrateNoteDoc(doc);
      apply.notes.push({ id, rev, data: noteDataFromDoc(migrated.doc, id) });
      touched = true;
      if (migrated.changed) {
        // The stored shape was upgraded; queue the note so the migrated
        // document is pushed back on the next pass.
        this.markDirty(id);
      }

      // A losing revision on the server is preserved as a decision instead of
      // an automatic copy: the user chooses between it and the current note.
      const conflictRevs = Array.isArray(doc['_conflicts']) ? doc['_conflicts'] : [];
      for (const conflictRev of conflictRevs) {
        if (typeof conflictRev !== 'string') continue;
        if (await this.registerPullConflict(id, conflictRev)) break;
      }
    }

    const lastSeq = result['last_seq'];
    if (typeof lastSeq === 'number' || typeof lastSeq === 'string') this.state.since = lastSeq;

    this.saveState();
    if (touched) handlers.applyRemote(apply);

    // Notes are already in the store; the directive retries the image binding
    // as soon as each blob lands in IndexedDB.
    await this.pullAssets(apply.notes);
  }

  /**
   * Handles a `409` for a local edit or delete: the server version is recorded
   * as a pending decision while the local operation stays queued. Pushing it
   * before the decision would either overwrite the other side or fail again.
   */
  private async registerPushConflict(id: string, deleting: boolean): Promise<void> {
    let doc: Record<string, unknown> | null = null;

    try {
      const result = await this.request('GET', `/${encodeURIComponent(noteDocId(id))}?revs=false`);
      if (isRecord(result)) doc = result;
    } catch (error) {
      if (error instanceof SyncHttpError && error.status === 404) {
        // The note is gone from the server; drop the stale revision so the
        // local edit is retried as a fresh write (or the delete is skipped).
        delete this.state.revs[id];
        return;
      }
      throw error;
    }

    if (!doc) return;

    const rev = typeof doc['_rev'] === 'string' ? doc['_rev'] : '';
    if (rev) this.state.revs[id] = rev;
    const migrated = migrateNoteDoc(doc);
    this.registerConflict({
      id,
      theirsRev: rev,
      theirs: noteDataFromDoc(migrated.doc, id),
      origin: 'push',
      deletedLocally: deleting,
      at: Date.now(),
    });
  }

  /**
   * Records a losing server revision as a pending decision. Returns true when
   * the conflict is pending (or was already), so extra losing revisions of the
   * same note can wait for a later pass.
   */
  private async registerPullConflict(id: string, losingRev: string): Promise<boolean> {
    const existing = this.conflictMap[id];
    if (existing && existing.theirsRev === losingRev) return true;

    let doc: Record<string, unknown> | null = null;
    try {
      const result = await this.request(
        'GET',
        `/${encodeURIComponent(noteDocId(id))}?rev=${encodeURIComponent(losingRev)}`,
      );
      if (isRecord(result)) doc = result;
    } catch (error) {
      if (error instanceof SyncHttpError && error.status === 404) return false;
      throw error;
    }

    if (!doc) return false;
    const migrated = migrateNoteDoc(doc);
    this.registerConflict({
      id,
      theirsRev: losingRev,
      theirs: noteDataFromDoc(migrated.doc, id),
      origin: 'pull',
      deletedLocally: false,
      at: Date.now(),
    });
    return true;
  }

  /** Stores a conflict once per `(note, revision)` pair. */
  private registerConflict(conflict: NoteConflict): void {
    const existing = this.conflictMap[conflict.id];
    if (existing && existing.theirsRev === conflict.theirsRev) return;
    this.conflictMap[conflict.id] = conflict;
    this.saveConflicts();
  }

  /**
   * Applies the user's decision for a note. `mine` keeps the local version and
   * retries the push, `theirs` adopts the other side, and `both` keeps the
   * other side as a "(conflict …)" copy while the local version is pushed.
   */
  async resolveConflict(noteId: string, choice: ConflictChoice): Promise<void> {
    const conflict = this.conflictMap[noteId];
    const handlers = this.handlers;
    if (!conflict || !handlers) return;

    if (choice === 'mine') {
      // Push origins re-queue the local version against the recorded revision;
      // pull origins already match the winning server revision. A delete stays
      // queued on its own, so it must not turn into a note upload.
      if (conflict.origin === 'push' && !conflict.deletedLocally) this.markDirty(noteId);
    } else if (choice === 'theirs') {
      if (conflict.theirs) {
        const saved = handlers.applyRemote({
          notes: [{ id: noteId, rev: conflict.theirsRev, data: conflict.theirs }],
          deletes: [],
          copies: [],
          force: true,
        });
        if (!saved) return;
        if (conflict.origin === 'pull') {
          // The adopted version must overwrite the winner on the server.
          this.markDirty(noteId);
        } else {
          this.clearQueues(noteId);
        }
      } else {
        // The other side no longer exists; accept the local deletion.
        handlers.applyRemote({ notes: [], deletes: [noteId], copies: [] });
        this.clearQueues(noteId);
      }
    } else {
      if (conflict.theirs) {
        const copy = this.makeConflictCopy(conflict.theirs);
        if (!handlers.applyRemote({ notes: [], deletes: [], copies: [copy] })) return;
      }
      // The local edit is pushed next; a pending delete stays queued as is.
      if (conflict.origin === 'push' && !conflict.deletedLocally) this.markDirty(noteId);
    }

    // Pull conflicts must drop the losing revision, but only after its content
    // is either kept as a copy or discarded on purpose.
    if (conflict.origin === 'pull' && conflict.theirsRev) {
      await this.deleteConflictRevision(noteId, conflict.theirsRev);
    }

    delete this.conflictMap[noteId];
    this.saveConflicts();
    this.schedule(SYNC_DELAY);
  }

  private clearQueues(noteId: string): void {
    this.state.dirty = this.state.dirty.filter((id) => id !== noteId);
    this.state.removed = this.state.removed.filter((id) => id !== noteId);
    this.saveState();
  }

  private async deleteConflictRevision(id: string, rev: string): Promise<void> {
    try {
      await this.request(
        'DELETE',
        `/${encodeURIComponent(noteDocId(id))}?rev=${encodeURIComponent(rev)}`,
      );
    } catch (error) {
      if (error instanceof SyncHttpError && error.status === 404) return;
      throw error;
    }
  }

  /** Copies the other side of a conflict into a new note so nothing is lost. */
  private makeConflictCopy(data: Record<string, unknown>): RemoteNoteDoc {
    const id = uid('n');
    const copy: Record<string, unknown> = { ...data, id };
    const title = typeof copy['title'] === 'string' ? copy['title'].trim() : '';
    copy['title'] = `${title || 'Untitled'} (conflict ${conflictStamp()})`;
    copy['updatedAt'] = Date.now();
    return { id, rev: '', data: copy };
  }

  private toDoc(note: Note, rev?: string): Record<string, unknown> {
    const { id, ...rest } = note;
    const doc: Record<string, unknown> = {
      _id: noteDocId(id),
      type: 'note',
      schema: CURRENT_SCHEMA,
      ...rest,
    };
    if (rev) doc['_rev'] = rev;
    return doc;
  }

  private async readConfig(): Promise<SyncConfig> {
    try {
      if (localStorage.getItem(DISABLED_KEY) === '1') return { enabled: false };
    } catch {
      // If storage is unavailable, fall through and try the config file.
    }

    try {
      const response = await fetch(CONFIG_URL, {
        cache: 'no-store',
        headers: { accept: 'application/json' },
      });
      if (!response.ok) return { enabled: false };
      return parseConfig(await response.json());
    } catch {
      return { enabled: false };
    }
  }

  private async request(method: string, path: string, body?: unknown): Promise<unknown> {
    const response = await this.send(method, path, body, 'application/json');
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  }

  /** Downloads a binary endpoint, used for CouchDB attachments. */
  private async requestBlob(path: string): Promise<Blob> {
    const response = await this.send('GET', path, undefined, '*/*');
    return response.blob();
  }

  private async send(
    method: string,
    path: string,
    body: unknown,
    accept: string,
  ): Promise<Response> {
    const config = this.config;
    if (!config?.enabled) throw new SyncError('Sync is not configured.');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    let response: Response;
    try {
      response = await fetch(`${config.url}${path}`, {
        method,
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          accept,
          authorization: basicAuth(config.username ?? '', config.password ?? ''),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      let detail = '';
      try {
        detail = (await response.text()).slice(0, 200);
      } catch {
        // The status code is enough when the body cannot be read.
      }
      throw new SyncHttpError(
        response.status,
        response.status === 401 || response.status === 403
          ? 'Sync login failed. Check the app credentials in .env.'
          : `CouchDB answered ${response.status}${detail ? `: ${detail}` : ''}`,
      );
    }

    return response;
  }

  private schedule(delay: number): void {
    this.clearTimer();
    this.timer = setTimeout(() => {
      this.timer = undefined;
      void this.syncNow();
    }, delay);
  }

  private clearTimer(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }

  private saveState(): void {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(this.state));
    } catch {
      // The notes themselves are already saved; a lost cursor only costs a
      // full comparison on the next start.
    }
    this.refreshPending();
  }

  private saveConflicts(): void {
    try {
      localStorage.setItem(CONFLICTS_KEY, JSON.stringify(this.conflictMap));
    } catch {
      // The conflict still shows in this session; only the record is lost.
    }
    this.conflicts.set(Object.values(this.conflictMap));
    this.refreshPending();
  }

  /**
   * Queued ids with a pending conflict never auto-schedule: they are excluded
   * so the retry loop stops while the user decides.
   */
  private refreshPending(): void {
    const conflicted = new Set(Object.keys(this.conflictMap));
    this.pendingCount.set(
      this.state.dirty.filter((id) => !conflicted.has(id)).length +
        this.state.removed.filter((id) => !conflicted.has(id)).length,
    );
  }

  /**
   * Reads server-side counters for the diagnostics popover: database totals
   * from `GET /<db>` and the maintenance schedule from `meta:maintenance`.
   * Uses the app credentials; a failure keeps the last successful read.
   */
  async refreshDiagnostics(): Promise<void> {
    if (!this.config?.enabled) return;

    let info: Record<string, unknown> | null = null;
    try {
      const result = await this.request('GET', '');
      if (isRecord(result)) info = result;
    } catch {
      return;
    }
    if (!info) return;

    let maintenance: MaintenanceInfo | null = null;
    try {
      const result = await this.request('GET', `/${encodeURIComponent(MAINTENANCE_DOC_ID)}`);
      if (isRecord(result)) {
        maintenance = {
          firstRun: optionalNumber(result, 'firstRun'),
          lastCompaction: optionalNumber(result, 'lastCompaction'),
          lastPurge: optionalNumber(result, 'lastPurge'),
          purged: optionalNumber(result, 'purged'),
          intervalSeconds: optionalNumber(result, 'intervalSeconds'),
        };
      }
    } catch {
      // The maintenance service may not have run yet.
    }

    const purgeSeq = info['purge_seq'];
    const compacting = info['compact_running'];
    this.diagnostics.set({
      at: Date.now(),
      docCount: optionalNumber(info, 'doc_count'),
      deletedCount: optionalNumber(info, 'doc_del_count'),
      purgeSeq: typeof purgeSeq === 'number' || typeof purgeSeq === 'string' ? purgeSeq : null,
      compactRunning: compacting === true || compacting === false ? compacting : null,
      maintenance,
    });
  }
}

function parseConfig(value: unknown): SyncConfig {
  if (!isRecord(value) || value['enabled'] !== true) return { enabled: false };

  const url = value['url'];
  const username = value['username'];
  const password = value['password'];
  if (
    typeof url !== 'string' ||
    typeof username !== 'string' ||
    typeof password !== 'string' ||
    username.length === 0 ||
    password.length === 0
  ) {
    return { enabled: false };
  }

  if (/^https?:\/\//.test(url)) {
    return { enabled: true, url: url.replace(/\/+$/, ''), username, password };
  }

  if (url.startsWith('/')) {
    return { enabled: true, url: url.replace(/\/+$/, ''), username, password };
  }

  return { enabled: false };
}

function loadState(): SyncState {
  const empty: SyncState = { since: null, revs: {}, dirty: [], removed: [], assets: [] };

  try {
    const raw = localStorage.getItem(STATE_KEY);
    if (!raw) return empty;

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return empty;

    const revs: Record<string, string> = {};
    if (isRecord(parsed['revs'])) {
      for (const [key, value] of Object.entries(parsed['revs'])) {
        if (typeof value === 'string') revs[key] = value;
      }
    }

    return {
      since:
        typeof parsed['since'] === 'number' || typeof parsed['since'] === 'string'
          ? parsed['since']
          : null,
      revs,
      dirty: stringArray(parsed['dirty']),
      removed: stringArray(parsed['removed']),
      assets: stringArray(parsed['assets']),
    };
  } catch {
    return empty;
  }
}

function loadConflicts(): Record<string, NoteConflict> {
  try {
    const raw = localStorage.getItem(CONFLICTS_KEY);
    if (!raw) return {};

    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return {};

    const conflicts: Record<string, NoteConflict> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!isRecord(value)) continue;
      const theirsRev = typeof value['theirsRev'] === 'string' ? value['theirsRev'] : '';
      if (!key || !theirsRev) continue;
      const theirs = isRecord(value['theirs']) ? value['theirs'] : null;
      const origin = value['origin'] === 'pull' ? 'pull' : 'push';
      const at = optionalNumber(value, 'at');
      conflicts[key] = {
        id: key,
        theirsRev,
        theirs,
        origin,
        deletedLocally: value['deletedLocally'] === true,
        at: at ?? 0,
      };
    }
    return conflicts;
  } catch {
    return {};
  }
}

function optionalNumber(record: Record<string, unknown>, key: string): number | null {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function noteDocId(noteId: string): string {
  return `note:${noteId}`;
}

function noteIdFromDoc(docId: string): string | null {
  return docId.startsWith('note:') ? docId.slice('note:'.length) : null;
}

function assetDocId(ref: string): string {
  return `asset:${assetHash(ref)}`;
}

/** Asset refs that a note points at, ignoring the text content. */
function noteAssetRefs(note: Note): string[] {
  const refs = new Set<string>();
  addAssetRef(refs, note.icon);
  addAssetRef(refs, note.cover);
  for (const block of note.blocks) {
    addAssetRef(refs, block.src);
    for (const column of block.imageColumns) addAssetRef(refs, column.src);
  }
  return [...refs];
}

/** Asset refs inside a remote note document, before it reaches the store. */
function docAssetRefs(data: Record<string, unknown>): string[] {
  const refs = new Set<string>();
  addAssetRef(refs, data['icon']);
  addAssetRef(refs, data['cover']);

  const blocks = Array.isArray(data['blocks']) ? data['blocks'] : [];
  for (const block of blocks) {
    if (!isRecord(block)) continue;
    addAssetRef(refs, block['src']);

    const columns = Array.isArray(block['imageColumns']) ? block['imageColumns'] : [];
    for (const column of columns) {
      if (isRecord(column)) addAssetRef(refs, column['src']);
    }
  }

  return [...refs];
}

function addAssetRef(refs: Set<string>, value: unknown): void {
  if (typeof value === 'string' && isAssetRef(value)) refs.add(value);
}

function noteDataFromDoc(doc: Record<string, unknown>, id: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(doc)) {
    if (key.startsWith('_') || key === 'type' || key === 'schema' || key === 'id') continue;
    data[key] = value;
  }
  data['id'] = id;
  return data;
}

function firstChangeRev(row: Record<string, unknown>): string {
  const changes = Array.isArray(row['changes']) ? row['changes'] : [];
  for (const change of changes) {
    if (isRecord(change) && typeof change['rev'] === 'string') return change['rev'];
  }
  const doc = row['doc'];
  if (isRecord(doc) && typeof doc['_rev'] === 'string') return doc['_rev'];
  return '';
}

function conflictStamp(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function basicAuth(username: string, password: string): string {
  const bytes = new TextEncoder().encode(`${username}:${password}`);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `Basic ${btoa(binary)}`;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function numberField(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
