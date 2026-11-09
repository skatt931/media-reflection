// One-time import of dated Obsidian journal notes into the separate journal database.
// Usage: node scripts/import-journal.ts import <folder> [--dry-run]
//        node scripts/import-journal.ts verify <folder>      (DB against the originals, exit 1 on any difference)
//        node scripts/import-journal.ts manifest             (sha256 and name per imported entry, like `shasum -a 256`)
// The database is JOURNAL_DB_PATH (default ./data/journal.sqlite).
import { existsSync } from "node:fs";
import { JournalStore, importJournal, verifyJournal } from "../src/journal.ts";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const [command, folder] = args.filter((arg) => !arg.startsWith("--"));
const dbPath = process.env.JOURNAL_DB_PATH || "./data/journal.sqlite";

if (!["import", "verify", "manifest"].includes(command ?? "") || (command !== "manifest" && !folder)) {
  console.error("Використання: import <папка> [--dry-run] | verify <папка> | manifest");
  process.exit(2);
}
if (folder && !existsSync(folder)) {
  console.error(`Папки немає: ${folder}`);
  process.exit(2);
}

process.umask(0o077);
const store = new JournalStore(dryRun ? ":memory:" : dbPath);
try {
  if (command === "import") {
    // A dry run still needs the existing rows to report what would change, so it reads the real DB in memory.
    if (dryRun && existsSync(dbPath)) {
      const real = new JournalStore(dbPath);
      for (const row of real.imported())
        store.add({ date: row.entry_date, body: row.body, source: "import", sourceName: row.source_name });
      real.close();
    }
    const report = importJournal(store, folder, dryRun);
    console.log(
      `${dryRun ? "[dry-run] " : ""}Додано: ${report.imported.length}, уже були: ${report.existing.length}.`,
    );
    for (const name of report.changed) console.log(`Файл змінився після імпорту, не оновлюю: ${name}`);
    for (const { name, reason } of report.skipped) console.log(`Пропущено ${name}: ${reason}`);
  } else if (command === "verify") {
    const report = verifyJournal(store, folder);
    console.log(`Файлів у папці: ${report.files}, записів-імпортів у БД: ${report.entries}.`);
    for (const problem of report.problems) console.log(`РІЗНИЦЯ ${problem}`);
    if (report.problems.length) process.exitCode = 1;
    else console.log("Збігається: кількість і текст (SHA-256) однакові.");
  } else {
    for (const row of store.imported()) console.log(`${row.body_sha256}  ${row.source_name}`);
  }
} finally {
  store.close();
}
