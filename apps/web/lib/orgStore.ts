import type { Address, Hex } from "viem";
import { payeeRefOf, randomBytes32 } from "@sendsure/chain";
import { normalizeName } from "@sendsure/core";

/** A payee the payer invited. The name stays in this browser; only payeeRef goes on-chain. */
export interface Vendor {
  name: string;
  email?: string;
  payeeRef: Hex;
  invitedAt: number;
}

/**
 * A payer's org as this browser knows it. The salt makes payeeRef = keccak(salt, vendor) unguessable
 * and lets the payout check find each vendor's invite from a payout list. Back it up.
 */
export interface SavedOrg {
  org: Address;
  owner: Address;
  name: string;
  salt: Hex;
  createdAt: number;
  vendors: Vendor[];
  /** Made with a throwaway test wallet. */
  test?: boolean;
}

const KEY = "sendsure.orgs.v1";

export function loadOrgs(): SavedOrg[] {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as SavedOrg[]) : [];
  } catch {
    return [];
  }
}

export function saveOrg(org: SavedOrg): SavedOrg[] {
  const all = [org, ...loadOrgs().filter((o) => o.org.toLowerCase() !== org.org.toLowerCase())];
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch {
    // Storage blocked: the org still works this session; the backup file is the way to keep it.
  }
  return all;
}

export const newSalt = (): Hex => randomBytes32();
export const vendorKey = (name: string) => normalizeName(name);
export const payeeRefFor = (org: SavedOrg, name: string): Hex => payeeRefOf(org.salt, vendorKey(name));

export function inviteLink(origin: string, org: SavedOrg, v: Vendor): string {
  return `${origin}/verify?org=${org.org}&ref=${v.payeeRef}&name=${encodeURIComponent(org.name)}`;
}

/** "Name, email" lines -> vendors (duplicates and names already invited are skipped). */
export function parseVendorLines(text: string, org: SavedOrg): { name: string; email?: string; payeeRef: Hex }[] {
  const seen = new Set(org.vendors.map((v) => v.payeeRef));
  const out: { name: string; email?: string; payeeRef: Hex }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const [rawName, rawEmail] = line.split(",").map((x) => x.trim());
    if (!rawName) continue;
    const payeeRef = payeeRefFor(org, rawName);
    if (seen.has(payeeRef)) continue;
    seen.add(payeeRef);
    out.push({ name: rawName, email: rawEmail && rawEmail.includes("@") ? rawEmail : undefined, payeeRef });
  }
  return out;
}
