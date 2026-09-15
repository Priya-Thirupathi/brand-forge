import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { createDbClient } from "./dbClient";

const MIGRATIONS_DIR = path.join(process.cwd(), "db", "migrations");
// Arbitrary fixed key: concurrent `npm run migrate` invocations serialize on this
// advisory lock instead of racing to apply the same file twice.
const ADVISORY_LOCK_KEY = 84_217_001;

async function main() {
  const client = createDbClient();
  await client.connect();
  try {
    await client.query("select pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
    await client.query(`
      create table if not exists schema_migrations (
        name text primary key,
        checksum text not null,
        applied_at timestamptz not null default now()
      )
    `);

    const files = (await readdir(MIGRATIONS_DIR))
      .filter((name) => name.endsWith(".sql"))
      .sort();

    for (const name of files) {
      const sql = await readFile(path.join(MIGRATIONS_DIR, name), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");

      const { rows } = await client.query<{ checksum: string }>(
        "select checksum from schema_migrations where name = $1",
        [name],
      );

      if (rows.length > 0) {
        if (rows[0].checksum !== checksum) {
          throw new Error(
            `Migration "${name}" was already applied but its contents changed since — ` +
              "add a new migration file instead of editing an applied one.",
          );
        }
        console.log(`skip  ${name} (already applied)`);
        continue;
      }

      console.log(`apply ${name}`);
      await client.query("begin");
      try {
        await client.query(sql);
        await client.query("insert into schema_migrations (name, checksum) values ($1, $2)", [
          name,
          checksum,
        ]);
        await client.query("commit");
      } catch (err) {
        await client.query("rollback");
        throw err;
      }
    }
  } finally {
    await client.query("select pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]);
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
