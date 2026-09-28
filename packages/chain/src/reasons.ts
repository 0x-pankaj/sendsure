/** Mirrors Mandate.Outcome and Mandate.Reason (same order as the Solidity enums). */
export const OUTCOMES = ["PAYABLE", "ALREADY_SETTLED", "ESCALATED", "REFUSED"] as const;

export const REASONS = [
  "NONE", "PAUSED", "TOKEN_NOT_ALLOWED", "ZERO_AMOUNT", "EXPIRED", "BAD_PERIOD", "NONCE_USED",
  "PAYEE_NOT_BOUND", "PAYEE_FROZEN", "PAYEE_CHANGE_PENDING", "PAYEE_COOLDOWN", "PAYEE_IS_CONTROLLER",
  "PAYEE_BLOCKLISTED", "TREASURY_BLOCKLISTED", "BAD_SIGNATURE", "DUPLICATE_REF", "OVER_CLAIM_MAX",
  "OVER_PAYEE_CAP", "OVER_ORG_CAP", "INSUFFICIENT_ALLOWANCE", "INSUFFICIENT_BALANCE",
  "NEEDS_COSIGN_ATTESTED_PAYEE", "NEEDS_COSIGN_NEW_PAYOUT", "NEEDS_COSIGN_ABOVE_THRESHOLD",
] as const;

export type Outcome = (typeof OUTCOMES)[number];
export type Reason = (typeof REASONS)[number];

/** Plain-English text for each reason, for the UI and the decision log. */
export const REASON_TEXT: Record<Reason, string> = {
  NONE: "All rules passed.",
  PAUSED: "Payments are paused for this business.",
  TOKEN_NOT_ALLOWED: "This token is not allowed.",
  ZERO_AMOUNT: "The amount is zero.",
  EXPIRED: "The claim has expired.",
  BAD_PERIOD: "The work period is invalid.",
  NONCE_USED: "This claim number was already used.",
  PAYEE_NOT_BOUND: "The payee has not proven a payout address.",
  PAYEE_FROZEN: "The payee is frozen.",
  PAYEE_CHANGE_PENDING: "An address change is waiting out its cooldown; payments are held.",
  PAYEE_COOLDOWN: "The payee's new binding is still in its first-bind cooldown.",
  PAYEE_IS_CONTROLLER: "The payee is also an agent, approver, owner or the treasury.",
  PAYEE_BLOCKLISTED: "The payee's address is on the token's blocklist.",
  TREASURY_BLOCKLISTED: "The treasury is on the token's blocklist.",
  BAD_SIGNATURE: "The claim is not signed by the payee's proven address.",
  DUPLICATE_REF: "This invoice was already paid (or claimed at another amount).",
  OVER_CLAIM_MAX: "Above the per-claim maximum.",
  OVER_PAYEE_CAP: "Above this payee's limit for the period.",
  OVER_ORG_CAP: "Above the business's limit for the period.",
  INSUFFICIENT_ALLOWANCE: "The treasury's allowance does not cover it.",
  INSUFFICIENT_BALANCE: "The treasury's balance does not cover it.",
  NEEDS_COSIGN_ATTESTED_PAYEE: "The address was vouched for by the payer, so a human must co-sign every payment.",
  NEEDS_COSIGN_NEW_PAYOUT: "First payment to a new or changed address needs a human co-sign.",
  NEEDS_COSIGN_ABOVE_THRESHOLD: "Above the co-sign threshold for this period.",
};
