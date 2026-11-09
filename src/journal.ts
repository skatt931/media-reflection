import { DatabaseSync } from "node:sqlite";
import {
  mkdirSync,
  chmodSync,
  existsSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { createHash } from "node:crypto";

type Row = Record<string, any>;
export type JournalSource = "import" | "bot";
export type IdeaSource = "text" | "voice";

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
  // The entry being collected in the bot: one row, so a restart or a long pause never loses the text.
  `CREATE TABLE journal_draft(
     id INTEGER PRIMARY KEY CHECK(id=1),
     entry_date TEXT NOT NULL,
     body TEXT NOT NULL,
     parts INTEGER NOT NULL,
     last_update INTEGER NOT NULL,
     status_message INTEGER,
     updated_at TEXT NOT NULL
   );`,
  // The file name a bot entry got in the Obsidian export; set once and never reused.
  `ALTER TABLE journal_entries ADD COLUMN export_name TEXT;
   CREATE UNIQUE INDEX journal_export_name ON journal_entries(export_name) WHERE export_name IS NOT NULL;`,
  // Quick ideas: a separate entity that lives next to the diary. `update_id` makes a replayed Telegram update harmless.
  `CREATE TABLE ideas(
     id INTEGER PRIMARY KEY,
     update_id INTEGER UNIQUE,
     body TEXT NOT NULL,
     source TEXT NOT NULL CHECK(source IN ('text','voice')),
     idea_date TEXT NOT NULL,
     idea_time TEXT NOT NULL,
     body_sha256 TEXT NOT NULL,
     export_name TEXT,
     created_at TEXT NOT NULL
   );
   CREATE UNIQUE INDEX ideas_export_name ON ideas(export_name) WHERE export_name IS NOT NULL;`,
];
export const journalSchemaVersion = migrations.length;

export const sha256 = (data: string | Uint8Array) => createHash("sha256").update(data).digest("hex");

function calendarDate(year: number, month: number, day: number) {
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day)
    return null;
  return date.toISOString().slice(0, 10);
}

// "ДД.ММ.РР.md" (leading zeros optional, "8.07.26.md") → "2026-07-08"; null for any other name or an impossible date.
export function journalFileDate(name: string) {
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{2})\.md$/.exec(name);
  if (!match) return null;
  const [day, month, year] = match.slice(1).map(Number);
  return calendarDate(2000 + year, month, day);
}

// What a person types as a date: "5.11.26", "05.11.2026" or "2026-11-05" → "2026-11-05"; null otherwise.
export function parseDiaryDate(text: string) {
  const value = text.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (iso) return calendarDate(Number(iso[1]), Number(iso[2]), Number(iso[3]));
  const dotted = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(value);
  if (!dotted) return null;
  const year = Number(dotted[3]);
  return calendarDate(dotted[3].length === 2 ? 2000 + year : year, Number(dotted[2]), Number(dotted[1]));
}

