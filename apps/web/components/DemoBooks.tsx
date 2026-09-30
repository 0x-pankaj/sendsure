"use client";

import { LedgerDownload, ledgerInput, type BooksData } from "./LedgerDownload";

/** The sandbox demo org's books (public), in every format. */
export function DemoBooks() {
  const load = async () => {
    const res = await fetch("/api/try/books");
    const data = (await res.json()) as BooksData & { error?: string };
    if (!res.ok) throw new Error(data.error ?? `The server answered ${res.status}.`);
    return ledgerInput(data, "SendSure demo org (sandbox)", (ref) => `Demo payee ${ref.slice(2, 8)}`);
  };
  return <LedgerDownload load={load} fileBase="sendsure-demo" />;
}
