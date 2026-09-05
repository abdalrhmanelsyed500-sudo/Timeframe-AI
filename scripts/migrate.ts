/**
 * Forward-only SQL migrator. Every schema change is a new file in /migrations.
 * Migration history is never rewritten.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { Client } from "pg";

const DIR = path.join(process.cwd(), "migrations");

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("CONFIGURATION_ERROR: DATABASE_URL is required");
  const client = new Client(url);
  await client.connect();
  await client.query(`CREATE TABLE IF NOT EXISTS _migrations (
    name TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);

  const applied = new Map<string, string>(
    (await client.query<{ name: string; checksum: string }>("SELECT name, checksum FROM _migrations")).rows.map((r) => [
      r.name,
      r.checksum,
    ]),
  );

  const files = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort() : [];
  let ran = 0;
  for (const file of files) {
    const sqlText = fs.readFileSync(path.join(DIR, file), "utf8");
    const checksum = crypto.createHash("sha256").update(sqlText).digest("hex").slice(0, 32);
    const prev = applied.get(file);
    if (prev) {
      if (prev !== checksum) {
        throw new Error(
          `MIGRATION_ERROR: ${file} was modified after being applied. Migrations are immutable — add a new migration instead.`,
        );
      }
      continue;
    }
    process.stdout.write(`applying ${file} ... `);
    try {
      await client.query("BEGIN");
      await client.query(sqlText);
      await client.query("INSERT INTO _migrations (name, checksum) VALUES ($1,$2)", [file, checksum]);
      await client.query("COMMIT");
      ran++;
      process.stdout.write("ok\n");
    } catch (e) {
      await client.query("ROLLBACK");
      process.stdout.write("FAILED\n");
      throw e;
    }
  }
  console.log(ran === 0 ? "Database is up to date." : `Applied ${ran} migration(s).`);
  await client.end();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
