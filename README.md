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
  Creates, edits, and deletes travel independently; deletes are dated CouchDB tombstones that the
  maintenance schedule purges after a retention window.
- **Conflicts are decisions.** If two devices edit the same note before seeing each other, the note
  is frozen in a "Sync conflicts" section that previews both sides. Nothing is overwritten until the
  user keeps this device's version, the server's, or both; pending decisions survive a reload.
- **Least privilege.** The browser only ever sees the `thenoter` app user, delivered at runtime in
  `/sync-config.json`. The admin user is used only by the one-shot `init` service, the `maintenance`
  schedule, and manual `curl` commands.
- **Localhost only.** CouchDB (`127.0.0.1:5984`) and the app (`127.0.0.1:8080`) are not reachable
  from other devices. Tailscale and remote access are a later step.
- **Images are attachments.** Picture bytes live in `asset:<sha256>` CouchDB documents and are
  cached locally in IndexedDB, so the notes array in `localStorage` stays small.
- **Search that shows its matches.** The sidebar search highlights every hit — note titles in the
  list, writing previews in the editor, and results in the command palette — and can narrow the
  list with filters (favorites, images, code, last edit, metadata). Starred notes are pinned as
  favorites with their own quick-access section in the sidebar.
- **Server maintenance.** A `maintenance` service purges old delete tombstones and requests
  compaction on a schedule (every 6 h by default), so the database does not grow forever. Its
  progress is shown in the app's diagnostics popover next to the "Sync now" button.

## Quick start (development)

The app talks to CouchDB directly, so start the database first, then the dev server.

```bash
# From the repository root: create .env and start CouchDB + init + maintenance
cp .env.example .env      # replace both passwords
docker compose up -d backend init maintenance

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

> If the build prints `buildx Docker CLI plugin not found: falling back to the classic builder`,
> that is a host-level Docker CLI plugin, not a repository setting. Install Docker Buildx (for
> example `sudo apt install docker-buildx-plugin`) or run
> `DOCKER_BUILDKIT=0 docker compose up -d --build` to use the classic builder without the warning.

| Service      | URL                     | Notes                                               |
| ------------ | ----------------------- | --------------------------------------------------- |
| Frontend     | `http://127.0.0.1:8080` | Static production build served by nginx             |
| Database     | `http://127.0.0.1:5984` | CouchDB, admin/app users, localhost binding         |
| `init`       | —                       | One-shot; exits 0 after creating the database/user |
| `maintenance` | —                      | Purges old tombstones and compacts every 6 h       |

The `init` service runs after CouchDB is healthy and before the frontend starts. It creates the
`thenoter` database, the least-privilege `thenoter` app user, and the database security rules. It is
safe to run on every start. The `maintenance` service runs `backend/scripts/maintenance.mjs` with the
admin credentials, because only admins may call `_purge` and `_compact`.

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

| Variable               | Used by             | Purpose                                                |
| ---------------------- | ------------------- | ------------------------------------------------------ |
| `COUCHDB_USER`         | backend, init       | Admin user; only for initialization and manual `curl`  |
| `COUCHDB_PASSWORD`     | backend, init       | Admin password; applied on first start only            |
| `COUCHDB_DB`           | init, maintenance   | Database name, `thenoter`                              |
| `COUCHDB_APP_USER`     | init, frontend      | Least-privilege user stored in `/sync-config.json`     |
| `COUCHDB_APP_PASSWORD` | init, frontend      | App password stored in `/sync-config.json`             |
| `SYNC_URL`             | frontend            | CouchDB database URL or path the browser calls         |
| `MAINTENANCE_INTERVAL_SECONDS` | maintenance | Seconds between purge/compact cycles (default 21600) |
| `MAINTENANCE_RETENTION_DAYS`   | maintenance | Days a tombstone is kept before purging (default 30)  |

The frontend never receives the admin credentials. It fetches `/sync-config.json` at startup; nginx
serves that file with `Cache-Control: no-store`.

## Repository layout

```
.
├── docker-compose.yaml          backend + one-shot init + maintenance + frontend
├── .env.example                 credential and sync template
├── frontend/                    Angular app, nginx config, runtime sync config
│   ├── src/app/sync.ts          localStorage-first push/pull sync
│   └── scripts/                 dev config generation
└── backend/                     CouchDB image, config, init script, data folder
    ├── data/                    persisted database files (not committed)
    ├── config/local.ini         single-node, CORS, document size
    ├── scripts/init-couchdb.sh  database, app user, security rules
    ├── scripts/maintenance.mjs  tombstone purge and compaction schedule
    └── REPLICATION.md           implemented sync design and verification
```

## Documentation

- [frontend/README.md](frontend/README.md) — features, sync behavior, storage keys, scripts.
- [backend/README.md](backend/README.md) — services, credentials, CORS, operations.
- [backend/REPLICATION.md](backend/REPLICATION.md) — document shape, push/pull, conflicts,
  tombstones, scheduled maintenance, verification recipe.

## Roadmap

1. [x] Split the repository into `frontend/` and `backend/`.
2. [x] Run CouchDB with a persistent data folder.
3. [x] Create the `thenoter` database, a non-admin app user, and security rules.
4. [x] Local-first sync: push after local writes, pull by `_changes`, offline retries.
5. [x] Tombstones and conflict decisions with a sidebar UI.
6. [x] Restricted CORS and runtime config so admin credentials never reach the browser.
7. [x] Images as content-addressed CouchDB attachments.
8. [x] Per-document schema migrations.
9. [x] Compaction and tombstone purge schedule.
10. [ ] Move the local store to IndexedDB to raise the ~5 MB quota.
11. [ ] Private remote access (Tailscale) once local sync is proven.
