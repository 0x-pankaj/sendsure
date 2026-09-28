// Server only. SendSure's database: Cloudflare D1 in production (the Worker's DB binding), a local
// SQLite file under Node for development and tests. Both run the SQL files in apps/web/migrations.

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

let current: Promise<Db> | undefined;

/** The Worker's D1 binding when running on Cloudflare; null under plain Node. */
async function cloudflareD1(): Promise<D1Like | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const { env } = await getCloudflareContext({ async: true });
    return (env as { DB?: D1Like }).DB ?? null;
  } catch {
    return null;
  }
}

export function getDb(): Promise<Db> {
  current ??= (async () => {
    const d1 = await cloudflareD1();
    if (d1) return d1Db(d1);
    const { sqliteDb } = await import("./dbLocal");
    return sqliteDb(process.env.SENDSURE_DB_FILE ?? "data/sendsure.db");
  })();
  return current;
}

/** Tests and the Cloudflare entry point inject their database here. */
export function setDb(db: Db): void {
  current = Promise.resolve(db);
}