export class JournalStore {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    // The bot and the export script open the same file; wait for a short write instead of failing.
    this.db = new DatabaseSync(path, { timeout: 5000 });
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
  entry(id: number) {
    return this.all("SELECT * FROM journal_entries WHERE id=?", id)[0];
  }
  lastEntryDate() {
    return this.all("SELECT MAX(entry_date) AS date FROM journal_entries")[0].date as string | null;
  }
  // Only what the bot wrote can be undone there; imported notes are never touched.
  removeBotEntry(id: number) {
    return Number(this.run("DELETE FROM journal_entries WHERE id=? AND source='bot'", id).changes) > 0;
  }
  draft() {
    return this.all("SELECT * FROM journal_draft WHERE id=1")[0];
  }
  // Updates up to `update - 1` never append (a replay after a crash); the opening update itself may.
  startDraft(date: string, update: number) {
    this.run(
      "INSERT OR IGNORE INTO journal_draft(id,entry_date,body,parts,last_update,updated_at) VALUES(1,?,'',0,?,?)",
      date,
      update - 1,
      new Date().toISOString(),
    );
    return this.draft()!;
  }
  // False when this update was already added.
  appendDraft(update: number, text: string) {
    const draft = this.draft();
    if (!draft || update <= draft.last_update) return false;
    this.run(
      "UPDATE journal_draft SET body=?,parts=parts+1,last_update=?,updated_at=? WHERE id=1",
      draft.body ? `${draft.body}\n\n${text}` : text,
      update,
      new Date().toISOString(),
    );
    return true;
  }
  setDraftDate(date: string) {
    this.run("UPDATE journal_draft SET entry_date=?,updated_at=? WHERE id=1", date, new Date().toISOString());
  }
  setDraftMessage(id: number) {
    this.run("UPDATE journal_draft SET status_message=? WHERE id=1", id);
  }
  // Turns the draft into an entry. An empty draft is just dropped (null).
  finishDraft() {
    return this.transaction(() => {
      const draft = this.draft();
      if (!draft) return null;
      this.run("DELETE FROM journal_draft WHERE id=1");
      if (!draft.body.trim()) return null;
      const id = Number(
        this.add({ date: draft.entry_date, body: draft.body, source: "bot" }).lastInsertRowid,
      );
      return { id, date: draft.entry_date as string, length: (draft.body as string).length };
    });
  }
  discardDraft() {
    this.run("DELETE FROM journal_draft WHERE id=1");
  }
  // `date`/`time` are the local day and minute the idea was written; null when this update was already saved.
  addIdea(idea: { body: string; source: IdeaSource; date: string; time: string; update?: number }) {
    const result = this.run(
      "INSERT OR IGNORE INTO ideas(update_id,body,source,idea_date,idea_time,body_sha256,created_at) VALUES(?,?,?,?,?,?,?)",
      idea.update ?? null,
      idea.body,
      idea.source,
      idea.date,
      idea.time,
      sha256(idea.body),
      new Date().toISOString(),
    );
    return Number(result.changes) ? Number(result.lastInsertRowid) : null;
  }
  idea(id: number) {
    return this.all("SELECT * FROM ideas WHERE id=?", id)[0];
  }
  ideaCount() {
    return Number(this.all("SELECT count(*) AS n FROM ideas")[0].n);
  }
  // The list runs from the newest idea to the oldest; "next" is one step older, both ends wrap around.
  newestIdea() {
    return this.all("SELECT * FROM ideas ORDER BY id DESC LIMIT 1")[0];
  }
  ideaStep(id: number, direction: "newer" | "older") {
    const [cmp, order] = direction === "older" ? ["<", "DESC"] : [">", "ASC"];
    // Past the oldest idea comes the newest, past the newest the oldest: the same order without the bound.
    return (
      this.all(`SELECT * FROM ideas WHERE id${cmp}? ORDER BY id ${order} LIMIT 1`, id)[0] ??
      this.all(`SELECT * FROM ideas ORDER BY id ${order} LIMIT 1`)[0]
    );
  }
  // 1 for the newest idea.
  ideaPosition(id: number) {
    return Number(this.all("SELECT count(*) AS n FROM ideas WHERE id>=?", id)[0].n);
  }
  removeIdea(id: number) {
    return Number(this.run("DELETE FROM ideas WHERE id=?", id).changes) > 0;
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

export type ExportReport = {
  named: string[];
  written: string[];
  retired: string[];
  files: { name: string; sha256: string }[];
};

// "2026-11-05", 1 → "05.11.26.md"; 2 → "05.11.26 (2).md".
export function journalExportName(date: string, n = 1) {
  const [year, month, day] = date.split("-");
  return `${day}.${month}.${year.slice(2)}${n > 1 ? ` (${n})` : ""}.md`;
}

const retiredDir = ".deleted";
const markdownFiles = (dir: string) =>
  existsSync(dir)
    ? readdirSync(dir).filter((name) => name.endsWith(".md") && statSync(join(dir, name)).isFile())
    : [];

// Writes bot entries as Obsidian notes (text as is, like the imported ones) into `dir`, which the Mac copies
// with `rsync --ignore-existing`. A name is given once and never reused, an existing file is never rewritten;
// the file of an entry deleted in the bot moves to `.deleted/`, so it is no longer copied but keeps its name.
export function exportJournal(store: JournalStore, dir: string, dryRun = false): ExportReport {
  const report: ExportReport = { named: [], written: [], retired: [], files: [] };
  const present = markdownFiles(dir);
  const used = new Set([...present, ...markdownFiles(join(dir, retiredDir))]);
  const importDates = new Set<string>();
  for (const row of store.all("SELECT entry_date, source_name, export_name FROM journal_entries")) {
    if (row.source_name) used.add(row.source_name);
    if (row.export_name) used.add(row.export_name);
    if (row.source_name) importDates.add(row.entry_date);
  }
  const entries = store.all("SELECT * FROM journal_entries WHERE source='bot' ORDER BY entry_date, id");
  const assign = () => {
    for (const entry of entries) {
      if (entry.export_name) continue;
      // A day that already has an imported note starts at "(2)", even when its name has no leading zero.
      let n = importDates.has(entry.entry_date) ? 2 : 1;
      while (used.has(journalExportName(entry.entry_date, n))) n++;
      entry.export_name = journalExportName(entry.entry_date, n);
      used.add(entry.export_name);
      report.named.push(entry.export_name);
      if (!dryRun)
        store.run("UPDATE journal_entries SET export_name=? WHERE id=?", entry.export_name, entry.id);
    }
  };
  // Names are recorded before any file is written: a crash in between only leaves a file to write next time.
  if (dryRun) assign();
  else store.transaction(assign);

  const current = new Set(entries.map((entry) => entry.export_name as string));
  if (!dryRun) mkdirSync(join(dir, retiredDir), { recursive: true, mode: 0o700 });
  for (const name of present.filter((name) => !current.has(name))) {
    if (!dryRun) renameSync(join(dir, name), join(dir, retiredDir, name));
    report.retired.push(name);
  }
  for (const entry of entries) {
    const name = entry.export_name as string;
    if (!present.includes(name)) {
      if (!dryRun) writeFileSync(join(dir, name), entry.body, { flag: "wx" });
      report.written.push(name);
    }
    report.files.push({ name, sha256: sha256(Buffer.from(entry.body, "utf8")) });
  }
  return report;
}

// "2026-11-05", "14:30", 1 → "05.11.26 14-30.md" (a colon is not allowed in file names); 2 → "05.11.26 14-30 (2).md".
export function ideaExportName(date: string, time: string, n = 1) {
  const [year, month, day] = date.split("-");
  return `${day}.${month}.${year.slice(2)} ${time.replace(":", "-")}${n > 1 ? ` (${n})` : ""}.md`;
}

// The same delivery as the diary, one note per idea: names are given once and recorded before the file is
// written, an existing file is never rewritten, and the note of an idea deleted in the bot moves to `.deleted/`.
export function exportIdeas(store: JournalStore, dir: string, dryRun = false): ExportReport {
  const report: ExportReport = { named: [], written: [], retired: [], files: [] };
  const present = markdownFiles(dir);
  const used = new Set([...present, ...markdownFiles(join(dir, retiredDir))]);
  for (const row of store.all("SELECT export_name FROM ideas WHERE export_name IS NOT NULL"))
    used.add(row.export_name);
  const ideas = store.all("SELECT * FROM ideas ORDER BY id");
  const assign = () => {
    for (const idea of ideas) {
      if (idea.export_name) continue;
      let n = 1;
      while (used.has(ideaExportName(idea.idea_date, idea.idea_time, n))) n++;
      idea.export_name = ideaExportName(idea.idea_date, idea.idea_time, n);
      used.add(idea.export_name);
      report.named.push(idea.export_name);
      if (!dryRun) store.run("UPDATE ideas SET export_name=? WHERE id=?", idea.export_name, idea.id);
    }
  };
  if (dryRun) assign();
  else store.transaction(assign);

  const current = new Set(ideas.map((idea) => idea.export_name as string));
  if (!dryRun) mkdirSync(join(dir, retiredDir), { recursive: true, mode: 0o700 });
  for (const name of present.filter((name) => !current.has(name))) {
    if (!dryRun) renameSync(join(dir, name), join(dir, retiredDir, name));
    report.retired.push(name);
  }
  for (const idea of ideas) {
    const name = idea.export_name as string;
    if (!present.includes(name)) {
      if (!dryRun) writeFileSync(join(dir, name), idea.body, { flag: "wx" });
      report.written.push(name);
    }
    report.files.push({ name, sha256: sha256(Buffer.from(idea.body, "utf8")) });
  }
  return report;
}
