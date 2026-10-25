#!/usr/bin/env bash
# Publishes the static files of the freshly built image to ./static, which Caddy serves directly
# (see deploy/Caddyfile). Run from the project directory after `docker compose build`, BEFORE
# restarting the app containers:
#
#   bash deploy/publish-static.sh
#
# - Merges into ./static and never deletes: visitors holding an older page still ask for the
#   previous build's hashed chunks, and those names never change content. Old files are pruned
#   after 30 days.
# - Compresses once here (gzip, plus brotli when installed) so Caddy spends no CPU per request.
set -euo pipefail
cd "$(dirname "$0")/.."

IMAGE=${IMAGE:-apuracao-app:latest}
OUT=static
mkdir -p "$OUT/_next/static"

cid=$(docker create "$IMAGE")
trap 'docker rm -f "$cid" >/dev/null 2>&1 || true' EXIT
docker cp "$cid:/app/.next/static/." "$OUT/_next/static/"
docker cp "$cid:/app/public/." "$OUT/"
# Metadata icons are routes in the app, not files in public/.
cp -f src/app/favicon.ico src/app/apple-icon.png "$OUT/"

# Readable by the Caddy container whatever uid the files came with.
chmod -R a+rX "$OUT"

compress() {
  local f=$1
  if [ ! -f "$f.gz" ] || [ "$f" -nt "$f.gz" ]; then gzip -9 -kf "$f"; fi
  if command -v brotli >/dev/null 2>&1; then
    if [ ! -f "$f.br" ] || [ "$f" -nt "$f.br" ]; then brotli -q 9 -kf "$f"; fi
  fi
}
export -f compress
find "$OUT" -type f \( -name '*.js' -o -name '*.css' -o -name '*.svg' -o -name '*.json' \
  -o -name '*.ico' -o -name '*.txt' -o -name '*.map' -o -name '*.html' \) \
  ! -name '*.gz' ! -name '*.br' -print0 | xargs -0 -P 4 -I{} bash -c 'compress "$1"' _ {}
chmod -R a+rX "$OUT"

find "$OUT/_next/static" -type f -mtime +30 -delete 2>/dev/null || true
echo "published: $(find "$OUT" -type f ! -name '*.gz' ! -name '*.br' | wc -l) files, $(du -sh "$OUT" | cut -f1)"
