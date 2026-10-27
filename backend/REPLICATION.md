# Sync and replication notes

This document describes the sync that is actually implemented. The app does **not** use PouchDB or
IndexedDB yet. It keeps `localStorage` as the primary store and talks to CouchDB with the HTTP API
through `frontend/src/app/sync.ts`. Each section is written as **what**, **why**, and **how** so the
behavior can be checked without re-deriving it.

**Scope:** one personal CouchDB on localhost, one browser user, no account screen, no Tailscale, no
public exposure. The frontend is connected; sync is enabled by the runtime config generated from the
root `.env`.

---

## 1. Architecture: local first, network second

**What** — The browser writes the complete notes array to `localStorage` first. A separate sync
service then pushes changed notes to CouchDB and pulls remote changes back.

```
edit ──▶ signal store ──▶ localStorage (notes + pending ids)
                                 │
                                 ▼
                          SyncService
                     push  ──▶ _bulk_docs
                     pull  ◀── _changes?since=…
                                 │
                                 ▼
                     applyRemote ──▶ localStorage again
```

**Why** — The required order is explicit: an edit must survive even if the server is down, slow, or
misconfigured. PouchDB/IndexedDB would own both the local write and replication, making that order an
internal detail of the library. A small custom client makes "local write, then send" visible and
testable, and keeps the existing `localStorage` model unchanged.

The trade-off is that retries, revision tracking, tombstones, and conflict copies are our code, and
the roughly 5 MB `localStorage` quota still applies. Moving to IndexedDB is a later storage change,
not a sync prerequisite.

**How** — `NoteStore.persist()` calls `localStorage.setItem(NOTES_KEY, …)` and only afterwards calls
`SyncService.notifyPersisted()`. The sync service never observes a mutation directly; it is started
by that call, or by its own retry/poll timers.

---

## 2. One database, one document per note

**What** — Every note is one CouchDB document in the `thenoter` database.

**Why** — CouchDB replicates a whole database, so one database is one replication target and one
backup unit. Per-note documents give the smallest useful conflict unit: editing note A and note B on
two devices never conflicts. One document for the whole notebook would make every edit collide.

**How** — A document looks like this:

```json
{
  "_id": "note:n_1729000000000_ab12",
  "_rev": "3-4f2a…",
  "type": "note",
  "schema": 1,
  "title": "Reading list",
  "icon": "📚",
  "cover": "",
  "parentId": null,
  "metadata": [{ "id": "m_1", "key": "Status", "value": "active" }],
  "blocks": [
    {
      "id": "b_1",
      "type": "text",
      "columns": ["First paragraph"],
      "columnCount": 1
    }
  ],
  "createdAt": 1729000000000,
  "updatedAt": 1729000000000
}
```

Rules:

- `_id` is `note:` plus the note's local id and never changes.
- The local id is **not** repeated inside the body; it is derived from `_id` when pulling. This avoids
  two sources of truth.
- `parentId` points at another note's plain id, not at its `_id`.
- Block ids stay stable inside the array. Conflict handling still works at note level, not block
  level.
