# The Noter

A local-first note-taking app with an optional self-hosted sync server.

The repository is split into two independent projects:

| Folder      | What it is                                                  | Stack                                        |
| ----------- | ----------------------------------------------------------- | -------------------------------------------- |
| `frontend/` | The Angular app. Writes locally first, then syncs in place. | Angular 22, signals, `localStorage`, `fetch` |
| `backend/`  | The self-hosted database and its one-time bootstrap.        | CouchDB 3, Docker, Compose                   |

## Current state

- **Local first.** Every change is written to `localStorage` first (after a 250 ms debounce). Only
  after that does the app send the changed note to CouchDB. The app keeps working with no network,
  and pending changes are retried when the server comes back.
- **Per-note documents.** Each note is one document (`note:<id>`) in the `thenoter` database.
  Creates, edits, and deletes travel independently; deletes are CouchDB tombstones.
- **Conflicts keep both versions.** If two devices edit the same note before seeing each other, the
  losing version is saved as a new note titled `Title (conflict YYYY-MM-DD HH:mm)` instead of being
  overwritten.
- **Least privilege.** The browser only ever sees the `thenoter` app user, delivered at runtime in
  `/sync-config.json`. The admin user is used only by the one-shot `init` service and manual `curl`
  commands.
- **Localhost only.** CouchDB (`127.0.0.1:5984`) and the app (`127.0.0.1:8080`) are not reachable
  from other devices. Tailscale and remote access are a later step.
- **Images are still inline data URLs.** They sync with the note JSON but share the browser's
  roughly 5 MB `localStorage` quota. Moving them to CouchDB attachments is the next storage
  milestone.

## Quick start (development)

The app talks to CouchDB directly, so start the database first, then the dev server.

```bash
# From the repository root: create .env and start CouchDB + init
cp .env.example .env      # replace both passwords
docker compose up -d backend init

# In another terminal
cd frontend
npm install
npm start
```

Open `http://localhost:4200/`.

`npm start` generates `frontend/public/sync-config.json` from the root `.env` before the dev server
starts. If `SYNC_URL`, `COUCHDB_APP_USER`, or `COUCHDB_APP_PASSWORD` is missing, the generated config
disables sync and the app behaves like the original offline notebook.

## Quick start (containers)

```bash
cp .env.example .env      # replace both passwords
docker compose up -d --build
```

| Service  | URL                     | Notes                                              |
| -------- | ----------------------- | -------------------------------------------------- |
| Frontend | `http://127.0.0.1:8080` | Static production build served by nginx            |
| Database | `http://127.0.0.1:5984` | CouchDB, admin/app users, localhost binding        |
| `init`   | —                       | One-shot; exits 0 after creating the database/user |

The `init` service runs after CouchDB is healthy and before the frontend starts. It creates the
`thenoter` database, the least-privilege `thenoter` app user, and the database security rules. It is
safe to run on every start.

Check the stack:

```bash
curl http://127.0.0.1:5984/_up
curl http://127.0.0.1:8080/sync-config.json   # app credentials, no-store
docker compose ps -a
```

Both ports are published to `127.0.0.1` only. Nothing is reachable from other devices yet.

The admin password is applied **only on the first database initialization**. The app password can be
changed by editing `.env` and running `docker compose up -d` again; the init service updates the app
user in place. See `backend/README.md` for password rotation and reset instructions.

## Configuration

All settings live in the root `.env` (git-ignored, `chmod 600`). [`.env.example`](.env.example) is
the template.

| Variable               | Used by        | Purpose                                               |
| ---------------------- | -------------- | ----------------------------------------------------- |
| `COUCHDB_USER`         | backend, init  | Admin user; only for initialization and manual `curl` |
| `COUCHDB_PASSWORD`     | backend, init  | Admin password; applied on first start only           |
| `COUCHDB_DB`           | init           | Database name, `thenoter`                             |
| `COUCHDB_APP_USER`     | init, frontend | Least-privilege user stored in `/sync-config.json`    |
| `COUCHDB_APP_PASSWORD` | init, frontend | App password stored in `/sync-config.json`            |
| `SYNC_URL`             | frontend       | CouchDB database URL or path the browser calls           |

The frontend never receives the admin credentials. It fetches `/sync-config.json` at startup; nginx
serves that file with `Cache-Control: no-store`.

## Repository layout

```
.
├── docker-compose.yaml          backend + one-shot init + frontend
├── .env.example                 credential and sync template
├── frontend/                    Angular app, nginx config, runtime sync config
│   ├── src/app/sync.ts          localStorage-first push/pull sync
│   └── scripts/                 dev config generation
└── backend/                     CouchDB image, config, init script, data folder
    ├── data/                    persisted database files (not committed)
    ├── config/local.ini         single-node, CORS, document size
    ├── scripts/init-couchdb.sh  database, app user, security rules
    └── REPLICATION.md           implemented sync design and verification
```

## Documentation

- [frontend/README.md](frontend/README.md) — features, sync behavior, storage keys, scripts.
- [backend/README.md](backend/README.md) — services, credentials, CORS, operations.
- [backend/REPLICATION.md](backend/REPLICATION.md) — document shape, push/pull, conflicts,
  tombstones, verification recipe.

## Roadmap

1. [x] Split the repository into `frontend/` and `backend/`.
2. [x] Run CouchDB with a persistent data folder.
3. [x] Create the `thenoter` database, a non-admin app user, and security rules.
4. [x] Local-first sync: push after local writes, pull by `_changes`, offline retries.
5. [x] Tombstones, conflict copies, and deferred resolution of server conflicts.
6. [x] Restricted CORS and runtime config so admin credentials never reach the browser.
7. [ ] Extract images from note JSON into CouchDB attachments.
8. [ ] Move the local store to IndexedDB to raise the ~5 MB quota.
9. [ ] Compaction and tombstone purge schedule.
10. [ ] Private remote access (Tailscale) once local sync is proven.
