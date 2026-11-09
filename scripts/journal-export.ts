// Server side of the weekly copy into Obsidian: writes new bot diary entries as .md into the export folder.
// Usage: node scripts/journal-export.ts [--dry-run] [--json]
// The database is JOURNAL_DB_PATH (default ./data/journal.sqlite), the folder JOURNAL_EXPORT_DIR
// (default ./data/journal-export). The Mac pulls it with `npm run journal:pull`.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { JournalStore, exportJournal } from "../src/journal.ts";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const json = args.includes("--json");
const dbPath = process.env.JOURNAL_DB_PATH || "./data/journal.sqlite";
const dir = resolve(process.env.JOURNAL_EXPORT_DIR || "./data/journal-export");

if (!existsSync(dbPath)) {
  console.error(`БД щоденника немає: ${dbPath}`);
  process.exit(2);
}

process.umask(0o077);
const store = new JournalStore(dbPath);
try {
  const report = exportJournal(store, dir, dryRun);
  if (json) console.log(JSON.stringify({ dir, dryRun, ...report }));
  else {
    console.log(
      `${dryRun ? "[dry-run] " : ""}Файлів записів: ${report.files.length}, нових: ${report.written.length}. ${dir}`,
    );
    for (const name of report.written) console.log(`Новий: ${name}`);
    for (const name of report.retired) console.log(`Запис видалено в боті, файл у .deleted/: ${name}`);
  }
} finally {
  store.close();
}
