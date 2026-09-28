#!/usr/bin/env python3
"""Live smoke test of SendSure on Arc testnet. First-party, SANDBOX tier, not traction.

Flow:
  create an org (SANDBOX) -> treasury approves a capped allowance -> open a slot
  -> the payee binds its own address (EIP-712, relayed) -> the payee signs a claim
  -> the Circle agent wallet calls settle(): Escalated (first payment needs a co-sign)
  -> the approver co-signs on-chain -> the agent wallet calls settle() again: Settled, USDC moves
  -> a retry of the same claim: AlreadySettled -> a claim signed by the wrong key: Refused.

Needs: cast (Foundry), the circle CLI logged in to testnet, and contracts/.env with the test keys.
Writes deployments/smoke-test.json and deployments/smoke-test.md.
"""
import json
import os
import subprocess
import sys
import time
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RPC = "https://rpc.testnet.arc.network"
EXPLORER = "https://explorer.testnet.arc.io"
USDC = "0x3600000000000000000000000000000000000000"
AGENT_WALLET = "0x9f977c4efff254a9284e69a0ae2b03e4ab851c07"
DEPLOY = json.load(open(os.path.join(ROOT, "deployments", "arc-testnet.json")))
REGISTRY = DEPLOY["contracts"]["PayeeRegistry"]["address"]
FACTORY = DEPLOY["contracts"]["MandateFactory"]["address"]
CLAIM_T = "(bytes32,address,uint256,bytes32,uint64,uint64,uint256,uint64)"
OUTCOME = ["PAYABLE", "ALREADY_SETTLED", "ESCALATED", "REFUSED"]
REASON = [
    "NONE", "PAUSED", "TOKEN_NOT_ALLOWED", "ZERO_AMOUNT", "EXPIRED", "BAD_PERIOD", "NONCE_USED",
    "PAYEE_NOT_BOUND", "PAYEE_FROZEN", "PAYEE_CHANGE_PENDING", "PAYEE_COOLDOWN", "PAYEE_IS_CONTROLLER",
    "PAYEE_BLOCKLISTED", "TREASURY_BLOCKLISTED", "BAD_SIGNATURE", "DUPLICATE_REF", "OVER_CLAIM_MAX",
    "OVER_PAYEE_CAP", "OVER_ORG_CAP", "INSUFFICIENT_ALLOWANCE", "INSUFFICIENT_BALANCE",
    "NEEDS_COSIGN_ATTESTED_PAYEE", "NEEDS_COSIGN_NEW_PAYOUT", "NEEDS_COSIGN_ABOVE_THRESHOLD",
]


def env():
    out = {}
    for line in open(os.path.join(ROOT, "contracts", ".env")):
        if "=" in line:
            k, v = line.strip().split("=", 1)
            out[k] = v
    return out


E = env()
steps = []


def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        sys.exit(f"FAILED: {' '.join(cmd[:3])}...\n{r.stdout}\n{r.stderr}")
    return r.stdout.strip()


def call(to, sig, *args):
    return run(["cast", "call", "--rpc-url", RPC, to, sig, *args])


def send(pk_name, to, sig, *args):
    out = json.loads(run(["cast", "send", "--rpc-url", RPC, "--private-key", E[pk_name], "--json", to, sig, *args]))
    if out.get("status") not in ("0x1", 1, "1"):
        sys.exit(f"tx failed: {out.get('transactionHash')}")
    return out


def topic(sig):
    return run(["cast", "keccak", sig])


def agent_execute(mandate, claim_hex, payee_sig, decision):
    """The Circle agent wallet calls settle() itself (Circle Agent Stack)."""
    out = run([
        "circle", "wallet", "execute", "settle(bytes,bytes,bytes32)", claim_hex, payee_sig, decision,
        "--contract", mandate, "--address", AGENT_WALLET, "--chain", "ARC-TESTNET",
        "--idempotency-key", str(uuid.uuid4()), "--output", "json",
    ])
    data = json.loads(out)["data"]
    if data.get("state") != "COMPLETE":
        sys.exit(f"agent wallet execute not complete: {data}")
    return data["txHash"]


