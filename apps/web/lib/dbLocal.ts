// Node only: a local SQLite file for development and tests, with the same migrations as D1.
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Db } from "./db";

/** Local SQLite via node:sqlite, with the D1 migrations applied (tracked like wrangler does). */
export async function sqliteDb(file: string, migrationsDir = path.join(process.cwd(), "migrations")): Promise<Db> {
  const { DatabaseSync } = await import("node:sqlite");
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("CREATE TABLE IF NOT EXISTS d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TEXT)");
  const applied = new Set((db.prepare("SELECT name FROM d1_migrations").all() as { name: string }[]).map((r) => r.name));
  for (const name of readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    if (applied.has(name)) continue;
    db.exec(readFileSync(path.join(migrationsDir, name), "utf8"));
    db.prepare("INSERT INTO d1_migrations (name, applied_at) VALUES (?, datetime('now'))").run(name);
  }
  type Param = string | number | bigint | null;
  const args = (p: unknown[]) => p.map((v) => (v === undefined ? null : (v as Param)));
  return {
    all: async <T>(sql: string, ...p: unknown[]) => db.prepare(sql).all(...args(p)) as T[],
    first: async <T>(sql: string, ...p: unknown[]) => (db.prepare(sql).get(...args(p)) as T | undefined) ?? null,
    run: async (sql, ...p) => ({ changes: Number(db.prepare(sql).run(...args(p)).changes) }),
  };
}
