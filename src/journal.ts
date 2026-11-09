import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

type Row = Record<string, any>;
export type JournalSource = "import" | "bot";

// Additive only: a new version appends a step, existing steps never change.
const migrations = [
  `CREATE TABLE journal_entries(
     id INTEGER PRIMARY KEY,
     entry_date TEXT NOT NULL,
     body TEXT NOT NULL,
     source TEXT NOT NULL CHECK(source IN ('import','bot')),
     source_name TEXT,
     body_sha256 TEXT NOT NULL,
     created_at TEXT NOT NULL,
     updated_at TEXT NOT NULL
   );
   CREATE UNIQUE INDEX journal_import_name ON journal_entries(source_name) WHERE source='import';
   CREATE INDEX journal_entry_date ON journal_entries(entry_date);`,
];
export const journalSchemaVersion = migrations.length;

export const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

// "ДД.ММ.РР.md" (leading zeros optional, "8.07.26.md") → "2026-07-08"; null for any other name or an impossible date.
export function journalFileDate(name: string) {
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{2})\.md$/.exec(name);
  if (!match) return null;
  const [day, month, year] = match.slice(1).map(Number);
  const date = new Date(Date.UTC(2000 + year, month - 1, day));
  if (date.getUTCFullYear() !== 2000 + year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
    return null;
  return date.toISOString().slice(0, 10);
}

export class JournalStore {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    const version = Number(this.all("PRAGMA user_version")[0].user_version);
    if (version > journalSchemaVersion)
      throw new Error(`БД щоденника має версію ${version}, а цей код знає лише ${journalSchemaVersion}.`);
    for (let next = version; next < journalSchemaVersion; next++) {
      this.transaction(() => {
        this.db.exec(migrations[next]);
        this.db.exec(`PRAGMA user_version=${next + 1}`);
      });
    }
  }
  all(sql: string, ...args: any[]): Row[] {
    return this.db.prepare(sql).all(...args) as Row[];
  }
  run(sql: string, ...args: any[]) {
    return this.db.prepare(sql).run(...args);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  add(entry: { date: string; body: string; source: JournalSource; sourceName?: string | null }) {
    const now = new Date().toISOString();
    return this.run(
      "INSERT INTO journal_entries(entry_date,body,source,source_name,body_sha256,created_at,updated_at) VALUES(?,?,?,?,?,?,?)",
      entry.date,
      entry.body,
      entry.source,
      entry.sourceName ?? null,
      sha256(entry.body),
      now,
      now,
    );
  }
  imported() {
    return this.all("SELECT * FROM journal_entries WHERE source='import' ORDER BY entry_date,source_name");
  }
  close() {
    this.db.close();
  }
}

export type ImportReport = {
  imported: string[];
  existing: string[];
  changed: string[];
  skipped: { name: string; reason: string }[];
};

// Dated files of a folder (non-recursive), keyed by file name; everything else is reported as skipped.
function readJournalFolder(dir: string) {
  const files: { name: string; date: string; bytes: Buffer }[] = [];
  const skipped: ImportReport["skipped"] = [];
  const byDate = new Map<string, string>();
  for (const name of readdirSync(dir).sort()) {
    if (!statSync(join(dir, name)).isFile()) continue;
    const date = journalFileDate(name);
    if (!date) {
      skipped.push({ name, reason: "назва не за форматом ДД.ММ.РР.md" });
      continue;
    }
    const first = byDate.get(date);
    if (first) {
      skipped.push({ name, reason: `та сама дата ${date}, що й ${first}` });
      continue;
    }
    byDate.set(date, name);
    files.push({ name, date, bytes: readFileSync(join(dir, name)) });
  }
  return { files, skipped };
}

const utf8 = new TextDecoder("utf-8", { fatal: true });

// Idempotent: a file already imported (by name) is never touched again, even if it changed since.
export function importJournal(store: JournalStore, dir: string, dryRun = false): ImportReport {
  const { files, skipped } = readJournalFolder(dir);
  const report: ImportReport = { imported: [], existing: [], changed: [], skipped };
  const run = () => {
    for (const { name, date, bytes } of files) {
      let body: string;
      try {
        body = utf8.decode(bytes);
      } catch {
        report.skipped.push({ name, reason: "вміст не є коректним UTF-8" });
        continue;
      }
      const row = store.all(
        "SELECT body_sha256 FROM journal_entries WHERE source='import' AND source_name=?",
        name,
      )[0];
      if (row) {
        (row.body_sha256 === sha256(bytes) ? report.existing : report.changed).push(name);
        continue;
      }
      if (!dryRun) store.add({ date, body, source: "import", sourceName: name });
      report.imported.push(name);
    }
  };
  if (dryRun) run();
  else store.transaction(run);
  return report;
}

export type VerifyReport = { files: number; entries: number; problems: string[] };

// Compares the imported rows with the originals byte for byte (SHA-256 of the file against the stored text).
export function verifyJournal(store: JournalStore, dir: string): VerifyReport {
  const { files } = readJournalFolder(dir);
  const rows = new Map(store.imported().map((row) => [row.source_name as string, row]));
  const problems: string[] = [];
  for (const { name, date, bytes } of files) {
    const row = rows.get(name);
    if (!row) problems.push(`${name}: немає в БД`);
    else if (row.entry_date !== date)
      problems.push(`${name}: дата в БД ${row.entry_date}, за назвою ${date}`);
    else if (sha256(Buffer.from(row.body, "utf8")) !== sha256(bytes))
      problems.push(`${name}: текст відрізняється`);
    else if (row.body_sha256 !== sha256(bytes))
      problems.push(`${name}: збережена контрольна сума не збігається`);
    rows.delete(name);
  }
  for (const name of rows.keys()) problems.push(`${name}: є в БД, але немає у вказаній папці`);
  return { files: files.length, entries: store.imported().length, problems };
}
