#!/bin/bash
# First boot of the SendSure mainnet test Odoo (Debian 12, Google Cloud). Odoo 19 + Postgres 16 + the
# sendsure_payables add-on from the public repo's mainnet branch, behind Caddy (HTTPS for <ip>.sslip.io).
# Passwords come from instance metadata (removed again after setup). Odoo is never reachable from outside
# before its default admin password is replaced: Caddy, the only public entry, starts last.
set -euo pipefail
exec >>/var/log/sendsure-setup.log 2>&1
[ -f /opt/sendsure-ready ] && exit 0   # later boots: the containers restart by themselves

md() { curl -sf -H "Metadata-Flavor: Google" "http://metadata.google.internal/computeMetadata/v1/instance/attributes/$1"; }
ADMIN_PASS=$(md odoo-admin-pass); MASTER_PASS=$(md odoo-master-pass); PG_PASS=$(md pg-pass); HOST=$(md site-host)

apt-get update -q && apt-get install -y -q docker.io git curl
systemctl enable --now docker
[ -d /opt/sendsure ] || git clone --depth 1 -b mainnet https://github.com/0x-pankaj/sendsure /opt/sendsure

docker network inspect odoo >/dev/null 2>&1 || docker network create odoo
docker container inspect db >/dev/null 2>&1 || docker run -d --name db --network odoo --restart unless-stopped \
  -e POSTGRES_USER=odoo -e POSTGRES_PASSWORD="$PG_PASS" -e POSTGRES_DB=postgres -v pgdata:/var/lib/postgresql/data postgres:16
mkdir -p /opt/odoo
cat >/opt/odoo/odoo.conf <<EOF
[options]
admin_passwd = $MASTER_PASS
db_host = db
db_user = odoo
db_password = $PG_PASS
dbfilter = ^sendsure\$
list_db = False
proxy_mode = True
without_demo = all
addons_path = /mnt/extra-addons
EOF
chown 100:101 /opt/odoo/odoo.conf && chmod 640 /opt/odoo/odoo.conf   # the odoo image runs as uid 100, gid 101
for _ in $(seq 1 30); do docker exec db pg_isready -U odoo >/dev/null 2>&1 && break; sleep 2; done

ODOO="-v /opt/odoo/odoo.conf:/etc/odoo/odoo.conf:ro -v /opt/sendsure/integrations/odoo:/mnt/extra-addons:ro -v odoodata:/var/lib/odoo"
docker exec db psql -U odoo -lqt | cut -d"|" -f1 | grep -qw sendsure ||
  docker run --rm --network odoo $ODOO odoo:19 odoo -c /etc/odoo/odoo.conf -d sendsure -i account,sendsure_payables --stop-after-init
docker container inspect odoo >/dev/null 2>&1 || docker run -d --name odoo --network odoo --restart unless-stopped $ODOO odoo:19 odoo -c /etc/odoo/odoo.conf -d sendsure
for _ in $(seq 1 60); do
  docker exec odoo python3 -c "import urllib.request; urllib.request.urlopen('http://localhost:8069/web/login', timeout=5)" 2>/dev/null && break
  sleep 5
done

# Replace Odoo's default admin/admin while nothing outside can reach it.
docker exec -i -e NEWPASS="$ADMIN_PASS" odoo python3 - <<'PY'
import json, os, urllib.request
def call(service, method, *args):
    body = json.dumps({"jsonrpc": "2.0", "method": "call", "params": {"service": service, "method": method, "args": list(args)}, "id": 1}).encode()
    out = json.load(urllib.request.urlopen(urllib.request.Request("http://localhost:8069/jsonrpc", body, {"content-type": "application/json"})))
    if "error" in out:
        raise SystemExit(str(out["error"])[:300])
    return out["result"]
uid = call("common", "login", "sendsure", "admin", "admin")
if not uid:
    raise SystemExit(print("admin password was replaced before") or 0)
call("object", "execute_kw", "sendsure", uid, "admin", "res.users", "write", [[uid], {"password": os.environ["NEWPASS"]}])
print("admin password replaced")
PY

docker container inspect caddy >/dev/null 2>&1 || docker run -d --name caddy --network odoo --restart unless-stopped -p 80:80 -p 443:443 -v caddydata:/data -v caddyconfig:/config \
  caddy:2 caddy reverse-proxy --from "$HOST" --to odoo:8069
touch /opt/sendsure-ready
echo "ready: https://$HOST"
