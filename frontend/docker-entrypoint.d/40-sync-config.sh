#!/bin/sh
# The nginx image runs this before starting the server. It turns the compose
# environment into the small config file the Angular app fetches at startup.
set -eu

output=/usr/share/nginx/html/sync-config.json

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

if [ -z "${SYNC_URL:-}" ] || [ -z "${SYNC_USER:-}" ] || [ -z "${SYNC_PASSWORD:-}" ]; then
  printf '%s\n' '{"enabled":false}' > "$output"
  exit 0
fi

url=$(printf '%s' "$SYNC_URL" | sed 's:/*$::')
tmp=$(mktemp)
printf '{"enabled":true,"url":"%s","username":"%s","password":"%s"}\n' \
  "$(json_escape "$url")" \
  "$(json_escape "$SYNC_USER")" \
  "$(json_escape "$SYNC_PASSWORD")" > "$tmp"
chmod 644 "$tmp"
mv "$tmp" "$output"
