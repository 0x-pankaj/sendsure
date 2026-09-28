import { existsSync } from "node:fs";
import { resolve } from "node:path";

/** Loads contracts/.env (test keys, gitignored) and apps/web/.env.local (relayer key) if present. */
export function loadEnv(): void {
  for (const file of ["contracts/.env", "apps/web/.env.local"]) {
    const path = resolve(import.meta.dirname, "../..", file);
    if (existsSync(path)) process.loadEnvFile(path);
  }
}

export function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : fallback;
}

export function need(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (see contracts/.env)`);
  return v;
}