def events(tx_hash, mandate):
    rc = json.loads(run(["cast", "receipt", "--rpc-url", RPC, "--json", tx_hash]))
    names = {
        topic("Escalated(bytes32,bytes32,uint8,bytes32)"): "Escalated",
        topic("Refused(bytes32,bytes32,uint8,bytes32)"): "Refused",
        topic("Settled(bytes32,bytes32,bytes32,address,uint256,address,bytes32)"): "Settled",
        topic("AlreadySettled(bytes32,bytes32,bytes32)"): "AlreadySettled",
    }
    found = []
    for log in rc["logs"]:
        if log["address"].lower() != mandate.lower():
            continue
        name = names.get(log["topics"][0])
        if not name:
            continue
        detail = ""
        if name in ("Escalated", "Refused"):
            reason = int(log["data"][2:66], 16)
            detail = REASON[reason]
        found.append(f"{name}{(' ' + detail) if detail else ''}")
    return found


def record(label, tx, note=""):
    steps.append({"step": label, "tx": tx, "url": f"{EXPLORER}/tx/{tx}", "note": note})
    print(f"  {label}: {tx} {note}")


def usdc_balance(addr):
    return int(call(USDC, "balanceOf(address)(uint256)", addr).split()[0])


def main():
    owner = E["DEPLOYER_ADDRESS"]
    approver = E["APPROVER_ADDRESS"]
    payee = E["SMOKE_PAYEE_ADDRESS"]
    fallback = E["FALLBACK_AGENT_ADDRESS"]
    now = int(time.time())
    vu = now + 7 * 24 * 3600

    print("1. Create a SANDBOX org (owner and treasury = test payer key)")
    caps = "[(5000000,3000000,2000000,1000000)]"  # org 5, payee 3, per-claim 2, co-sign above 1 USDC
    params = f"({owner},{owner},[{AGENT_WALLET},{fallback}],[{approver}],[{USDC}],{caps},2592000,0,86400,2)"
    rc = send("DEPLOYER_PRIVATE_KEY", FACTORY,
              "createMandate((address,address,address[],address[],address[],(uint128,uint128,uint128,uint128)[],uint64,uint64,uint64,uint8))",
              params)
    created = topic("MandateCreated(address,address,address,uint8)")
    mandate = next("0x" + l["topics"][1][-40:] for l in rc["logs"] if l["topics"][0] == created)
    mandate = run(["cast", "to-check-sum-address", mandate])
    record("createMandate (SANDBOX tier)", rc["transactionHash"], f"org {mandate}")

    print("2. Treasury approves a capped allowance (5 USDC)")
    rc = send("DEPLOYER_PRIVATE_KEY", USDC, "approve(address,uint256)", mandate, "5000000")
    record("approve 5 USDC", rc["transactionHash"])

    print("3. Open a slot for the payee")
    salt = run(["cast", "keccak", "sendsure-smoke-salt"])
    ref = run(["cast", "keccak", run(["cast", "abi-encode", "f(bytes32,string)", salt, "smoke-payee"])])
    rc = send("DEPLOYER_PRIVATE_KEY", mandate, "openSlots(bytes32[])", f"[{ref}]")
    record("openSlots", rc["transactionHash"])

    print("4. The payee binds its own address (signs Bind; a relayer submits it)")
    zero32 = "0x" + "00" * 32
    digest = call(REGISTRY, "bindDigest(address,bytes32,address,bytes32,uint8,uint256,uint64)(bytes32)",
                  mandate, ref, payee, zero32, "0", "1", str(vu))
    bind_sig = run(["cast", "wallet", "sign", "--no-hash", "--private-key", E["SMOKE_PAYEE_PRIVATE_KEY"], digest])
    rc = send("DEPLOYER_PRIVATE_KEY", REGISTRY, "bindWithSig(address,bytes32,address,bytes32,uint8,uint256,uint64,bytes)",
              mandate, ref, payee, zero32, "0", "1", str(vu), bind_sig)
    record("bindWithSig (payee-signed, relayed)", rc["transactionHash"])

    print("5. The payee signs a claim for 1 USDC")
    ref_hash = run(["cast", "keccak", run(["cast", "abi-encode", "f(bytes32,string)", salt, "INV-SMOKE-1"])])
    claim = f"({ref},{USDC},1000000,{ref_hash},{now - 86400},{now},1,{vu})"
    claim_id = call(mandate, f"claimIdOf({CLAIM_T})(bytes32)", claim)
    payee_sig = run(["cast", "wallet", "sign", "--no-hash", "--private-key", E["SMOKE_PAYEE_PRIVATE_KEY"], claim_id])
    claim_hex = run(["cast", "abi-encode", f"f({CLAIM_T})", claim])
    dry = call(mandate, "check(bytes,bytes)(uint8,uint8,bytes32,bytes32,address)", claim_hex, payee_sig).split("\n")
    print(f"   dry run: {OUTCOME[int(dry[0])]} {REASON[int(dry[1])]}")

    print("6. The Circle agent wallet asks to pay: escalated (first payment to a new payee)")
    before = usdc_balance(payee)
    tx = agent_execute(mandate, claim_hex, payee_sig, run(["cast", "keccak", "smoke decision 1: propose INV-SMOKE-1"]))
    record("agent wallet settle #1", tx, str(events(tx, mandate)))

    print("7. The approver co-signs this exact claim on-chain")
    rc = send("APPROVER_PRIVATE_KEY", mandate, "cosign(bytes)", claim_hex)
    record("approver cosign", rc["transactionHash"])

    print("8. The Circle agent wallet pays: settled, USDC moves to the payee's own address")
    tx = agent_execute(mandate, claim_hex, payee_sig, run(["cast", "keccak", "smoke decision 2: pay INV-SMOKE-1"]))
    record("agent wallet settle #2", tx, str(events(tx, mandate)))
    after = usdc_balance(payee)
    print(f"   payee USDC: {before / 1e6} -> {after / 1e6}")

    print("9. Retry of the same claim (fallback agent key): already settled, nothing moves")
    rc = send("FALLBACK_AGENT_PRIVATE_KEY", mandate, "settle(bytes,bytes,bytes32)", claim_hex, payee_sig,
              run(["cast", "keccak", "smoke decision 3: retry"]))
    record("retry settle", rc["transactionHash"], str(events(rc["transactionHash"], mandate)))

    print("10. A claim signed by the wrong key: refused on-chain")
    new_key = json.loads(run(["cast", "wallet", "new", "--json"]))
    attacker_pk = (new_key[0] if isinstance(new_key, list) else new_key)["private_key"]
    ref_hash2 = run(["cast", "keccak", run(["cast", "abi-encode", "f(bytes32,string)", salt, "INV-SMOKE-2"])])
    claim2 = f"({ref},{USDC},500000,{ref_hash2},{now - 86400},{now},2,{vu})"
    claim2_id = call(mandate, f"claimIdOf({CLAIM_T})(bytes32)", claim2)
    forged = run(["cast", "wallet", "sign", "--no-hash", "--private-key", attacker_pk, claim2_id])
    claim2_hex = run(["cast", "abi-encode", f"f({CLAIM_T})", claim2])
    rc = send("FALLBACK_AGENT_PRIVATE_KEY", mandate, "settle(bytes,bytes,bytes32)", claim2_hex, forged,
              run(["cast", "keccak", "smoke decision 4: forged claim"]))
    record("forged claim settle", rc["transactionHash"], str(events(rc["transactionHash"], mandate)))
    final = usdc_balance(payee)

    result = {
        "label": "First-party smoke test on Arc testnet, SANDBOX tier. Synthetic payee. Not traction.",
        "ranAtUnix": now, "org": mandate, "payee": payee, "agentWallet": AGENT_WALLET,
        "payeeUsdcBefore": before, "payeeUsdcAfter": final, "steps": steps,
    }
    json.dump(result, open(os.path.join(ROOT, "deployments", "smoke-test.json"), "w"), indent=2)
    lines = [
        "# Live smoke test on Arc testnet",
        "",
        "**First-party test, SANDBOX tier.** The payee is a synthetic test key. This is not traction.",
        "",
        f"- Org (Mandate clone): [`{mandate}`]({EXPLORER}/address/{mandate})",
        f"- Circle agent wallet that called `settle()`: [`{AGENT_WALLET}`]({EXPLORER}/address/{AGENT_WALLET})",
        f"- Payee: [`{payee}`]({EXPLORER}/address/{payee}); USDC {before / 1e6} → {final / 1e6}",
        "",
        "| # | Step | Result | Tx |",
        "|---|---|---|---|",
    ]
    for i, s in enumerate(steps, 1):
        lines.append(f"| {i} | {s['step']} | {s['note']} | [{s['tx'][:10]}…]({s['url']}) |")
    lines += ["", "Reproduce: `python3 contracts/script/smoke_test.py` (needs the test keys in `contracts/.env`)."]
    open(os.path.join(ROOT, "deployments", "smoke-test.md"), "w").write("\n".join(lines) + "\n")
    print("done")


if __name__ == "__main__":
    main()
