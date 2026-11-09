// Server side of the weekly copy into Obsidian: writes new bot diary entries and new ideas as .md into export folders.
// Usage: node scripts/journal-export.ts [--dry-run] [--json]
// The database is JOURNAL_DB_PATH (default ./data/journal.sqlite), the folder JOURNAL_EXPORT_DIR
// (default ./data/journal-export); the ideas go to IDEAS_EXPORT_DIR (default ./data/ideas-export).
// The Mac pulls both with `npm run journal:pull`.
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { JournalStore, exportJournal, exportIdeas } from "../src/journal.ts";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const json = args.includes("--json");
const dbPath = process.env.JOURNAL_DB_PATH || "./data/journal.sqlite";
const dir = resolve(process.env.JOURNAL_EXPORT_DIR || "./data/journal-export");
const ideasDir = resolve(process.env.IDEAS_EXPORT_DIR || "./data/ideas-export");

if (!existsSync(dbPath)) {
  console.error(`БД щоденника немає: ${dbPath}`);
  process.exit(2);
}

process.umask(0o077);
const store = new JournalStore(dbPath);
try {
  const report = exportJournal(store, dir, dryRun);
  const ideas = exportIdeas(store, ideasDir, dryRun);
  if (json) console.log(JSON.stringify({ dir, dryRun, ...report, ideas: { dir: ideasDir, ...ideas } }));
  else {
    console.log(
      `${dryRun ? "[dry-run] " : ""}Файлів записів: ${report.files.length}, нових: ${report.written.length}. ${dir}`,
    );
    for (const name of report.written) console.log(`Новий: ${name}`);
    for (const name of report.retired) console.log(`Запис видалено в боті, файл у .deleted/: ${name}`);
    console.log(
      `${dryRun ? "[dry-run] " : ""}Ідей: ${ideas.files.length}, нових: ${ideas.written.length}. ${ideasDir}`,
    );
    for (const name of ideas.written) console.log(`Нова ідея: ${name}`);
    for (const name of ideas.retired) console.log(`Ідею видалено в боті, файл у .deleted/: ${name}`);
  }
} finally {
  store.close();
}
