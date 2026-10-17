import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import {
  DEFAULT_CAPS,
  MAINNET_BETA_MAX_CAPS,
  MAINNET_BETA_MIN_PERIOD,
  SENDSURE_AGENTS,
  createOrgMessage,
  permitTypedData,
  randomBytes32,
  usdc,
  type OrgRules,
} from "@sendsure/chain";
import { checkBetaBudget, checkBetaLimits, parseCreateOrg, parseInvites, parsePermit, verifyCreateOrg, verifyPermit } from "../lib/orgRelay";

const now = Math.floor(Date.now() / 1000);
const owner = privateKeyToAccount(generatePrivateKey());
const caps = (over: Partial<Record<keyof typeof DEFAULT_CAPS, string>> = {}) => ({
  orgPeriodCap: DEFAULT_CAPS.orgPeriodCap.toString(),
  payeePeriodCap: DEFAULT_CAPS.payeePeriodCap.toString(),
  claimMax: DEFAULT_CAPS.claimMax.toString(),
  coSignThreshold: DEFAULT_CAPS.coSignThreshold.toString(),
  ...over,
});
const createBody = (over: Record<string, unknown> = {}) => ({
  owner: owner.address,
  approvers: [owner.address],
  caps: caps(),
  periodLength: "2592000",
  changeCooldown: "86400",
  sandbox: true,
  validUntil: String(now + 1800),
  signature: `0x${"11".repeat(65)}`,
  ...over,
});

describe("create org", () => {
  it("accepts sane settings", () => {
    const r = parseCreateOrg(createBody(), now);
    expect(r.rules.caps.orgPeriodCap).toBe(usdc(100));
    expect(r.rules.sandbox).toBe(true);
  });

  it("refuses unsafe or inconsistent settings", () => {
    const bad = (over: Record<string, unknown>, text: RegExp) => expect(() => parseCreateOrg(createBody(over), now)).toThrow(text);
    bad({ caps: caps({ orgPeriodCap: "0" }) }, /above zero/);
    bad({ caps: caps({ claimMax: String(usdc(60)) }) }, /claim max/);
    bad({ approvers: [] }, /one to three approvers/);
    bad({ approvers: [SENDSURE_AGENTS.circleAgentWallet] }, /not SendSure's agents/);
    bad({ changeCooldown: "3600" }, /whole days/);
    bad({ periodLength: "90000" }, /whole days/);
    bad({ sandbox: "yes" }, /sandbox must be/);
  });

  it("needs the owner's signature over exactly these rules", async () => {
    const r = parseCreateOrg(createBody(), now);
    const text = createOrgMessage(r.rules, r.validUntil);
    await expect(verifyCreateOrg({ ...r, signature: await owner.signMessage({ message: text }) })).resolves.toBeUndefined();
    const other = privateKeyToAccount(generatePrivateKey());
    await expect(verifyCreateOrg({ ...r, signature: await other.signMessage({ message: text }) })).rejects.toThrow(/did not sign/);
    const looser: OrgRules = { ...r.rules, caps: { ...r.rules.caps, orgPeriodCap: usdc(1000) } };
    const signedLooser = await owner.signMessage({ message: createOrgMessage(looser, r.validUntil) });
    await expect(verifyCreateOrg({ ...r, signature: signedLooser })).rejects.toThrow(/did not sign/);
  });
});

describe("budget permit", () => {
  it("must be signed by the treasury it names", async () => {
    const org = privateKeyToAccount(generatePrivateKey()).address;
    const r = parsePermit(
      { owner: owner.address, spender: org, value: "10000000", nonce: "0", deadline: String(now + 600), signature: `0x${"11".repeat(65)}` },
      now,
    );
    await expect(verifyPermit({ ...r, signature: await owner.signTypedData(permitTypedData(r.message)) })).resolves.toBeUndefined();
    const other = privateKeyToAccount(generatePrivateKey());
    await expect(verifyPermit({ ...r, signature: await other.signTypedData(permitTypedData(r.message)) })).rejects.toThrow(
      /treasury did not sign/,
    );
  });
});

describe("invites", () => {
  const body = (refs: string[], validUntil = now + 600) => ({
    org: owner.address,
    payeeRefs: refs,
    validUntil: String(validUntil),
    signature: `0x${"11".repeat(65)}`,
  });
  it("limits batches and refuses duplicates and long-lived signatures", () => {
    const ref = randomBytes32();
    expect(parseInvites(body([ref]), now).payeeRefs).toHaveLength(1);
    expect(() => parseInvites(body([ref, ref]), now)).toThrow(/Duplicate/);
    expect(() => parseInvites(body(Array.from({ length: 51 }, () => randomBytes32())), now)).toThrow(/1 to 50/);
    expect(() => parseInvites(body([ref], now + 3600), now)).toThrow(/15 minutes/);
  });
});

describe("mainnet beta limits", () => {
  it("allows the ceiling itself, and nothing above it or a test org", () => {
    const max = MAINNET_BETA_MAX_CAPS;
    const month = MAINNET_BETA_MIN_PERIOD;
    expect(() => checkBetaLimits(max, false, month)).not.toThrow();
    expect(() => checkBetaLimits({ ...max, claimMax: max.claimMax + 1n }, false, month)).toThrow(/at most 10 USDC a bill/);
    expect(() => checkBetaLimits({ ...max, orgPeriodCap: max.orgPeriodCap + 1n }, false, month)).toThrow(/mainnet beta/);
    expect(() => checkBetaLimits({ ...max, coSignThreshold: max.coSignThreshold + 1n }, false, month)).toThrow(/co-signing above 5/);
    expect(() => checkBetaLimits(max, true, month)).toThrow(/no test orgs/);
    expect(() => checkBetaLimits(max, false, month - 86_400n)).toThrow(/at least 30 days/);
  });

  it("caps the budget an org lets its contract spend", () => {
    expect(() => checkBetaBudget(MAINNET_BETA_MAX_CAPS.orgPeriodCap)).not.toThrow();
    expect(() => checkBetaBudget(MAINNET_BETA_MAX_CAPS.orgPeriodCap + 1n)).toThrow(/budget of at most 100 USDC/);
  });
});
