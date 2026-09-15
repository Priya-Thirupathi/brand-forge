import { Pool } from "pg";

// booking-app/lib/db.ts's hot-reload pattern (minus Prisma — D20 is plain `pg`): reused across
// `next dev` file-edit reloads so each save doesn't leak a fresh pool of connections.
declare global {
  var __brandForgeDbPool: Pool | undefined;
}

function createPool(): Pool {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  return new Pool({
    connectionString,
    ssl: connectionString.includes("sslmode=require") ? { rejectUnauthorized: true } : undefined,
  });
}

export const pool = global.__brandForgeDbPool ?? createPool();
if (process.env.NODE_ENV !== "production") {
  global.__brandForgeDbPool = pool;
}
