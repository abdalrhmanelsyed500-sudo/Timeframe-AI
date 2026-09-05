/**
 * Starts the local development PostgreSQL instance (embedded binaries).
 * Production uses a real managed PostgreSQL via DATABASE_URL.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const DATA_DIR = process.env.PGDATA_DIR ?? path.join(os.homedir(), ".pgdata");
const PORT = process.env.PGPORT ?? "5433";
const BIN = path.join(process.cwd(), "node_modules/@embedded-postgres/linux-x64/native/bin");

function run(cmd: string, args: string[]) {
  return spawnSync(path.join(BIN, cmd), args, { encoding: "utf8" });
}

if (!fs.existsSync(BIN)) {
  console.error("Embedded PostgreSQL binaries not installed (dev dependency 'embedded-postgres').");
  process.exit(1);
}

const status = run("pg_ctl", ["-D", DATA_DIR, "status"]);
if (status.status === 0) {
  console.log(`PostgreSQL already running on port ${PORT}.`);
  process.exit(0);
}

const start = run("pg_ctl", ["-D", DATA_DIR, "-l", path.join(DATA_DIR, "server.log"), "-o", `-p ${PORT}`, "start"]);
process.stdout.write(start.stdout || "");
if (start.status !== 0) {
  process.stderr.write(start.stderr || "");
  process.exit(1);
}
console.log(`PostgreSQL listening on port ${PORT}.`);
