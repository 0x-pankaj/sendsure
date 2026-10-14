#!/usr/bin/env bash
# The same as docker-compose.yml, with plain docker commands (for machines without Compose).
#   ./run.sh up      Odoo 19 Community + Postgres with the add-on, on http://127.0.0.1:18069 (admin / admin)
#   ./run.sh test    run the add-on's Odoo tests in a throwaway database, then drop it
#   ./run.sh down    remove the containers, network and data
# Another Odoo version (16, 17 or 18): ODOO_VERSION=17 ./run.sh up  ->  http://127.0.0.1:18017, database sendsure17
set -euo pipefail
cd "$(dirname "$0")"
NET=sendsure-odoo
V="${ODOO_VERSION:-19}"
case "$V" in 16|17|18|19) ;; *) echo "ODOO_VERSION must be 16, 17, 18 or 19"; exit 1 ;; esac
if [ "$V" = 19 ]; then APP="$NET-odoo"; PORT=18069; DB=sendsure; else APP="$NET-odoo$V"; PORT="180$V"; DB="sendsure$V"; fi
ADDONS="$PWD"
if [ "$V" = 16 ]; then ./build16.py >/dev/null; ADDONS="$PWD/16.0"; fi
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
    if docker container inspect "$APP" >/dev/null 2>&1; then
      docker start "$APP" >/dev/null
    else
      docker run -d --name "$APP" --network "$NET" -p "127.0.0.1:$PORT:8069" \
        -e HOST="$NET-db" -e USER=odoo -e PASSWORD=odoo -v "$ADDONS:/mnt/extra-addons:ro" \
        "odoo:$V" odoo -d "$DB" -i account,sendsure_payables >/dev/null
    fi
    echo "Odoo $V will be on http://127.0.0.1:$PORT in a few minutes (admin / admin)."
    ;;
  update)
    docker exec "$APP" odoo -d "$DB" -u sendsure_payables --stop-after-init --db_host "$NET-db" -r odoo -w odoo --http-port 8070
    docker restart "$APP" >/dev/null
    ;;
  test)
    db
    docker exec "$NET-db" dropdb -U odoo --if-exists "${DB}_test"
    trap 'docker exec "$NET-db" dropdb -U odoo --if-exists "${DB}_test"' EXIT
    docker run --rm --network "$NET" -e HOST="$NET-db" -e USER=odoo -e PASSWORD=odoo -v "$ADDONS:/mnt/extra-addons:ro" \
      "odoo:$V" odoo -d "${DB}_test" -i account,sendsure_payables --test-enable --test-tags /sendsure_payables --stop-after-init
    ;;
  down)
    docker rm -f "$NET-odoo" "$NET-odoo16" "$NET-odoo17" "$NET-odoo18" "$NET-db" >/dev/null 2>&1 || true
    docker network rm "$NET" >/dev/null 2>&1 || true
    echo "Removed."
    ;;
  *) echo "usage: $0 up|update|test|down"; exit 1 ;;
esac
