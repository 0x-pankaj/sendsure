#!/usr/bin/env bash
# The same as docker-compose.yml, with plain docker commands (for machines without Compose).
#   ./run.sh up      ERPNext 15 + MariaDB + Redis with the app, on http://127.0.0.1:18080 (Administrator / admin)
#   ./run.sh test    run the app's tests inside ERPNext on a throwaway site, then drop it
#   ./run.sh down    remove the containers, network and data
set -euo pipefail
cd "$(dirname "$0")"
NET=sendsure-erpnext
IMAGE=frappe/erpnext:v15.121.6
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
    if docker container inspect "$NET-app" >/dev/null 2>&1; then
      docker start "$NET-app" >/dev/null
    else
      docker run -d --name "$NET-app" --network "$NET" -p 127.0.0.1:18080:8000 \
        -v "$NET-sites:/home/frappe/frappe-bench/sites" -v "$APP" -v "$BOOT" \
        "$IMAGE" bash /opt/sendsure/boot.sh serve >/dev/null
    fi
    echo "ERPNext will be on http://127.0.0.1:18080 in a minute or two (Administrator / admin)."
    echo "Follow the first start with: docker logs -f $NET-app"
    ;;
  update)
    docker restart "$NET-app" >/dev/null
    ;;
  test)
    deps
    docker exec "$NET-db" mariadb -uroot -padmin -e 'DROP DATABASE IF EXISTS sendsure_erpnext_test'
    docker run --rm --name "$NET-test" --network "$NET" -v "$APP" -v "$BOOT" "$IMAGE" bash /opt/sendsure/boot.sh test
    ;;
  down)
    docker rm -f -v "$NET-app" "$NET-test" "$NET-redis" "$NET-db" >/dev/null 2>&1 || true
    docker volume rm "$NET-sites" >/dev/null 2>&1 || true
    docker network rm "$NET" >/dev/null 2>&1 || true
    echo "Removed."
    ;;
  *) echo "usage: $0 up|update|test|down"; exit 1 ;;
esac
