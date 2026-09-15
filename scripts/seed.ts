import { readFile } from "node:fs/promises";
import path from "node:path";
import { createDbClient } from "./dbClient";

async function main() {
  const client = createDbClient();
  await client.connect();
  try {
    const sql = await readFile(path.join(process.cwd(), "db", "seed.sql"), "utf8");
    await client.query(sql);
    console.log("seed applied");
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
