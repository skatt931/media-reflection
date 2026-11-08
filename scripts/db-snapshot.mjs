// Consistent copy of a live SQLite database (VACUUM INTO), safe while the bot is running.
// Usage: node scripts/db-snapshot.mjs <source.sqlite> <destination.sqlite>
// Also piped over SSH by scripts/backup.mjs: node --input-type=module - <source> <destination> < db-snapshot.mjs
import { chmodSync, rmSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const [source, destination] = process.argv.slice(2);
if (!source || !destination) {
  console.error("Використання: db-snapshot.mjs <source.sqlite> <destination.sqlite>");
  process.exit(2);
}

rmSync(destination, { force: true });
const db = new DatabaseSync(source, { readOnly: true });
db.prepare("VACUUM INTO ?").run(destination);
db.close();
chmodSync(destination, 0o600);
