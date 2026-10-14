#!/usr/bin/env bash
# The same as docker-compose.yml, with plain docker commands (for machines without Compose).
#   ./run.sh up      ERPNext 15 + MariaDB + Redis with the app, on http://127.0.0.1:18080 (Administrator / admin)
#   ./run.sh test    run the app's tests inside ERPNext on a throwaway site, then drop it
#   ./run.sh down    remove the containers, network and data
# ERPNext 16: ERPNEXT_VERSION=16 ./run.sh up  ->  http://127.0.0.1:18086 (its own container and site volume)
set -euo pipefail
cd "$(dirname "$0")"
NET=sendsure-erpnext
case "${ERPNEXT_VERSION:-15}" in
  15) IMAGE=frappe/erpnext:v15.121.6; APPC="$NET-app"; PORT=18080; SITES="$NET-sites"; REDIS_DB=0 ;;
  16) IMAGE=frappe/erpnext:v16.50.0; APPC="$NET-app16"; PORT=18086; SITES="$NET-sites16"; REDIS_DB=3 ;;
  *) echo "ERPNEXT_VERSION must be 15 or 16"; exit 1 ;;
esac
APP="$PWD/sendsure_erpnext:/home/frappe/frappe-bench/apps/sendsure_erpnext:ro"
BOOT="$PWD/docker:/opt/sendsure:ro"
deps() {
  docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET" >/dev/null
  if ! docker container inspect "$NET-db" >/dev/null 2>&1; then
    docker run -d --name "$NET-db" --network "$NET" -e MARIADB_ROOT_PASSWORD=admin mariadb:10.6 \
      --character-set-server=utf8mb4 --collation-server=utf8mb4_unicode_ci \
      --skip-character-set-client-handshake --skip-innodb-read-only-compressed >/dev/null
  fi
  if ! docker container inspect "$NET-redis" >/dev/null 2>&1; then
    docker run -d --name "$NET-redis" --network "$NET" redis:7-alpine >/dev/null
  fi
  docker start "$NET-db" "$NET-redis" >/dev/null
}
case "${1:-up}" in
  up)
    deps
    if docker container inspect "$APPC" >/dev/null 2>&1; then
      docker start "$APPC" >/dev/null
    else
      docker run -d --name "$APPC" --network "$NET" -p "127.0.0.1:$PORT:8000" -e SITE_URL="http://127.0.0.1:$PORT" -e REDIS_DB="$REDIS_DB" \
        -e SITE_DB="sendsure_erpnext${ERPNEXT_VERSION:-15}" \
        -v "$SITES:/home/frappe/frappe-bench/sites" -v "$APP" -v "$BOOT" \
        "$IMAGE" bash /opt/sendsure/boot.sh serve >/dev/null
    fi
    echo "ERPNext ${ERPNEXT_VERSION:-15} will be on http://127.0.0.1:$PORT in a minute or two (Administrator / admin)."
    echo "Follow the first start with: docker logs -f $APPC"
    ;;
  update)
    docker restart "$APPC" >/dev/null
    ;;
  test)
    deps
    docker exec "$NET-db" mariadb -uroot -padmin -e 'DROP DATABASE IF EXISTS sendsure_erpnext_test'
    docker run --rm --name "$NET-test" --network "$NET" -e REDIS_DB="$REDIS_DB" -v "$APP" -v "$BOOT" "$IMAGE" bash /opt/sendsure/boot.sh test
    ;;
  down)
    docker rm -f -v "$NET-app" "$NET-app16" "$NET-test" "$NET-redis" "$NET-db" >/dev/null 2>&1 || true
    docker volume rm "$NET-sites" "$NET-sites16" >/dev/null 2>&1 || true
    docker network rm "$NET" >/dev/null 2>&1 || true
    echo "Removed."
    ;;
  *) echo "usage: $0 up|update|test|down"; exit 1 ;;
esac
