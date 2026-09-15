import { Client } from "pg";
import dotenv from "dotenv";

dotenv.config({ path: ".env.local" });

export function createDbClient(): Client {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is not set");
  }
  return new Client({ connectionString });
}
