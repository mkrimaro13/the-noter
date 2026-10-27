# The Noter — backend

CouchDB is the sync target for the notebook. The frontend is connected and syncs through the CouchDB
HTTP API. Everything still binds to localhost: there is **no Tailscale, no public exposure, and no
account system** beyond one restricted database user.

## What runs here

- One **CouchDB 3** container, built from `backend/Dockerfile`.
- Configuration in `backend/config/local.ini`: single node, HTTP binding, restricted CORS, and a
  larger document ceiling.
- All database files persisted in `backend/data/` through a bind mount.
- An **admin user** from `COUCHDB_USER` / `COUCHDB_PASSWORD`, applied on first initialization.
- A one-shot **`init` service** that creates the `thenoter` database, the least-privilege `thenoter`
  app user, and the database `_security` rules. It runs after CouchDB is healthy and before the
  frontend starts, and is safe to repeat.
- Published on `127.0.0.1:5984` only, so other devices cannot reach it yet.

```
backend/
├── Dockerfile                CouchDB image + config + init script + healthcheck
├── .dockerignore             keeps the build context tiny
├── config/
│   └── local.ini             single-node, CORS, document size
├── scripts/
│   └── init-couchdb.sh       database, app user, security rules
├── data/                     CouchDB database files (git-ignored)
├── README.md                 this file
└── REPLICATION.md            document and sync design, verification recipe
```

## Quick start

From the repository root:

```bash
cp .env.example .env          # replace both passwords
docker compose up -d --build
docker compose ps -a          # backend healthy, init exited 0, frontend up
docker compose logs init      # "CouchDB ready: database 'thenoter', app user 'thenoter'."
```

Verify:

```bash
set -a && . ./.env && set +a

curl -s http://127.0.0.1:5984/_up

# The app user can use the notes database...
curl -s -o /dev/null -w '%{http_code}\n' \
  -u "$COUCHDB_APP_USER:$COUCHDB_APP_PASSWORD" \
  "http://127.0.0.1:5984/$COUCHDB_DB"

# ...but cannot reach another database or list all databases.
curl -s -o /dev/null -w '%{http_code}\n' \
  -u "$COUCHDB_APP_USER:$COUCHDB_APP_PASSWORD" \
  http://127.0.0.1:5984/_users
curl -s -o /dev/null -w '%{http_code}\n' \
  -u "$COUCHDB_APP_USER:$COUCHDB_APP_PASSWORD" \
  http://127.0.0.1:5984/_all_dbs

# Anonymous access is refused.
curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:5984/$COUCHDB_DB"
```

Useful commands:

```bash
docker compose logs -f backend
docker compose logs init
docker compose stop backend
docker compose down            # keeps backend/data
docker compose run --rm init   # re-run the bootstrap explicitly
```

## How it fits together

### 1. CouchDB in a container

**What** — The database server runs as one Docker service built from `backend/Dockerfile`, based on
the official `couchdb:3` image.

**Why** — CouchDB is free, open source, stores JSON documents natively, and its HTTP API is enough
for the browser client. Running it in Docker keeps the host clean and the service reproducible.

**How** — `docker compose up -d --build` builds the image and starts the container on port 5984. The
image adds only a config file, the init script, and a healthcheck on top of the official image.

### 2. Persistent data folder

**What** — `backend/data/` is bind-mounted to `/opt/couchdb/data` inside the container.

**Why** — A container is disposable; the notes are not. A visible folder is easy to back up, inspect,
and move, and it is the only place CouchDB writes state.

**How** — The mount is declared in the root `docker-compose.yaml`:

```yaml
volumes:
  - ./backend/data:/opt/couchdb/data
```

CouchDB creates `_dbs.couch`, `_nodes.couch`, and a `shards/` tree there on first start. Do not edit
these by hand, and stop the container before copying the folder.

### 3. Single node

**What** — `[couchdb] single_node = true`, `[cluster] q = 1`, `[cluster] n = 1`.

**Why** — The server is one personal machine. Single-node mode creates the system databases
(`_users`, `_replicator`, `_global_changes`) automatically and avoids waiting for cluster copies that
will never exist.

**How** — The file is copied into `/opt/couchdb/etc/local.d/10-thenoter.ini` at build time. CouchDB
loads every `*.ini` in `local.d/` after `local.ini`, so the settings apply on every start.

### 4. Admin credentials

**What** — One admin user, supplied through `.env` (`COUCHDB_USER`, `COUCHDB_PASSWORD`).

**Why** — Without an admin user, CouchDB 3 refuses to start in single-node mode. The admin is needed
to create the database and the app user, and for manual inspection; the browser never receives it.

**How** — Copy `.env.example` to `.env` and change the password. The official image reads the two
variables **only on first initialization**; editing `.env` later does not rotate an existing admin.

