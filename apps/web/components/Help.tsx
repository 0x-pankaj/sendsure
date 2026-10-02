import { CONTACT_URL } from "../lib/contact";

/** A way out when something is unclear: a person answers. */
export function Help({ topic }: { topic?: string }) {
  return (
    <p className="hint" style={{ marginTop: 24 }}>
      Stuck{topic ? ` on ${topic}` : ""}, or something looks wrong? <a href={CONTACT_URL}>Ask us on Telegram</a>: a person answers, usually
      the same day. What SendSure keeps about you: <a href="/data">see here</a>.
    </p>
  );
}
