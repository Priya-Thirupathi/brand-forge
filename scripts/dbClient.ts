import { Client, Pool } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

function connectionString(): string {
  const value = process.env.DATABASE_URL;
  if (!value) throw new Error("DATABASE_URL is not set");
  return value;
}

// A one-shot script (migrate, seed) connects once and disconnects — a single Client.
export function createDbClient(): Client {
  return new Client({ connectionString: connectionString() });
}

// scripts/eval.ts (Stage 2) runs many sequential queries over one process lifetime — a Pool,
// like the app's own lib/adapters/postgres/pool.ts, but without that module's hot-reload
// singleton (irrelevant to a script that runs once and calls `pool.end()` to exit cleanly).
export function createDbPool(): Pool {
  return new Pool({ connectionString: connectionString() });
}