Important: the `init` service authenticates with the admin credentials from `.env` on every start. If
you change `COUCHDB_PASSWORD` in `.env` without rotating it in CouchDB, `init` fails with 401 and the
frontend will not start. Either rotate the server password first (below) and then update `.env`, or
reset the data folder.

### 5. App user and security rules

**What** — The `init` service creates `org.couchdb.user:thenoter` with no roles and sets
`thenoter/_security` to members `["thenoter"]`, admins `[]`.

**Why** — The admin can create and delete databases. The browser needs only read/write access to one
database. A separate user means a leaked browser credential cannot touch `_users`, `_all_dbs`, or any
other database.

**How** — `backend/scripts/init-couchdb.sh` waits for the system databases, creates `thenoter`
(201/202/412 are all accepted), creates or updates the user document, and writes `_security`. It
reuses the user's `_rev` when the user already exists, which is why changing
`COUCHDB_APP_PASSWORD` in `.env` and running `docker compose up -d` also rotates the app password.

### 6. CORS

**What** — CORS is enabled only for the app's local origins: `127.0.0.1` / `localhost` on port 8080
(container) and 4200 (Angular dev server).

**Why** — The browser and CouchDB are different origins, so the preflight must succeed. Allowing only
these origins keeps a random website from calling the database with the user's network position;
authentication is still required for every request.

**How** — In `config/local.ini`:

```ini
[httpd]
enable_cors = true

[cors]
origins = http://127.0.0.1:8080, http://localhost:8080, http://127.0.0.1:4200, http://localhost:4200
credentials = false
headers = accept, authorization, content-type, origin, referer
methods = GET, PUT, POST, HEAD, DELETE, OPTIONS
```

CORS is not authentication. The app password is still required, and it is still readable from
`/sync-config.json` by anyone who can load the app.

### 7. Localhost-only binding

**What** — Compose publishes `127.0.0.1:5984:5984` and `127.0.0.1:8080:80`.

**Why** — This stage is local-only by design. Binding to `127.0.0.1` means the LAN cannot reach the
database or the app, even if a firewall is misconfigured. Remote access will be added later through
Tailscale, not by opening a port.

**How** — The `ports` entries in `docker-compose.yaml` include the `127.0.0.1:` prefix. Remove it only
when a private tunnel is in place and you understand the exposure.

### 8. Healthcheck and startup order

**What** — CouchDB healthchecks `GET /_up` every 30 seconds. The `init` service waits for
`backend: healthy`; the frontend waits for both `backend: healthy` and
`init: service_completed_successfully`.

**Why** — `/_up` is unauthenticated and only returns 200 when the database is actually serving
requests. Waiting for `init` means the app never starts against a database that has no user or
security rules.

**How** — Declared in `Dockerfile` and repeated in Compose. `/_up` answers `{"status":"ok"}`.

## The synced data

- Database: `thenoter` (configurable through `COUCHDB_DB`).
- One document per note, `_id: "note:<local note id>"`, with `type: "note"` and `schema: 1`.
- Deletes are tombstones (`_deleted: true`); they keep traveling through `_changes`.
- CouchDB revisions are stored by the browser per note, so `409 Conflict` is detected instead of
  silently overwriting another device.
- Conflict revisions are copied into separate notes before the losing revision is deleted from the
  server.

The exact document shape, push/pull order, and conflict handling are in
[REPLICATION.md](REPLICATION.md).

## Configuration reference

`backend/config/local.ini`:

| Setting                       | Value                  | Reason                                                   |
| ----------------------------- | ---------------------- | -------------------------------------------------------- |
| `[couchdb] single_node`       | `true`                 | one machine, automatic system databases                  |
| `[cluster] q`, `[cluster] n`  | `1` / `1`              | one shard, one copy; matches a single node               |
| `[chttpd] bind_address`       | `0.0.0.0`              | reachable through Docker's port mapping                  |
| `[chttpd] require_valid_user` | `false`                | keeps `/_up` public; database calls still require a user |
| `[httpd] enable_cors`         | `true`                 | the browser calls CouchDB directly                       |
| `[cors] origins`              | four localhost origins | exactly the app's dev and container origins              |
| `[couchdb] max_document_size` | `50000000`             | room for a full note document (50 MB)                    |

Compose environment:

| Variable               | Service       | Notes                                               |
| ---------------------- | ------------- | --------------------------------------------------- |
| `COUCHDB_USER`         | backend, init | admin name; must match the initialized server       |
| `COUCHDB_PASSWORD`     | backend, init | admin password; first start only for CouchDB itself |
| `COUCHDB_DB`           | init          | database name, default `thenoter`                   |
| `COUCHDB_APP_USER`     | init          | app user name, default `thenoter`                   |
| `COUCHDB_APP_PASSWORD` | init          | app password; also passed to the frontend           |
| `SYNC_URL`             | frontend      | database URL rendered into `/sync-config.json`      |

## Operations

### Logs

