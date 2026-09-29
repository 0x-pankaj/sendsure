#!/usr/bin/env bash
# The same as docker-compose.yml, with plain docker commands (for machines without Compose).
#   ./run.sh up      Odoo 19 Community + Postgres with the add-on, on http://127.0.0.1:18069 (admin / admin)
#   ./run.sh test    run the add-on's Odoo tests in a throwaway database, then drop it
#   ./run.sh down    remove the containers, network and data
set -euo pipefail
cd "$(dirname "$0")"
NET=sendsure-odoo
db() {
  docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET" >/dev/null
  if ! docker container inspect "$NET-db" >/dev/null 2>&1; then
    docker run -d --name "$NET-db" --network "$NET" \
      -e POSTGRES_USER=odoo -e POSTGRES_PASSWORD=odoo -e POSTGRES_DB=postgres postgres:16 >/dev/null
    sleep 5
  fi
  docker start "$NET-db" >/dev/null
}
case "${1:-up}" in
  up)
    db
    if docker container inspect "$NET-odoo" >/dev/null 2>&1; then
      docker start "$NET-odoo" >/dev/null
    else
      docker run -d --name "$NET-odoo" --network "$NET" -p 127.0.0.1:18069:8069 \
        -e HOST="$NET-db" -e USER=odoo -e PASSWORD=odoo -v "$PWD:/mnt/extra-addons:ro" \
        odoo:19 odoo -d sendsure -i account,sendsure_payables >/dev/null
    fi
    echo "Odoo will be on http://127.0.0.1:18069 in a few minutes (admin / admin)."
    ;;
  update)
    docker exec "$NET-odoo" odoo -d sendsure -u sendsure_payables --stop-after-init --db_host "$NET-db" -r odoo -w odoo --http-port 8070
    docker restart "$NET-odoo" >/dev/null
    ;;
  test)
    db
    docker exec "$NET-db" dropdb -U odoo --if-exists sendsure_test
    trap 'docker exec "$NET-db" dropdb -U odoo --if-exists sendsure_test' EXIT
    docker run --rm --network "$NET" -e HOST="$NET-db" -e USER=odoo -e PASSWORD=odoo -v "$PWD:/mnt/extra-addons:ro" \
      odoo:19 odoo -d sendsure_test -i account,sendsure_payables --test-enable --test-tags /sendsure_payables --stop-after-init
    ;;
  down)
    docker rm -f "$NET-odoo" "$NET-db" >/dev/null 2>&1 || true
    docker network rm "$NET" >/dev/null 2>&1 || true
    echo "Removed."
    ;;
  *) echo "usage: $0 up|update|test|down"; exit 1 ;;
esac
