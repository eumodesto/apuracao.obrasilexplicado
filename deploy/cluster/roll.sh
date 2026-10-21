#!/bin/sh
# Updates a worker machine one app process at a time, so the other six keep answering.
#   cd /opt/apuracao && git pull && sh deploy/cluster/roll.sh
set -e
cd "$(dirname "$0")/../.."
compose="docker compose -p apuracao -f deploy/cluster/worker.yml --env-file .env.production"
$compose build app1
for n in 1 2 3 4 5 6 7; do
  $compose up -d --no-deps "app$n"
  until [ "$($compose ps "app$n" --format '{{.Status}}' | grep -c '(healthy)')" = 1 ]; do sleep 2; done
  echo "app$n atualizado"
done
