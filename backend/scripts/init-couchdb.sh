#!/bin/sh
# Create the notes database, the least-privilege app user, and its security
# rules. Runs once per `docker compose up` and is safe to repeat.
set -eu

: "${COUCHDB_URL:?COUCHDB_URL is required}"
: "${COUCHDB_USER:?COUCHDB_USER is required}"
: "${COUCHDB_PASSWORD:?COUCHDB_PASSWORD is required}"
: "${COUCHDB_DB:?COUCHDB_DB is required}"
: "${COUCHDB_APP_USER:?COUCHDB_APP_USER is required}"
: "${COUCHDB_APP_PASSWORD:?COUCHDB_APP_PASSWORD is required}"

ADMIN_AUTH="$COUCHDB_USER:$COUCHDB_PASSWORD"
APP_USER_ID="org.couchdb.user:$COUCHDB_APP_USER"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

# Wait for the system databases; a healthy /_up does not guarantee they exist yet.
attempt=0
until curl -fsS -u "$ADMIN_AUTH" "$COUCHDB_URL/_users" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then
    echo "CouchDB system databases did not become ready in time." >&2
    exit 1
  fi
  sleep 1
done

# 201 = created, 202 = accepted, 412 = already exists.
status=$(curl -s -o "$TMP_DIR/db.json" -w '%{http_code}' \
  -u "$ADMIN_AUTH" -X PUT "$COUCHDB_URL/$COUCHDB_DB")
case "$status" in
  201 | 202 | 412) ;;
  *)
    echo "Could not create database '$COUCHDB_DB' (HTTP $status)." >&2
    cat "$TMP_DIR/db.json" >&2
    exit 1
    ;;
esac

# Reuse the current revision when the user already exists, so the password can
# be changed by editing .env and running compose up again.
user_doc=$(curl -fsS -u "$ADMIN_AUTH" "$COUCHDB_URL/_users/$APP_USER_ID" 2>/dev/null || true)
user_rev=$(printf '%s' "$user_doc" | sed -n 's/.*"_rev":"\([^"]*\)".*/\1/p')
if [ -n "$user_rev" ]; then
  user_body="{\"_id\":\"$APP_USER_ID\",\"_rev\":\"$user_rev\",\"name\":\"$COUCHDB_APP_USER\",\"type\":\"user\",\"roles\":[],\"password\":\"$COUCHDB_APP_PASSWORD\"}"
else
  user_body="{\"_id\":\"$APP_USER_ID\",\"name\":\"$COUCHDB_APP_USER\",\"type\":\"user\",\"roles\":[],\"password\":\"$COUCHDB_APP_PASSWORD\"}"
fi

status=$(curl -s -o "$TMP_DIR/user.json" -w '%{http_code}' \
  -u "$ADMIN_AUTH" -X PUT "$COUCHDB_URL/_users/$APP_USER_ID" \
  -H 'Content-Type: application/json' -d "$user_body")
case "$status" in
  201 | 202) ;;
  *)
    echo "Could not create app user '$COUCHDB_APP_USER' (HTTP $status)." >&2
    cat "$TMP_DIR/user.json" >&2
    exit 1
    ;;
esac

# Only the app user may read and write the notes database. It has no admin role.
status=$(curl -s -o "$TMP_DIR/security.json" -w '%{http_code}' \
  -u "$ADMIN_AUTH" -X PUT "$COUCHDB_URL/$COUCHDB_DB/_security" \
  -H 'Content-Type: application/json' \
  -d "{\"members\":{\"names\":[\"$COUCHDB_APP_USER\"]},\"admins\":{\"names\":[]}}")
case "$status" in
  200 | 201 | 202) ;;
  *)
    echo "Could not set security on '$COUCHDB_DB' (HTTP $status)." >&2
    cat "$TMP_DIR/security.json" >&2
    exit 1
    ;;
esac

echo "CouchDB ready: database '$COUCHDB_DB', app user '$COUCHDB_APP_USER'."
