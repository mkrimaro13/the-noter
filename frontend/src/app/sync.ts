import { DestroyRef, Injectable, inject, signal } from '@angular/core';
import { Note, uid } from './models';

const CONFIG_URL = '/sync-config.json';
const STATE_KEY = 'the-noter.sync.v1';
/** Set to `1` to run the app without a server (used by offline/automation runs). */
const DISABLED_KEY = 'the-noter.sync.disabled';
const SYNC_DELAY = 400;
const PUSH_RETRY_BASE = 5_000;
const PUSH_RETRY_MAX = 60_000;
const POLL_INTERVAL = 30_000;
const REQUEST_TIMEOUT = 15_000;

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

  /** Current sync state, rendered by the sidebar. */
  readonly status = signal<SyncStatus>('idle');
  /** Human-readable explanation for the current status. */
  readonly message = signal('Waiting to sync.');
  readonly lastSyncedAt = signal<number | null>(null);

  private config: SyncConfig | null = null;
  private handlers: SyncHandlers | null = null;
  private state: SyncState = loadState();
  private running = false;
  private again = false;
  private failures = 0;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private started = false;

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
    if (this.state.dirty.length === 0 && this.state.removed.length === 0) return;
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
      void this.syncNow(true);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void this.syncNow(true);
    };

    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisibility);
    this.pollTimer = setInterval(() => {
      if (document.visibilityState !== 'hidden') void this.syncNow(true);
    }, POLL_INTERVAL);

    this.destroyRef.onDestroy(() => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisibility);
      clearInterval(this.pollTimer);
      this.clearTimer();
    });

    void this.syncNow(true);
  }

  private async syncNow(quiet = false): Promise<void> {
    if (!this.config?.enabled || !this.handlers) return;
    if (this.running) {
      this.again = true;
      return;
    }

    this.running = true;
    this.again = false;
    this.clearTimer();

    const hasPending = this.state.dirty.length > 0 || this.state.removed.length > 0;
    if (!quiet || hasPending) this.status.set('syncing');

    try {
      await this.push();
      await this.pull();
      this.failures = 0;

      if (this.state.dirty.length > 0 || this.state.removed.length > 0) {
        // A conflict copy or a local edit arrived while the pass was running.
        this.status.set('syncing');
        this.message.set('Finishing sync…');
      } else {
        this.lastSyncedAt.set(Date.now());
        this.status.set('synced');
        this.message.set('Everything is saved on this device and on the server.');
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

      const pending = this.state.dirty.length > 0 || this.state.removed.length > 0;
      if (this.failures > 0) {
        const delay = Math.min(PUSH_RETRY_BASE * 2 ** (this.failures - 1), PUSH_RETRY_MAX);
        this.schedule(delay);
      } else if (pending || this.again) {
        this.schedule(SYNC_DELAY);
      }
    }
  }

  private async push(): Promise<void> {
    const handlers = this.handlers;
    if (!handlers) return;

    const notes = new Map(handlers.getNotes().map((note) => [note.id, note]));
    const dirty = new Set(this.state.dirty);
    const removed = new Set(this.state.removed);
    const docs: Record<string, unknown>[] = [];

    for (const id of [...dirty]) {
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
      const doc: Record<string, unknown> = { _id: noteDocId(id), _deleted: true };
      const rev = this.state.revs[id];
      if (rev) doc['_rev'] = rev;
      docs.push(doc);
    }

    this.state.dirty = [...dirty];
    this.state.removed = [...removed];
    if (docs.length === 0) return;

    const result = await this.request('POST', '/_bulk_docs', { docs });
    if (!Array.isArray(result)) throw new SyncError('Unexpected response from CouchDB.');

    const copies: RemoteNoteDoc[] = [];

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
        const copy = await this.resolveConflict(id, removed.has(id));
        if (copy) copies.push(copy);
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

    // Conflict copies are added to the store first; the store persists them and
    // calls `notifyPersisted` before they are pushed on the next pass.
    if (copies.length > 0) {
      handlers.applyRemote({ notes: [], deletes: [], copies });
    }
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
    const losingRevisions: Array<{ id: string; rev: string }> = [];
    let touched = false;

    for (const row of rows) {
      if (!isRecord(row)) continue;
      const id = noteIdFromDoc(typeof row['id'] === 'string' ? row['id'] : '');
      if (!id) continue;

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
      apply.notes.push({ id, rev, data: noteDataFromDoc(doc, id) });
      touched = true;

      const conflicts = Array.isArray(doc['_conflicts']) ? doc['_conflicts'] : [];
      for (const conflictRev of conflicts) {
        if (typeof conflictRev !== 'string') continue;
        const conflictDoc = await this.request(
          'GET',
          `/${encodeURIComponent(noteDocId(id))}?rev=${encodeURIComponent(conflictRev)}`,
        );
        if (isRecord(conflictDoc)) {
          apply.copies.push(this.makeConflictCopy(conflictDoc));
          losingRevisions.push({ id, rev: conflictRev });
        }
      }
    }

    const lastSeq = result['last_seq'];
    if (typeof lastSeq === 'number' || typeof lastSeq === 'string') this.state.since = lastSeq;

    this.saveState();
    const saved = touched || apply.copies.length > 0 ? handlers.applyRemote(apply) : true;

    // Only remove the losing revisions after the winning note and every copy
    // have reached localStorage. A crash can then never lose the losing text.
    if (saved && losingRevisions.length > 0) {
      const ids = new Set<string>();
      for (const losing of losingRevisions) {
        await this.deleteConflictRevision(losing.id, losing.rev);
        ids.add(losing.id);
      }
      for (const id of ids) {
        const fresh = await this.request('GET', `/${encodeURIComponent(noteDocId(id))}?revs=false`);
        if (isRecord(fresh) && typeof fresh['_rev'] === 'string') {
          this.state.revs[id] = fresh['_rev'];
        }
      }
      this.saveState();
    }
  }

  /**
   * Handles a `409` for a local edit or delete. The server version is returned
   * as a copy (so both texts survive) while the local operation keeps its place
   * in the queue and is retried with the current revision.
   */
  private async resolveConflict(id: string, deleting: boolean): Promise<RemoteNoteDoc | null> {
    let doc: Record<string, unknown> | null = null;

    try {
      const result = await this.request('GET', `/${encodeURIComponent(noteDocId(id))}?revs=false`);
      if (isRecord(result)) doc = result;
    } catch (error) {
      if (error instanceof SyncHttpError && error.status === 404) {
        delete this.state.revs[id];
        if (deleting) this.state.removed = this.state.removed.filter((item) => item !== id);
        return null;
      }
      throw error;
    }

    if (!doc) return null;

    const rev = typeof doc['_rev'] === 'string' ? doc['_rev'] : '';
    if (rev) this.state.revs[id] = rev;
    return this.makeConflictCopy(doc);
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

  private makeConflictCopy(doc: Record<string, unknown>): RemoteNoteDoc {
    const id = uid('n');
    const data = noteDataFromDoc(doc, id);
    const title = typeof data['title'] === 'string' ? data['title'].trim() : '';
    data['title'] = `${title || 'Untitled'} (conflict ${conflictStamp()})`;
    data['updatedAt'] = Date.now();
    return { id, rev: '', data };
  }

  private toDoc(note: Note, rev?: string): Record<string, unknown> {
    const { id, ...rest } = note;
    const doc: Record<string, unknown> = {
      _id: noteDocId(id),
      type: 'note',
      schema: 1,
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
    const config = this.config;
    if (!config?.enabled) throw new SyncError('Sync is not configured.');

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    try {
      const response = await fetch(`${config.url}${path}`, {
        method,
        cache: 'no-store',
        signal: controller.signal,
        headers: {
          accept: 'application/json',
          authorization: basicAuth(config.username ?? '', config.password ?? ''),
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

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

      const text = await response.text();
      return text ? JSON.parse(text) : null;
    } finally {
      clearTimeout(timeout);
    }
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
    !/^https?:\/\//.test(url) ||
    username.length === 0 ||
    password.length === 0
  ) {
    return { enabled: false };
  }

  return { enabled: true, url: url.replace(/\/+$/, ''), username, password };
}

function loadState(): SyncState {
  const empty: SyncState = { since: null, revs: {}, dirty: [], removed: [] };

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
    };
  } catch {
    return empty;
  }
}

function noteDocId(noteId: string): string {
  return `note:${noteId}`;
}

function noteIdFromDoc(docId: string): string | null {
  return docId.startsWith('note:') ? docId.slice('note:'.length) : null;
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
