#!/bin/bash
# Runs inside the frappe/erpnext container (see ../run.sh and ../docker-compose.yml).
#   boot.sh serve   create the demo site on first start, then run the web server, a worker and the scheduler
#   boot.sh test    create a throwaway site, run the app's tests inside ERPNext, drop the site
set -euo pipefail
cd /home/frappe/frappe-bench
DB_HOST="${DB_HOST:-sendsure-erpnext-db}"
REDIS_HOST="${REDIS_HOST:-sendsure-erpnext-redis}"
DB_ROOT_PASSWORD="${DB_ROOT_PASSWORD:-admin}"

# Make the mounted app importable (what `bench get-app` does with pip) and list it for bench.
echo /home/frappe/frappe-bench/apps/sendsure_erpnext > "$(env/bin/python -c 'import site; print(site.getsitepackages()[0])')/sendsure_erpnext.pth"
grep -qx sendsure_erpnext sites/apps.txt || printf '\nsendsure_erpnext\n' >> sites/apps.txt
sed -i '/^$/d' sites/apps.txt

bench set-config -g db_host "$DB_HOST" >/dev/null
bench set-config -g redis_cache "redis://$REDIS_HOST:6379/0" >/dev/null
bench set-config -g redis_queue "redis://$REDIS_HOST:6379/1" >/dev/null
bench set-config -g redis_socketio "redis://$REDIS_HOST:6379/2" >/dev/null

until env/bin/python - <<PY 2>/dev/null
import socket
socket.create_connection(("$DB_HOST", 3306), 2).close()
socket.create_connection(("$REDIS_HOST", 6379), 2).close()
PY
do echo "waiting for MariaDB and Redis..."; sleep 2; done

new_site() { # name, database
  bench new-site "$1" --db-name "$2" --db-root-password "$DB_ROOT_PASSWORD" --admin-password admin \
    --mariadb-user-host-login-scope='%' --install-app erpnext --install-app sendsure_erpnext
}

case "${1:-serve}" in
  serve)
    SITE=sendsure.localhost
    if [ ! -f "sites/$SITE/site_config.json" ]; then
      echo "First start: creating the ERPNext site (about a minute)..."
      new_site "$SITE" sendsure_erpnext
      # A company with the standard chart of accounts, in USD, so there is something to pay from.
      bench --site "$SITE" execute sendsure_erpnext.install.demo_company
      bench --site "$SITE" enable-scheduler
    else
      bench --site "$SITE" migrate
    fi
    bench --site "$SITE" set-config host_name "http://127.0.0.1:18080" >/dev/null
    bench worker --queue long,default,short &
    bench schedule &
    echo "ERPNext is on http://127.0.0.1:18080 (Administrator / admin)."
    exec bench --site "$SITE" serve --port 8000 --noreload
    ;;
  test)
    SITE=sendsure-test.localhost
    trap 'bench drop-site "$SITE" --db-root-password "$DB_ROOT_PASSWORD" --force --no-backup >/dev/null 2>&1 || true' EXIT
    new_site "$SITE" sendsure_erpnext_test
    bench --site "$SITE" set-config allow_tests true >/dev/null
    bench --site "$SITE" run-tests --app sendsure_erpnext
    ;;
  *) echo "usage: boot.sh serve|test"; exit 1 ;;
esac