- `schema: 1` is reserved for a future migration.
- Images are still inline data URLs in this version, so they travel with the JSON body. See
  [section 10](#10-images-are-still-inline).

The database is created by the `init` service. The app user has read/write membership only on this
database.

---

## 3. Revisions and persisted sync state

**What** — CouchDB adds a `_rev` such as `3-4f2a…` to every document. The browser stores the last
known revision for every synced note, plus a `_changes` cursor and two queues, under
`localStorage['the-noter.sync.v1']`:

```json
{
  "since": 42,
  "revs": { "n_1729000000000_ab12": "3-4f2a…" },
  "dirty": ["n_1729000000000_ab12"],
  "removed": ["n_1729000000000_cd34"]
}
```

**Why** — The revision is optimistic concurrency: if another device wrote first, our revision is
stale and CouchDB answers `409 Conflict` instead of overwriting. Persisting the cursor means a reload
only fetches new changes. Persisting the queues means an edit made while offline is still sent after
the browser restarts.

This state is an optimization and a queue, not the notes themselves. The notes array in
`the-noter.notes.v1` remains authoritative for what the user sees.

**How** — `SyncService` loads the state at construction and saves it after queue changes, after
push/pull, and after conflict resolution. On the first run (`since` is `null` and `revs` is empty),
every note already in `localStorage` is marked dirty so an existing notebook seeds the empty server.
From then on only edits and deletes enter the queues.

If the state is lost but the notes remain, the app re-seeds by pushing local notes. If a note exists
on both sides with no known revision, the push gets a conflict and the server version is preserved as
a copy (section 7), rather than being silently overwritten.

---

## 4. Push: `_bulk_docs`

**What** — Dirty note ids and pending deletes are sent together as one `POST /thenoter/_bulk_docs`.

**Why** — A single request per batch is cheaper than one request per keystroke, and `_bulk_docs`
reports success or conflict per document. It also lets a delete and a normal edit share a pass.

**How**

- A dirty note becomes one document with `_id`, `type`, `schema`, the note fields, and the last known
  `_rev` if there is one.
- A removed note becomes `{ "_id": "note:<id>", "_rev": "…", "_deleted": true }`. The revision is
  required if the note existed on the server.
- On success (`rev` in the response), the new revision is stored and the id leaves its queue.
- On `conflict`, the conflict path in section 7 runs and the local change stays queued.
- On `not_found` / `missing`, the stored revision is dropped. For a delete, the tombstone is
  considered done.
- Any other error stops the pass and moves the pill to **Sync error**.
- If an id is dirty but no longer exists in the notes array, it is converted into a tombstone. This
  covers a deletion that bypassed `markDeleted`.

Requests time out after 15 seconds. Only one push/pull pass runs at a time; a request that arrives
mid-pass sets a flag and is handled immediately afterwards.

---

## 5. Pull: `_changes`

**What** — The app asks for changes since its stored cursor with documents and conflicts included:

```text
GET /thenoter/_changes?since=<cursor>&include_docs=true&conflicts=true
```

**Why** — The changes feed is the incremental "what is new" cursor. Re-reading the whole database on
every start would grow with the notebook and still need timestamp comparisons.

**How** — Only ids starting with `note:` are considered. For each row:

- **Tombstone** (`deleted: true`): if the note is dirty or locally deleted, record the tombstone
  revision and leave the local operation queued. Otherwise remove the note locally and forget the
  revision.
- **Dirty note**: do not apply the remote body. Record its revision; the local edit is still queued
  and has either already conflicted (so the server version was copied) or is about to be retried.
- **Locally deleted note**: ignore the remote body; the local tombstone wins this pass.
- **Remote note newer or equal**: convert the document into a note (restoring its id from `_id`) and
  apply it. The local `updatedAt` is kept monotonic with `Math.max(remote, local)` so clock
  comparisons stay stable.
- **Local note newer but not dirty** (partial state loss): keep the local copy, mark it dirty, and
  push it next pass.
- **Conflicts**: see section 7.

The resulting `last_seq` is stored as the new cursor. Pulled changes and conflict copies are written
to `localStorage` through `NoteStore.applyRemote()`, which flushes synchronously; the sync service
then decides whether server-side cleanup is safe.

---

## 6. Deletes are tombstones

**What** — Deleting a note sends `_deleted: true` to CouchDB and waits for the tombstone to be
accepted. Locally the note is removed immediately.

**Why** — A hard server delete would let the next device that still has the note upload it again. A
tombstone is how the deletion travels. Tombstones are tiny; keeping them is cheaper than explaining
a resurrected note.

**How** — `NoteStore.deleteNote()` removes the note, promotes its direct children to the deleted
note's parent, removes inline sub-note blocks that pointed at it, marks those affected notes dirty,
and calls `markDeleted(noteId)`. The pending id lives in `removed` until `_bulk_docs` confirms it.

On pull, a remote tombstone removes the local note unless the user has a pending edit or delete. A
concurrent edit therefore wins over another device's delete; the note is resurrected rather than
losing the writing. The reverse (delete after edit) is handled by the tombstone revision and a retry.

---

## 7. Conflicts preserve both versions

**What** — If two devices change the same note before seeing each other's revision, one version stays
on the original note and the other becomes a new note:

```text
Title (conflict 2026-10-26 18:48)
```

**Why** — Last-write-wins would silently destroy one side's writing. A conflict copy costs a merge
but never loses text. Per-note documents keep this rare: only simultaneous edits to the _same_ note
can conflict.

**How — push side.** A `409` means our `_rev` is stale. The app:

1. Reads the current server document.
2. Copies it into a new local note with a new id and the conflict title.
3. Stores the server revision for the original id.
4. Leaves the local edit queued and retries it against the new revision.

The result is that the local text keeps the original document and the server version survives as a
copy.

**How — pull side.** A pulled document can carry `_conflicts` (losing revision ids). The app:

1. Fetches each losing revision with `GET /thenoter/note:<id>?rev=<rev>`.
2. Copies each into a new local note with the conflict title.
3. Applies the winning note and the copies and flushes them to `localStorage`.
4. **Only then** deletes the losing revisions on the server with
   `DELETE /thenoter/note:<id>?rev=<losing>`.
5. Re-reads the current revision and stores it.

Deferring step 4 is deliberate: if the tab crashes after the changes feed advanced but before the
copies were written, the losing text must not already be gone from the server. The copies themselves
are queued as normal dirty notes and pushed in the next pass.

If cleanup fails, the losing revision stays on the server. The local copies are still safe, and the
conflict can be resolved manually later. There is no block-level or field-level merge.

Conflict copies keep the original `parentId`, blocks, metadata, and images, and get `updatedAt` set
to now. They are ordinary notes from then on.

---

## 8. Retries, polling, and status

**What** — Sync runs after local writes and on a few background triggers. Failures are retried with
backoff; the sidebar reports the state.

**Why** — The app must stay usable without a server and catch up without a manual button. Polling is
simple and sufficient for a personal notebook; long-polling or live replication is a later
optimization.

**How**

| Trigger                 | Behavior                                            |
| ----------------------- | --------------------------------------------------- |
| Local write             | Push after a 400 ms sync delay                      |
| Background poll         | Push/pull every 30 s, only while the tab is visible |
| `online` event          | Reset backoff and sync immediately                  |
| Tab becomes visible     | Sync immediately                                    |
| Failed pass             | Retry after 5 s, doubling to a 60 s ceiling         |
| More work while running | Run again immediately after the current pass        |

A network failure (server unreachable, timeout) reports **Offline**. An HTTP 4xx/5xx or an unexpected
response reports **Sync error** with a short message; 401/403 specifically points at the app
credentials. The sidebar pill keeps "Saved locally" first in every state:

`Saved locally` · `Saved locally · Syncing…` · `Saved locally · Synced` ·
`Saved locally · Offline` · `Saved locally · Sync error` · `Not saved`

---

## 9. Configuration and access control

**What** — The browser reads `/sync-config.json` at startup. It contains the database URL and the
app user credentials. The admin credentials never leave the server side.

**Why** — Baking credentials into the Angular bundle would require a rebuild to rotate them and would
still expose them. A runtime file is generated from `.env` and can be changed without rebuilding.
Separating admin from app keeps a browser credential from creating or deleting databases.

**How**

- Development: `scripts/write-sync-config.mjs` runs before `npm start`/`npm run build` and reads the
  repository root `.env`.
- Container: `docker-entrypoint.d/40-sync-config.sh` writes the file from `SYNC_URL`, `SYNC_USER`, and
  `SYNC_PASSWORD` each time nginx starts.
- nginx serves it with `Cache-Control: no-store` and no SPA fallback.
- CouchDB accepts CORS only from `http://127.0.0.1:8080`, `http://localhost:8080`,
  `http://127.0.0.1:4200`, and `http://localhost:4200`.
- The app user is a member of `thenoter` only. `_users` returns 403, `_all_dbs` returns 401, and
  anonymous database access returns 401.
- Set `localStorage['the-noter.sync.disabled'] = '1'` to bypass the config file for automation.

The app password is readable by anyone who can load `/sync-config.json`. That is an accepted
trade-off only because the app and database are localhost-only. Remote access needs TLS and a
different credential model, not just a wider CORS list. CORS is also not a security boundary for
non-browser clients.

---

## 10. Images are still inline

**What** — Images remain data URLs inside block `src` fields and therefore inside the note JSON.

**Why** — It keeps the first sync version small and preserves image bytes without a separate upload
lifecycle. It is also the main limitation: base64 adds roughly 33% overhead, every note save rewrites
the image string, and the whole notebook shares the browser's ~5 MB quota.

**How** — Nothing special happens during sync: the data URL is part of the document body and is
pushed/pulled as JSON. CouchDB stores it with the document, so `max_document_size` is set to 50 MB.

The planned follow-up is content-addressed CouchDB attachments:

- hash the image bytes (SHA-256) and store `asset:<hash>.webp` in the block;
- upload the bytes once as an attachment, reused by every note with the same picture;
- cache attachments locally as blobs for offline rendering;
- leave the image encoding unchanged, so quality does not degrade.

Until that lands, local images count against the localStorage quota and sync transfer size.

---

## 11. Verification recipe

### Stack

```bash
cd /path/to/the-noter
cp .env.example .env          # replace both passwords
docker compose up -d --build
docker compose ps -a          # backend healthy, init exited 0, frontend up

set -a && . ./.env && set +a

curl -s http://127.0.0.1:5984/_up
curl -s http://127.0.0.1:8080/sync-config.json    # enabled, app user only
```

### Document round-trip with the app user

```bash
APP="-u $COUCHDB_APP_USER:$COUCHDB_APP_PASSWORD"

# Create a note.
curl -s $APP -X PUT "http://127.0.0.1:5984/thenoter/note:test-1" \
  -H 'Content-Type: application/json' \
  -d '{"type":"note","schema":1,"title":"Test","parentId":null,
       "blocks":[],"metadata":[],"createdAt":0,"updatedAt":0}'

# Read it and note the _rev.
curl -s $APP http://127.0.0.1:5984/thenoter/note:test-1

# Update with that revision (a stale revision returns 409).
curl -s $APP -X PUT "http://127.0.0.1:5984/thenoter/note:test-1" \
  -H 'Content-Type: application/json' \
  -d '{"_rev":"1-…","type":"note","schema":1,"title":"Test edited",
       "parentId":null,"blocks":[],"metadata":[],"createdAt":0,"updatedAt":1}'

# Inspect changes and conflicts.
curl -s $APP 'http://127.0.0.1:5984/thenoter/_changes?since=0&include_docs=true'
curl -s $APP 'http://127.0.0.1:5984/thenoter/note:test-1?conflicts=true'

# Delete: a tombstone, not a hard removal.
curl -s $APP -X DELETE \
  "http://127.0.0.1:5984/thenoter/note:test-1?rev=2-…"
curl -s $APP 'http://127.0.0.1:5984/thenoter/_changes?since=0'
```

### Two-browser flow

1. Open `http://127.0.0.1:8080` in a clean browser profile A. Create a note and type a body. Wait for
   `Saved locally · Synced` and confirm the document appears in `_all_docs?include_docs=true`.
2. Open the same URL in a second clean profile B. The note appears after the first pull; reload if
   needed. Edit the title in B and wait for the server to show the new title.
3. Reload A and confirm it receives B's edit.
4. Put A offline (browser devtools). Edit again. The pill turns **Offline**, and the edit is present
   in `localStorage['the-noter.notes.v1']` but not in CouchDB. Go online; the edit is pushed and the
   pill returns to **Synced**.
5. Conflict: keep A offline and edit the note. While A is offline, update the same document directly
   through the CouchDB API (`PUT` with its current `_rev`). Go online in A. Confirm CouchDB ends up
   with both the local version as the main document and a `(conflict …)` note, and that both appear
   in the sidebar.
6. Delete a synced note in B, confirm it is gone in A after a reload, and confirm
   `_changes` reports `deleted: true` for that id. Any conflict copy must survive the delete.

### Server-side `_conflicts`

Rare but tested: create two revisions of one document without `new_edits` (for example with
`_bulk_docs` and explicit `_revisions`), reload a browser that pulls the document, and confirm:

- the winning document remains as the main note;
- exactly one `(conflict …)` note is created and pushed;
- the losing revision is gone from `?conflicts=true`;
- `_all_docs` contains exactly the two preserved notes.

---

## 12. Known limitations

- **Image size** — data URLs and the ~5 MB `localStorage` quota, as described in section 10.
- **Full-array rewrite** — each save serializes all notes and images. Fine for a personal notebook,
  not for a large media library.
- **Clock comparison** — pull uses `updatedAt` to decide which side is newer. Device clocks that are
  far apart can pick the wrong side; a conflict copy is only guaranteed for revision conflicts, not
  for timestamp comparisons.
- **Conflict granularity** — whole-note copies, no field or block merge. The main note can be
  overwritten by a retried local edit, but the other version is preserved as a copy first.
- **Edit vs. delete** — a pending edit wins over a remote tombstone, resurrecting the note. The
  deleted version has no content to preserve.
- **Polling, not live feed** — up to 30 seconds before another tab sees a change.
- **Static app credential** — acceptable on localhost only; needs TLS and a better auth model before
  remote access.
- **No compaction** — revisions and tombstones accumulate. Run `POST /thenoter/_compact` manually or
  add a schedule later.
- **Reset/restore and cursors** — a browser's cursor can outlive the database it belonged to. Clear
  `the-noter.sync.v1` (push local notes to a fresh database) or all site data (re-pull the server)
  after a reset or restore. See [README.md](README.md#client-sync-state-after-a-database-reset-or-restore).

---

## 13. Deliberately out of scope

- **Tailscale / remote devices** — both ports bind to `127.0.0.1`. Private networking comes after the
  local sync is proven.
- **Multi-user collaboration** — one owner, one app user, no presence or sharing.
- **Block-level merging (CRDT)** — Yjs/Automerge would merge simultaneous edits inside one note but
  add history and complexity. Conflict copies are the simpler first answer.
- **PouchDB/IndexedDB migration** — the local-first ordering is currently implemented directly on
  `localStorage`.
- **Automatic migrations** — `schema: 1` is reserved; no migration code exists.
- **Compaction schedule and tombstone purge** — documented, not automated.

## 14. Implementation status

1. [x] Create `thenoter`, add the app user, set `_security`.
2. [x] Generate runtime config with app-only credentials.
3. [x] Restrict CORS to the app origins.
4. [x] Push after local writes and pull by `_changes`.
5. [x] Persist the cursor, revisions, and pending queues.
6. [x] Tombstones on delete and remote tombstone handling.
7. [x] Conflict copies for push conflicts and server `_conflicts`.
8. [x] Offline retries, online/visibility triggers, and status pill.
9. [ ] Images as content-addressed attachments.
10. [ ] IndexedDB storage, compaction/purge schedule, TLS, and Tailscale.
