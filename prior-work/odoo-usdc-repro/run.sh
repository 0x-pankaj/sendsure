#!/usr/bin/env bash
# Same as docker-compose.yml, with plain docker commands (for machines without Compose).
#   ./run.sh up     start Postgres + Odoo 19 Community on http://127.0.0.1:18069
#   ./run.sh down   remove both containers and the network (nothing is kept)
set -euo pipefail
cd "$(dirname "$0")"
NET=odoo-usdc-repro
case "${1:-up}" in
  up)
    if docker container inspect "$NET-odoo" >/dev/null 2>&1; then
      docker start "$NET-db" "$NET-odoo" >/dev/null
      echo "Already set up and running: http://127.0.0.1:18069 (login admin / admin)."
      echo "To start from a fresh database: ./run.sh down && ./run.sh up"
      exit 0
    fi
    docker rm -f "$NET-db" >/dev/null 2>&1 || true
    docker network inspect "$NET" >/dev/null 2>&1 || docker network create "$NET" >/dev/null
    docker run -d --name "$NET-db" --network "$NET" \
      -e POSTGRES_USER=odoo -e POSTGRES_PASSWORD=odoo -e POSTGRES_DB=postgres postgres:16 >/dev/null
    docker run -d --name "$NET-odoo" --network "$NET" -p 127.0.0.1:18069:8069 \
      -e HOST="$NET-db" -e USER=odoo -e PASSWORD=odoo \
      -v "$PWD/addons:/mnt/extra-addons:ro" \
      odoo:19 odoo -d usdc_repro -i account,usdc_arc_gate >/dev/null
    echo "Started. Odoo will be on http://127.0.0.1:18069 in a few minutes. Then run: python3 repro.py"
    ;;
  down)
    docker rm -f "$NET-odoo" "$NET-db" >/dev/null 2>&1 || true
    docker network rm "$NET" >/dev/null 2>&1 || true
    echo "Removed."
    ;;
  *) echo "usage: $0 up|down"; exit 1 ;;
esac
