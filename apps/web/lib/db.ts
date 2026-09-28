// Server only. SendSure's database: Cloudflare D1 in production, a local SQLite file in development
// and tests. Both run the same SQL files from apps/web/migrations.
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";

export type Row = Record<string, unknown>;

export interface Db {
  all<T = Row>(sql: string, ...params: unknown[]): Promise<T[]>;
  first<T = Row>(sql: string, ...params: unknown[]): Promise<T | null>;
  run(sql: string, ...params: unknown[]): Promise<{ changes: number }>;
}

/** The part of a Cloudflare D1 binding this app uses. */
export interface D1Like {
  prepare(sql: string): {
    bind(...values: unknown[]): {
      all<T>(): Promise<{ results: T[] }>;
      first<T>(): Promise<T | null>;
      run(): Promise<{ meta: { changes?: number } }>;
    };
  };
}

export function d1Db(binding: D1Like): Db {
  return {
    all: async <T>(sql: string, ...p: unknown[]) =>
      (
        await binding
          .prepare(sql)
          .bind(...p)
          .all<T>()
      ).results,
    first: <T>(sql: string, ...p: unknown[]) =>
      binding
        .prepare(sql)
        .bind(...p)
        .first<T>(),
    run: async (sql, ...p) => ({
      changes:
        (
          await binding
            .prepare(sql)
            .bind(...p)
            .run()
        ).meta.changes ?? 0,
    }),
  };
}

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

let current: Promise<Db> | undefined;

export function getDb(): Promise<Db> {
  current ??= sqliteDb(process.env.SENDSURE_DB_FILE ?? path.join(process.cwd(), "data", "sendsure.db"));
  return current;
}

/** Tests and the Cloudflare entry point inject their database here. */
export function setDb(db: Db): void {
  current = Promise.resolve(db);
}
