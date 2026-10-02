import { getAddress, isAddress } from "viem";
import type { PayoutRow } from "./csv";

export type RowStatus = "SAME_AS_LAST_PAID" | "CHANGED" | "NEW" | "LOOKALIKE" | "INVALID_ADDRESS";
export type Flag =
  | "DUPLICATE_ROW"
  | "ADDRESS_SHARED_WITH_OTHER_PAYEE"
  | "AMOUNT_JUMP"
  | "NON_EVM_ADDRESS"
  | "MISSING_AMOUNT";
export type Action = "PAY" | "REVIEW" | "STOP";

export interface CheckedRow extends PayoutRow {
  status: RowStatus;
  flags: Flag[];
  action: Action;
  lastPaidAddress?: string;
  lookalikeOf?: string;
  explanation: string;
}

export interface CheckSummary {
  rows: number;
  byAction: Record<Action, number>;
  byStatus: Record<RowStatus, number>;
  amountByAction: Record<Action, number>;
}

const RANK: Record<Action, number> = { PAY: 0, REVIEW: 1, STOP: 2 };
const worst = (a: Action, b: Action): Action => (RANK[a] >= RANK[b] ? a : b);

/** Company-suffix-insensitive name key, so "ACME Design Ltd." and "Acme Design Limited" match. */
export function normalizeName(name: string): string {
  return name
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[.,'"()&]/g, " ")
    .replace(/\b(ltd|limited|llc|inc|incorporated|gmbh|pvt|private|co|company|corp|corporation|sa|bv|plc)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type AddressKind = "evm" | "other" | "invalid";

/** Stellar account (G…, 56 chars, base32): version byte and CRC16-XModem checksum must match. */
export function isStellarAccount(a: string): boolean {
  if (!/^G[A-Z2-7]{55}$/.test(a)) return false;
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bytes: number[] = [];
  let bits = 0;
  let value = 0;
  for (const ch of a) {
    value = (value << 5) | alphabet.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  if (bytes.length !== 35 || bytes[0] !== 6 << 3) return false;
  let crc = 0;
  for (const b of bytes.slice(0, 33)) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return bytes[33] === (crc & 0xff) && bytes[34] === crc >> 8;
}

/** bech32 / bech32m address (cosmos1…, dydx1…, osmo1…, bc1…): the checksum must verify. */
export function isBech32Address(raw: string): boolean {
  const a = raw.toLowerCase();
  if (raw !== a && raw !== raw.toUpperCase()) return false;
  const pos = a.lastIndexOf("1");
  if (pos < 1 || pos + 7 > a.length || a.length > 90) return false;
  const charset = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  const hrp = a.slice(0, pos);
  const data = [...a.slice(pos + 1)].map((c) => charset.indexOf(c));
  if (data.some((d) => d < 0) || !/^[\x21-\x7e]+$/.test(hrp)) return false;
  const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of [...[...hrp].map((c) => c.charCodeAt(0) >> 5), 0, ...[...hrp].map((c) => c.charCodeAt(0) & 31), ...data]) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= G[i]!;
  }
  return chk === 1 || chk === 0x2bc830a3; // bech32 or bech32m
}

export function addressKind(address: string): AddressKind {
  const a = address.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(a)) return isAddress(a, { strict: true }) ? "evm" : "invalid";
  if (a.startsWith("0x")) return "invalid";
  // Other chains are compared exactly (no checksum case to normalise):
  if (isStellarAccount(a)) return "other"; // Stellar
  if (isBech32Address(a)) return "other"; // Cosmos chains (cosmos1, dydx1, osmo1…), Bitcoin bc1
  // Solana (32-44), Tron (T + 33) and Polkadot/Substrate SS58 (47-48), all base58.
  if (/^[1-9A-HJ-NP-Za-km-z]{32,48}$/.test(a)) return "other";
  return "invalid";
}

/** Canonical form for comparing: checksummed EVM, exact string otherwise. */
export function canonicalAddress(address: string): string {
  const a = address.trim();
  return addressKind(a) === "evm" ? getAddress(a) : a;
}

/** Address poisoning: same first 4 and last 4 characters, different in between. */
export function looksAlike(a: string, b: string): boolean {
  const x = a.trim().replace(/^0x/i, "").toLowerCase();
  const y = b.trim().replace(/^0x/i, "").toLowerCase();
  if (x === y || x.length < 12 || y.length < 12) return false;
  return x.slice(0, 4) === y.slice(0, 4) && x.slice(-4) === y.slice(-4);
}

/**
 * Check a payout list against the last payout (the essay's "the account you paid last time" control)
 * and against itself. Needs no action from any payee.
 */
export function checkPayout(rows: PayoutRow[], lastPaid: PayoutRow[] = []): { rows: CheckedRow[]; summary: CheckSummary } {
  const lastByPayee = new Map<string, PayoutRow>();
  for (const r of lastPaid) lastByPayee.set(normalizeName(r.payee), r);
  const lastPayeeByAddress = new Map<string, string>();
  for (const r of lastPaid) {
    if (addressKind(r.address) !== "invalid") lastPayeeByAddress.set(canonicalAddress(r.address), normalizeName(r.payee));
  }
  const known = [...new Set([...lastPaid, ...rows].filter((r) => addressKind(r.address) !== "invalid").map((r) => canonicalAddress(r.address)))];

  const seenRows = new Map<string, number>();
  const payeeByAddressThisFile = new Map<string, Set<string>>();
  for (const r of rows) {
    if (addressKind(r.address) === "invalid") continue;
    const a = canonicalAddress(r.address);
    const set = payeeByAddressThisFile.get(a) ?? new Set<string>();
    set.add(normalizeName(r.payee));
    payeeByAddressThisFile.set(a, set);
  }

  const checked = rows.map<CheckedRow>((r) => {
    const flags: Flag[] = [];
    const kind = addressKind(r.address);
    const key = normalizeName(r.payee);
    const last = lastByPayee.get(key);

    if (kind === "invalid") {
      return { ...r, status: "INVALID_ADDRESS", flags, action: "STOP", lastPaidAddress: last?.address, explanation: "This is not a valid address (or its checksum is wrong). Do not pay it." };
    }
    const addr = canonicalAddress(r.address);
    if (kind === "other") flags.push("NON_EVM_ADDRESS");
    if (r.amount === null) flags.push("MISSING_AMOUNT");

    const dupKey = `${key}|${addr}|${r.amount}|${r.reference ?? ""}`;
    seenRows.set(dupKey, (seenRows.get(dupKey) ?? 0) + 1);
    if (seenRows.get(dupKey)! > 1) flags.push("DUPLICATE_ROW");

    const sharedThisFile = (payeeByAddressThisFile.get(addr)?.size ?? 0) > 1;
    const lastOwner = lastPayeeByAddress.get(addr);
    if (sharedThisFile || (lastOwner !== undefined && lastOwner !== key)) flags.push("ADDRESS_SHARED_WITH_OTHER_PAYEE");

    if (last?.amount && r.amount && r.amount > 2 * last.amount) flags.push("AMOUNT_JUMP");

    // An address this payee was paid at last time is trusted; only unfamiliar addresses can be look-alikes.
    const paidLastTime = last !== undefined && canonicalAddress(last.address) === addr;
    const lookalikeOf = paidLastTime ? undefined : known.find((k) => looksAlike(addr, k));
    let status: RowStatus;
    let action: Action;
    let explanation: string;
    if (lookalikeOf) {
      status = "LOOKALIKE";
      action = "STOP";
      explanation = `Looks like ${lookalikeOf} (same start and end, different middle). This is how address poisoning works. Do not pay until the payee confirms.`;
    } else if (paidLastTime) {
      status = "SAME_AS_LAST_PAID";
      action = "PAY";
      explanation = "Same address you paid last time.";
    } else if (last) {
      status = "CHANGED";
      action = "REVIEW";
      explanation = `Different from the address you paid last time (${last.address}). Confirm it with the payee through a channel you already trust, or ask them to prove it on SendSure.`;
    } else {
      status = "NEW";
      action = "REVIEW";
      explanation = "No previous payment to this payee. Confirm the address, or ask them to prove it on SendSure.";
    }
    for (const f of flags) {
      if (f === "DUPLICATE_ROW" || f === "ADDRESS_SHARED_WITH_OTHER_PAYEE" || f === "AMOUNT_JUMP") action = worst(action, "REVIEW");
    }
    return { ...r, address: addr, status, flags, action, lastPaidAddress: last?.address, lookalikeOf, explanation };
  });

  const summary: CheckSummary = {
    rows: checked.length,
    byAction: { PAY: 0, REVIEW: 0, STOP: 0 },
    byStatus: { SAME_AS_LAST_PAID: 0, CHANGED: 0, NEW: 0, LOOKALIKE: 0, INVALID_ADDRESS: 0 },
    amountByAction: { PAY: 0, REVIEW: 0, STOP: 0 },
  };
  for (const c of checked) {
    summary.byAction[c.action]++;
    summary.byStatus[c.status]++;
    summary.amountByAction[c.action] += c.amount ?? 0;
  }
  return { rows: checked, summary };
}

export function checkedRowsToRecords(rows: CheckedRow[]) {
  return rows.map((r) => ({
    payee: r.payee,
    address: r.address,
    amount: r.amount,
    token: r.token,
    chain: r.chain,
    reference: r.reference,
    action: r.action,
    status: r.status,
    flags: r.flags.join(" "),
    last_paid_address: r.lastPaidAddress,
    lookalike_of: r.lookalikeOf,
    explanation: r.explanation,
  }));
}