```bash
docker compose logs -f backend
docker compose logs init
```

### Backup

Stop writes first, then copy the whole folder:

```bash
docker compose stop backend
cp -a backend/data "backup-$(date +%F)"
docker compose start backend
```

CouchDB runs as uid `5984` inside the container, so the files in `backend/data` are owned by `5984`
on the host. Copying them works as your normal user; deleting or restoring them needs `sudo` or a
root helper container.

For an online backup, replicate the database to a second local database or use `couchdb-dump`; both
are safer once real notes exist.

### Restore

```bash
docker compose stop backend
sudo rm -rf backend/data/*
sudo cp -a backup-YYYY-MM-DD/. backend/data/
docker compose start backend
```

Then reset the browser's sync cursor as described below, or clear site data in the browser, before
trusting the result. A restored database can be older than the cursor a browser already has.

### Reset the database

```bash
docker compose down
docker run --rm -v "$PWD/backend/data:/data" alpine \
  sh -c 'find /data -mindepth 1 ! -name .gitignore -exec rm -rf {} +'
docker compose up -d --build
```

The admin user and app user are recreated from `.env` on the next start. This erases every synced
note. Notes still in a browser's `localStorage` remain there, but the browser's sync cursor points at
the old database.

### Rotate the app password

```bash
# 1. Edit COUCHDB_APP_PASSWORD in .env.
# 2. Recreate the init service so it updates the CouchDB user...
docker compose up -d
# ...then make sure the frontend picked up the new value.
docker compose up -d --force-recreate frontend
```

`/sync-config.json` is rewritten at frontend start. Open the app again; existing browsers fetch the
new config on reload.

### Rotate the admin password

Rotate it in CouchDB first, then update `.env`:

```bash
curl -u admin:old-password -X PUT \
  http://127.0.0.1:5984/_node/_local/_config/admins/admin \
  -H 'Content-Type: application/json' -d '"new-password"'
```

Update `COUCHDB_PASSWORD` in `.env` to match, then restart the stack. Doing it in the other order
breaks the `init` service until the values match again.

### Client sync state after a database reset or restore

The browser stores its `_changes` cursor, known revisions, and pending ids in
`localStorage['the-noter.sync.v1']`.

- After **deleting** the database, remove that key and reload the app. Notes in `localStorage` are
  then treated as unsynced and pushed into the fresh database.
- After **restoring an older backup**, decide which side wins before doing that: clearing the key
  pushes every local note and may create conflict copies against the restored server. Clearing all
  site data pulls the server copy instead.

## Troubleshooting

| Symptom                                 | Cause / fix                                                                                                               |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `init` exits non-zero, 401              | `.env` admin password does not match CouchDB. Restore the old value, rotate the server password, or reset `backend/data`. |
| Frontend up but pill says `Sync error`  | Check `/sync-config.json`, the app password, and the init logs.                                                           |
| Browser console shows a CORS error      | The app origin is not in `[cors] origins`. Add the exact scheme/host/port.                                                |
| `Database directory is not writable`    | Host folder ownership. `sudo chown -R 5984:5984 backend/data`                                                             |
| `/_up` returns 401                      | Should not happen; `/_up` is public. Check the port and container.                                                        |
| `docker compose up` says port is in use | Another CouchDB or dev proxy owns 5984. Change the host port.                                                             |
| Login fails after editing `.env`        | The admin password is only applied on first init. Rotate it manually.                                                     |
| Container restarts in a loop            | `docker compose logs backend`; usually a config or permission error.                                                      |
| Deleted notes come back                 | The client is replaying stale state. Check the tombstone and the sync cursor; see the reset/restore notes above.          |

## Security notes

- The database and app are bound to localhost.
- CouchDB requires authentication. `/_up` is the only intentionally public endpoint.
- The browser receives only the `thenoter` app user. It cannot read `_users`, list databases, or
  touch another database; both were verified with `curl`.
- CORS is limited to the app's four localhost origins, but CORS is not an access-control boundary for
  non-browser clients. The app password in `/sync-config.json` is the real secret.
- The static app password is acceptable only while everything is localhost-only. Before remote
  access, add TLS and a proper authentication story instead of shipping a shared database password
  to every client.
- No Tailscale, no Funnel, no public DNS yet.

## Roadmap

- [x] CouchDB container and persistent `data/` folder.
- [x] Single-node config, admin user, healthcheck, localhost binding.
- [x] Create the `thenoter` database and its security rules.
- [x] Add a non-admin app user for the frontend.
- [x] Enable CORS for the app origins.
- [x] Local-first push/pull sync with revisions, tombstones, and offline retries.
- [x] Conflict copies, including server-side `_conflicts`.
- [ ] Images as CouchDB attachments instead of inline data URLs.
- [ ] Compaction and tombstone purge schedule.
- [ ] TLS, a stronger credential model, and Tailscale access from other devices.
