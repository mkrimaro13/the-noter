# Sync and replication notes

This document describes the sync that is actually implemented. The app does **not** use PouchDB. It
keeps `localStorage` as the primary store for notes (IndexedDB only caches image blobs, see
[section 10](#10-images-are-content-addressed-attachments)) and talks to CouchDB with the HTTP API
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
  "schema": 3,
  "title": "Reading list",
  "icon": "📚",
  "cover": "",
  "parentId": null,
  "favorite": false,
  "metadata": [{ "id": "m_1", "key": "Status", "value": "active", "type": "text", "options": [] }],
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
- `schema` is the document version. Every pushed note carries the current version (3). Documents
  without a readable `schema`, or with version 1 or 2, are migrated when they are pulled: missing
  metadata fields are filled with typed defaults, the `favorite` flag is backfilled with `false`,
  and the upgraded note is queued for re-push. A document with a newer version than the app knows
  is left untouched. See `frontend/src/app/schema.ts`.
- Image bytes live in `asset:<hash>` documents as attachments, not in the note body. Blocks only
  reference the hash. See [section 10](#10-images-are-content-addressed-attachments).

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
on both sides with no known revision, the push gets a conflict and the server version becomes a
pending decision (section 7), rather than being silently overwritten. Pending decisions are also
persisted, in `localStorage['the-noter.conflicts.v1']`, so a reload keeps them visible.

---

## 4. Push: `_bulk_docs`

**What** — Dirty note ids and pending deletes are sent together as one `POST /thenoter/_bulk_docs`.

**Why** — A single request per batch is cheaper than one request per keystroke, and `_bulk_docs`
reports success or conflict per document. It also lets a delete and a normal edit share a pass.

**How**

- A dirty note becomes one document with `_id`, `type`, `schema`, the note fields, and the last known
  `_rev` if there is one.
- A removed note becomes `{ "_id": "note:<id>", "_rev": "…", "_deleted": true, "type": "note",
  "deletedAt": <ms> }`. The revision is required if the note existed on the server; `deletedAt` lets
  the maintenance schedule age the tombstone out of the database (section 14).
- On success (`rev` in the response), the new revision is stored and the id leaves its queue.
- On `conflict`, the note is frozen as a pending decision (section 7) and the local change stays
  queued. If the server document no longer exists, the stored revision is dropped instead and the
  edit is retried as a fresh write.
- On `not_found` / `missing`, the stored revision is dropped. For a delete, the tombstone is
  considered done.
- Any other error stops the pass and moves the pill to **Sync error**.
- If an id is dirty but no longer exists in the notes array, it is converted into a tombstone. This
  covers a deletion that bypassed `markDeleted`.
- Ids with a pending conflict are never pushed; they wait for the user's decision.

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

**How** — Only ids starting with `note:` are considered. Ids with a pending conflict (section 7) are
skipped entirely until the user decides; their revision bookkeeping continues afterwards. For each
row:

- **Tombstone** (`deleted: true`): if the note is dirty or locally deleted, record the tombstone
  revision and leave the local operation queued. Otherwise remove the note locally and forget the
  revision.
- **Dirty note**: do not apply the remote body. Record its revision; the local edit is still queued
  and will be retried against it.
- **Locally deleted note**: ignore the remote body; the local tombstone wins this pass.
- **Remote note newer or equal**: migrate the document to the current `schema` (section 2), convert
  it into a note (restoring its id from `_id`) and apply it. A document that was upgraded by a
  migration is marked dirty so the migrated shape is pushed back. The local `updatedAt` is kept
  monotonic with `Math.max(remote, local)` so clock comparisons stay stable.
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
If both sides deleted and the revisions collide, the delete becomes a pending decision exactly like
an edit conflict.

Tombstones are not kept forever: each carries a `deletedAt` timestamp and the maintenance service
(section 14) purges them once they pass the retention window.

---

## 7. Conflicts become decisions, not automatic copies

**What** — If two devices change the same note before seeing each other's revision, the note is
**frozen** on both sides until the user picks one of three options in the sidebar:

```text
Sync conflicts (1)
  This device                        Server
  <preview of the local note>         <preview of the other version>
  [ Keep this device ] [ Keep server ] [ Keep both ]
```

**Why** — The previous behavior copied the other side into a `(conflict …)` note automatically. That
never loses text, but it also never tells the user what happened: they end up with two notes to clean
up and no explanation. A pending decision is explicit, survives a reload, and stops both queues for
that note so no side overwrites the other while the user reads the previews.

**How — detection.**

- **Push side** (`409 Conflict` from `_bulk_docs`): the app reads the current server document and
  records it as the "server" side. The local edit or delete stays queued. If the server document is
  gone (`404` on the read), there is nothing to decide: the stale revision is dropped and the local
  edit is retried as a fresh write.
- **Pull side** (the document carries `_conflicts`, i.e. CouchDB kept two branches): the winning
  revision is applied as a normal remote change, and each losing revision is fetched with
  `GET /thenoter/note:<id>?rev=<rev>` and recorded as the "server" side. The losing revision is **not**
  deleted from the server yet; that only happens after the decision, so a crash can never lose the
  losing text.

Decisions are deduplicated by `(note id, other revision)` and persisted in
`localStorage['the-noter.conflicts.v1']`.

**How — resolution.** `resolveConflict(id, 'mine' | 'theirs' | 'both')`:

| Choice                 | Push origin                                   | Pull origin                                              |
| ---------------------- | --------------------------------------------- | -------------------------------------------------------- |
| **Keep this device**  | Re-queue and push against the server revision | Nothing to push: the local copy already matches the winner |
| **Keep server**       | Replace the local note with the server version (forced, ignores `updatedAt`) and clear the queues | Adopt the losing revision locally (forced) and push it over the winner |
| **Keep both**          | Copy the server version to a new `(conflict …)` note and push the local edit | Copy the losing revision to a new `(conflict …)` note |

For a pending **delete**, "keep this device" keeps the deletion queued (the tombstone is retried
against the server revision), and "keep server" undoes the local deletion. In pull origins the losing
revision is finally removed with `DELETE /thenoter/note:<id>?rev=<losing>` once the decision is
applied and saved.

Conflict copies keep the original `parentId`, blocks, metadata, and image references, and get
`updatedAt` set to now. They are ordinary notes from then on.

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
| "Sync now" button       | Full pass immediately, always visible in the pill  |
| Failed pass             | Retry after 5 s, doubling to a 60 s ceiling         |
| More work while running | Run again immediately after the current pass        |

Queued ids with a pending conflict do not count as pending work, so the retry loop stops while the
user decides; the "Waiting" counter in the popover also ignores them.

A network failure (server unreachable, timeout) reports **Offline**. An HTTP 4xx/5xx or an unexpected
response reports **Sync error** with a short message; 401/403 specifically points at the app
credentials. The sidebar pill keeps "Saved locally" first in every state:

`Saved locally` · `Saved locally · Syncing…` · `Saved locally · Synced` ·
`Saved locally · Offline` · `Saved locally · Sync error` · `Not saved`

A sync that ends with pending decisions reports them in the pill's message ("1 note needs your
decision before syncing.") and the pill becomes a button that opens a diagnostics popover: status,
last sync, pending changes, server document counts, whether compaction is running, and the
maintenance schedule's progress (section 14). The counters come from `GET /thenoter` and
`GET /thenoter/meta%3Amaintenance` with the app credentials; a failed read keeps the last values.

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

## 10. Images are content-addressed attachments

**What** — Image bytes live in `asset:<sha256>` documents as CouchDB attachments. Note blocks only
store the reference (`asset:<hash>`), never the bytes.

**Why** — Inline data URLs added ~33% base64 overhead, were re-sent with every note save, counted
against the browser's ~5 MB `localStorage` quota, and were duplicated per note. Content addressing
means the same picture is uploaded once and referenced by any number of notes, and the browser keeps
a local blob cache in IndexedDB so images still render offline.

**How**

- Uploads happen with the app credentials **before** the note document that references them
  (`PUT /thenoter/asset:<hash>/blob`). A `409` there is fine: someone else already stored the same
  bytes.
- The note JSON carries only the hash; a failed upload blocks the note push, since a reference without
  bytes would render as a broken image.
- Pulls download referenced assets into an IndexedDB cache; the image directive retries its binding
  as soon as each blob lands.
- Asset documents keep `schema: 1`; only notes are versioned/migrated.

The local notes array therefore stays small; the practical size limit is now CouchDB and disk space,
not the localStorage quota.

---

## 11. Verification recipe

### Stack

```bash
cd /path/to/the-noter
cp .env.example .env          # replace both passwords
docker compose up -d --build
docker compose ps -a          # backend healthy, init exited 0, maintenance and frontend up

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
  -d '{"type":"note","schema":3,"title":"Test","parentId":null,
       "blocks":[],"metadata":[],"createdAt":0,"updatedAt":0}'

# Read it and note the _rev.
curl -s $APP http://127.0.0.1:5984/thenoter/note:test-1

# Update with that revision (a stale revision returns 409).
curl -s $APP -X PUT "http://127.0.0.1:5984/thenoter/note:test-1" \
  -H 'Content-Type: application/json' \
  -d '{"_rev":"1-…","type":"note","schema":3,"title":"Test edited",
       "parentId":null,"blocks":[],"metadata":[],"createdAt":0,"updatedAt":1}'

# Inspect changes and conflicts.
curl -s $APP 'http://127.0.0.1:5984/thenoter/_changes?since=0&include_docs=true'
curl -s $APP 'http://127.0.0.1:5984/thenoter/note:test-1?conflicts=true'

# Delete: a dated tombstone, not a hard removal.
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
   through the CouchDB API (`PUT` with its current `_rev`). Go online in A. The sidebar shows a
   "Sync conflicts" section with a preview of both sides. Confirm that pushing stops for that note
   until one of the three buttons is used, and that the chosen outcome is what ends up on the server.
6. Delete a synced note in B, confirm it is gone in A after a reload, and confirm
   `_changes` reports `deleted: true` for that id. Any conflict copy must survive the delete.
7. Click the refresh button in the sidebar footer: a full pass runs immediately, the pill shows the
   state, and clicking the pill opens the diagnostics popover with the server counters.

### Server-side `_conflicts`

Rare but tested: create two revisions of one document without `new_edits` (for example with
`_bulk_docs` and explicit `_revisions`), reload a browser that pulls the document, and confirm:

- the winning document is applied as the current note;
- the sidebar shows the losing branch as a pending decision (not an automatic copy);
- after choosing, the losing revision is gone from `?conflicts=true`;
- "Keep both" leaves exactly the two preserved notes.

### Maintenance

```bash
docker compose ps -a                              # the-noter-maintenance is Up
docker compose logs maintenance | tail -20        # one cycle log per interval
curl -s -u $COUCHDB_USER:$COUCHDB_PASSWORD \
  http://127.0.0.1:5984/thenoter/meta%3Amaintenance
# → firstRun, lastCompaction, lastPurge, purged, intervalSeconds
curl -s -u $COUCHDB_USER:$COUCHDB_PASSWORD \
  http://127.0.0.1:5984/thenoter | grep -o '"purge_seq":[^,]*'
```

The `meta:maintenance` document is written with the admin credentials; the app user can read it (the
popover does), but only the maintenance service updates it.

---

## 12. Known limitations

- **Full-array rewrite** — each save serializes all notes. Fine for a personal notebook, not for a
  large media library.
- **Clock comparison** — pull uses `updatedAt` to decide which side is newer. Device clocks that are
  far apart can pick the wrong side; revision conflicts become explicit decisions, but timestamp
  comparisons do not.
- **Conflict granularity** — whole-note decisions, no field or block merge. The chosen side is
  authoritative; "keep both" is the escape hatch.
- **Edit vs. delete** — a pending edit wins over a remote tombstone, resurrecting the note. When a
  local delete collides with a remote edit, it becomes a pending decision instead.
- **Polling, not live feed** — up to 30 seconds before another tab sees a change.
- **Static app credential** — acceptable on localhost only; needs TLS and a better auth model before
  remote access.
- **Reset/restore and cursors** — a browser's cursor can outlive the database it belonged to. Clear
  `the-noter.sync.v1` (push local notes to a fresh database) or all site data (re-pull the server)
  after a reset or restore. See [README.md](README.md#client-sync-state-after-a-database-reset-or-restore).

---

## 13. Deliberately out of scope

- **Tailscale / remote devices** — both ports bind to `127.0.0.1`. Private networking comes after the
  local sync is proven.
- **Multi-user collaboration** — one owner, one app user, no presence or sharing.
- **Block-level merging (CRDT)** — Yjs/Automerge would merge simultaneous edits inside one note but
  add history and complexity. Explicit decisions are the simpler first answer.
- **PouchDB migration** — the local-first ordering is currently implemented directly on
  `localStorage` (with an IndexedDB blob cache for images).

---

## 14. Scheduled maintenance: compaction and tombstone purge

**What** — The `maintenance` service in `docker-compose.yaml` runs
`backend/scripts/maintenance.mjs` every `MAINTENANCE_INTERVAL_SECONDS` (default 6 h). Each cycle
purges note tombstones older than `MAINTENANCE_RETENTION_DAYS` (default 30) and requests database
compaction, recording its progress in the `meta:maintenance` document.

**Why** — Deleted documents keep a tombstone and every edit keeps old revisions until compaction, so
an untouched database only grows. `_purge` and `_compact` require admin credentials, which the browser
never has, so the schedule runs server-side in the compose network. The retention window and the
`deletedAt` field written by the app make purge decisions predictable instead of "delete every
tombstone now".

**How**

- The script waits for `/_up`, then runs one cycle per interval; a failed cycle is logged and retried
  on the next interval.
- Tombstones are listed with `_all_docs?include_deleted=true&include_docs=true`; servers older than
  CouchDB 3.4 reject that parameter, so the script falls back to `_changes?since=0&include_docs=true`.
- A tombstone is purged when its `deletedAt` is older than the retention window. Tombstones written
  before `deletedAt` existed are purged only after `firstRun + retention`, so enabling the schedule
  never deletes old history immediately.
- Purge is a single `POST /thenoter/_purge` with `{ "<docid>": ["<rev>"] }` for every target; the
  response confirms the purged revisions.
- Compaction is requested with `POST /thenoter/_compact` (202 Accepted) unless the database reports
  `compact_running: true`.
- The progress document (`meta:maintenance`) records `firstRun`, `lastCompaction`, `lastPurge`,
  `purged` (cumulative), and `intervalSeconds`. It is read by the sync diagnostics popover
  (section 8).
- `node --test backend/scripts/maintenance.test.mjs` covers the cycle against an in-process CouchDB
  emulator.

## 15. Implementation status

1. [x] Create `thenoter`, add the app user, set `_security`.
2. [x] Generate runtime config with app-only credentials.
3. [x] Restrict CORS to the app origins.
4. [x] Push after local writes and pull by `_changes`.
5. [x] Persist the cursor, revisions, and pending queues.
6. [x] Tombstones on delete (dated) and remote tombstone handling.
7. [x] Conflict decisions for push conflicts and server `_conflicts`, with a UI.
8. [x] Offline retries, online/visibility triggers, "sync now", and status pill with diagnostics.
9. [x] Images as content-addressed attachments.
10. [x] Per-document `schema` migrations.
11. [x] Compaction/purge schedule and tombstone retention.
12. [ ] IndexedDB storage for notes, TLS, and Tailscale.
