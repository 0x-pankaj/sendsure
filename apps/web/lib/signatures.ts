// Server only. Owner signatures the relayer acted on, kept in the database until they expire, so a replay is
// refused on every Worker instance (an in-memory set only protects the instance that saw it first).
import { getDb } from "./db";

const now = () => Math.floor(Date.now() / 1000);

/** Claims a signature before acting on it. False if it was claimed already (a replay). */
export async function claimSignature(sig: string, kind: string, validUntil: bigint): Promise<boolean> {
  const db = await getDb();
  await db.run("DELETE FROM used_signatures WHERE expires_at < ?", now() - 60);
  // Only a conflict means "used": any other database error is thrown, never mistaken for a replay.
  const { changes } = await db.run(
    "INSERT INTO used_signatures (sig, kind, expires_at, created_at) VALUES (?, ?, ?, ?) ON CONFLICT (sig) DO NOTHING",
    sig.toLowerCase(),
    kind,
    Number(validUntil),
    now(),
  );
  return changes === 1;
}

/** Frees a claimed signature when acting on it failed, so the same signature can be retried. */
export async function releaseSignature(sig: string): Promise<void> {
  const db = await getDb();
  await db.run("DELETE FROM used_signatures WHERE sig = ?", sig.toLowerCase());
}

export async function signatureUsed(sig: string): Promise<boolean> {
  const db = await getDb();
  return Boolean(await db.first("SELECT sig FROM used_signatures WHERE sig = ?", sig.toLowerCase()));
}
