#!/usr/bin/env bash
# Rehearses the mainnet beta on a local fork of Arc mainnet, before any real USDC is spent.
#   1. anvil forks Arc mainnet (chain 5042). Arc's USDC moves money through an Arc-only precompile anvil
#      cannot run, so a stand-in with the same EIP-712 domain (contracts/test/mocks/RehearsalUSDC.sol) goes at
#      0x3600…. The real USDC's proxy and implementation code are identical on testnet, where SendSure pays for real.
#   2. The contracts are deployed with the real mainnet deployer key: the same addresses the real deploy gets.
#   3. The web app runs in mainnet mode against the fork; scripts/rehearse-mainnet.ts walks every flow.
# Leaves nothing behind. Refuses to run once deployments/arc-mainnet.json exists (the real deployment record).
# Usage: scripts/rehearse-mainnet.sh   (ANTHROPIC_API_KEY in the environment adds the model's review)
set -euo pipefail
cd "$(dirname "$0")/.."
PORT_FORK=${PORT_FORK:-8547}
PORT_WEB=${PORT_WEB:-3100}
FORK=http://127.0.0.1:$PORT_FORK
BASE=http://127.0.0.1:$PORT_WEB
WORK=$(mktemp -d)

[ ! -e deployments/arc-mainnet.json ] || { echo "deployments/arc-mainnet.json exists: mainnet is deployed, nothing to rehearse."; exit 1; }
[ -e contracts/.env.mainnet ] && [ -e apps/web/.env.mainnet.local ] || { echo "Needs contracts/.env.mainnet and apps/web/.env.mainnet.local."; exit 1; }
[ ! -e apps/web/.env.local ] || { echo "apps/web/.env.local exists here: its testnet values would leak into the rehearsal."; exit 1; }
git diff --quiet -- packages/chain/src/generated.ts || { echo "packages/chain/src/generated.ts has local changes."; exit 1; }

# Each background job runs as the leader of its own session (setsid) and writes its process-group id to
# $WORK/*.pgid; cleanup stops exactly those groups, by id (never by name pattern).
cleanup() {
  for f in "$WORK"/*.pgid; do [ -e "$f" ] && kill -- "-$(cat "$f")" 2>/dev/null || true; done
  rm -rf contracts/broadcast/Deploy.s.sol/5042 contracts/broadcast/RehearsalUSDC.sol deployments/arc-mainnet.json apps/web/.wrangler/state
  git checkout -- packages/chain/src/generated.ts
  echo "web log: $WORK/web.log"
}
trap cleanup EXIT

setsid bash -c 'echo $$ >"$0/anvil.pgid"; exec anvil --fork-url https://rpc.mainnet.arc.io --port "$1" --silent' "$WORK" "$PORT_FORK" >"$WORK/anvil.log" 2>&1 &
for _ in $(seq 1 60); do cast chain-id --rpc-url "$FORK" >/dev/null 2>&1 && break; sleep 1; done
[ "$(cast chain-id --rpc-url "$FORK")" = 5042 ] || { echo "The fork is not Arc mainnet."; exit 1; }

# 1. Stand-in USDC at 0x3600… (deployed once for its runtime code, then copied there).
ANVIL0=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 # anvil's public test key
(cd contracts && forge build >/dev/null)
MOCK=$(cd contracts && forge create test/mocks/RehearsalUSDC.sol:RehearsalUSDC --rpc-url "$FORK" --private-key "$ANVIL0" --broadcast | awk '/Deployed to:/ {print $3}')
cast rpc anvil_setCode 0x3600000000000000000000000000000000000000 "$(cast code "$MOCK" --rpc-url "$FORK")" --rpc-url "$FORK" >/dev/null
echo "stand-in USDC at 0x3600…: $(cast call 0x3600000000000000000000000000000000000000 'name()(string)' --rpc-url "$FORK") v$(cast call 0x3600000000000000000000000000000000000000 'version()(string)' --rpc-url "$FORK")"

# 2. Gas for the mainnet keys on the fork, then the real deploy script with the real deployer key.
set -a
. contracts/.env.mainnet
. apps/web/.env.mainnet.local
set +a
for a in "$DEPLOYER_ADDRESS" "$RELAYER_ADDRESS" "$(cast wallet address --private-key "$AGENT_PRIVATE_KEY")"; do
  cast rpc anvil_setBalance "$a" 0x56BC75E2D63100000 --rpc-url "$FORK" >/dev/null
done
(cd contracts && forge script script/Deploy.s.sol --rpc-url "$FORK" --broadcast | grep -E "PayeeRegistry:|MandateFactory:|implementation:")
RECORD_RPC_URL=$FORK node scripts/record-deployment.mjs mainnet
pnpm -s gen

# 3. The web app in mainnet mode against the fork. `next dev` uses wrangler's local D1 (like production D1):
#    a fresh one, with every migration applied (for both bindings in wrangler.jsonc).
rm -rf apps/web/.wrangler/state
(cd apps/web && npx wrangler d1 migrations apply sendsure --local >/dev/null && npx wrangler d1 migrations apply sendsure-mainnet --local --env mainnet >/dev/null)
export NEXT_PUBLIC_ARC_NETWORK=mainnet ARC_RPC_URL=$FORK
setsid bash -c 'echo $$ >"$0/web.pgid"; cd apps/web && exec npx next dev -p "$1"' "$WORK" "$PORT_WEB" >"$WORK/web.log" 2>&1 &
for _ in $(seq 1 120); do [ "$(curl -s -o /dev/null -w '%{http_code}' "$BASE/api/status")" = 200 ] && break; sleep 2; done
npx tsx scripts/rehearse-mainnet.ts --base "$BASE"
