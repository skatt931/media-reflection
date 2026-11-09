import { test } from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdirSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import {
  JournalStore,
  exportJournal,
  importJournal,
  journalExportName,
  journalFileDate,
  journalSchemaVersion,
  verifyJournal,
} from "../src/journal.ts";

function withFolder(files: Record<string, string | Buffer>, run: (dir: string, db: string) => void) {
  const root = mkdtempSync(join(tmpdir(), "journal-"));
  const dir = join(root, "Journal");
  mkdirSync(dir);
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  try {
    run(dir, join(root, "journal.sqlite"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("journal file names give dates, with or without leading zeros, and reject everything else", () => {
  assert.equal(journalFileDate("05.11.26.md"), "2026-11-05");
  assert.equal(journalFileDate("8.07.26.md"), "2026-07-08");
  assert.equal(journalFileDate("31.02.26.md"), null);
  assert.equal(journalFileDate("00.01.26.md"), null);
  assert.equal(journalFileDate("Думки про рік.md"), null);
  assert.equal(journalFileDate("05.11.2026.md"), null);
  assert.equal(journalFileDate("05.11.26.txt"), null);
});

test("journal database is created at the current schema version and reopens without changes", () => {
  withFolder({}, (_dir, db) => {
    let store = new JournalStore(db);
    store.add({ date: "2026-11-08", body: "Запис із бота", source: "bot" });
    store.close();
    store = new JournalStore(db);
    assert.equal(store.all("SELECT count(*) AS n FROM journal_entries")[0].n, 1);
    assert.equal(Number(store.all("PRAGMA user_version")[0].user_version), journalSchemaVersion);
    store.close();
  });
});

test("journal refuses a database written by a newer schema", () => {
  withFolder({}, (_dir, file) => {
    const raw = new DatabaseSync(file);
    raw.exec(`PRAGMA user_version=${journalSchemaVersion + 1}`);
    raw.close();
    assert.throws(() => new JournalStore(file), /версію/);
  });
});

test("import takes dates from names, keeps the text byte for byte and is idempotent", () => {
  const text = "---\ntags: [щоденник]\n---\n\nДень як день.\r\nДругий рядок без переведення в кінці";
  withFolder(
    { "05.11.26.md": text, "8.07.26.md": "Коротко\n", "Ідеї на рік.md": "не імпортувати", "07.11.26.md": "" },
    (dir, db) => {
      const store = new JournalStore(db);
      const first = importJournal(store, dir);
      assert.deepEqual(first.imported.sort(), ["05.11.26.md", "07.11.26.md", "8.07.26.md"]);
      assert.deepEqual(
        first.skipped.map((s) => s.name),
        ["Ідеї на рік.md"],
      );
      assert.deepEqual(
        store.imported().map((r) => [r.entry_date, r.source_name]),
        [
          ["2026-07-08", "8.07.26.md"],
          ["2026-11-05", "05.11.26.md"],
          ["2026-11-07", "07.11.26.md"],
        ],
      );
      assert.equal(store.imported().find((r) => r.source_name === "05.11.26.md")!.body, text);

      const second = importJournal(store, dir);
      assert.equal(second.imported.length, 0);
      assert.equal(second.existing.length, 3);
      assert.equal(store.all("SELECT count(*) AS n FROM journal_entries")[0].n, 3);
      store.close();
    },
  );
});

test("import does not overwrite an entry whose file changed afterwards and reports it", () => {
  withFolder({ "05.11.26.md": "Було" }, (dir, db) => {
    const store = new JournalStore(db);
    importJournal(store, dir);
    writeFileSync(join(dir, "05.11.26.md"), "Стало");
    const report = importJournal(store, dir);
    assert.deepEqual(report.changed, ["05.11.26.md"]);
    assert.equal(store.imported()[0].body, "Було");
    assert.match(verifyJournal(store, dir).problems[0], /текст відрізняється/);
    store.close();
  });
});

test("two files with the same date: the first is imported, the second is reported", () => {
  withFolder({ "08.07.26.md": "Перший", "8.07.26.md": "Другий" }, (dir, db) => {
    const store = new JournalStore(db);
    const report = importJournal(store, dir);
    assert.equal(report.imported.length, 1);
    assert.equal(report.skipped.length, 1);
    assert.match(report.skipped[0].reason, /та сама дата 2026-07-08/);
    store.close();
  });
});

test("dry run changes nothing and invalid UTF-8 is refused rather than altered", () => {
  withFolder({ "05.11.26.md": "Добре", "06.11.26.md": Buffer.from([0xff, 0xfe, 0x41]) }, (dir, db) => {
    const store = new JournalStore(db);
    const dry = importJournal(store, dir, true);
    assert.deepEqual(dry.imported, ["05.11.26.md"]);
    assert.equal(store.all("SELECT count(*) AS n FROM journal_entries")[0].n, 0);
    const real = importJournal(store, dir);
    assert.deepEqual(real.imported, ["05.11.26.md"]);
    assert.match(real.skipped[0].reason, /UTF-8/);
    store.close();
  });
});

test("verify matches count and checksums, and flags missing, extra and edited entries", () => {
  withFolder({ "05.11.26.md": "Один", "06.11.26.md": "Два" }, (dir, db) => {
    const store = new JournalStore(db);
    importJournal(store, dir);
    assert.deepEqual(verifyJournal(store, dir), { files: 2, entries: 2, problems: [] });

    store.run("UPDATE journal_entries SET entry_date='2026-11-09' WHERE source_name='05.11.26.md'");
    store.run("DELETE FROM journal_entries WHERE source_name='06.11.26.md'");
    store.add({ date: "2026-01-01", body: "Лишній", source: "import", sourceName: "01.01.26.md" });
    const problems = verifyJournal(store, dir).problems;
    assert.equal(problems.length, 3);
    assert.ok(problems.some((p) => /05.11.26.md: дата в БД/.test(p)));
    assert.ok(problems.some((p) => /06.11.26.md: немає в БД/.test(p)));
    assert.ok(problems.some((p) => /01.01.26.md: є в БД, але немає/.test(p)));
    store.close();
  });
});

test("bot entries never collide with imports and may share a date", () => {
  withFolder({ "05.11.26.md": "Імпорт" }, (dir, db) => {
    const store = new JournalStore(db);
    importJournal(store, dir);
    store.add({ date: "2026-11-05", body: "Ранок", source: "bot" });
    store.add({ date: "2026-11-05", body: "Вечір", source: "bot" });
    assert.equal(store.all("SELECT count(*) AS n FROM journal_entries")[0].n, 3);
    assert.equal(verifyJournal(store, dir).problems.length, 0);
    store.close();
  });
});

test("export writes bot entries as notes named like the imported ones, text as is", () => {
  withFolder({ "8.07.26.md": "Імпорт" }, (dir, db) => {
    const store = new JournalStore(db);
    importJournal(store, dir);
    const out = join(dir, "..", "export");
    store.add({ date: "2026-11-05", body: "Ранок\n\nДругий абзац", source: "bot" });
    store.add({ date: "2026-11-05", body: "Вечір", source: "bot" });
    store.add({ date: "2026-07-08", body: "Того ж дня, що й імпорт", source: "bot" });

    const report = exportJournal(store, out);
    assert.deepEqual(report.written, ["08.07.26 (2).md", "05.11.26.md", "05.11.26 (2).md"]);
    assert.deepEqual(
      readdirSync(out)
        .filter((n) => n.endsWith(".md"))
        .sort(),
      ["05.11.26 (2).md", "05.11.26.md", "08.07.26 (2).md"],
    );
    assert.equal(readFileSync(join(out, "05.11.26.md"), "utf8"), "Ранок\n\nДругий абзац");
    assert.equal(journalExportName("2026-01-09", 3), "09.01.26 (3).md");
    store.close();
  });
});

test("export run twice writes nothing new and never rewrites a file", () => {
  withFolder({}, (dir, db) => {
    const store = new JournalStore(db);
    store.add({ date: "2026-11-05", body: "Текст", source: "bot" });
    exportJournal(store, dir);
    writeFileSync(join(dir, "05.11.26.md"), "Змінено руками");
    const again = exportJournal(store, dir);
    assert.deepEqual(again.named, []);
    assert.deepEqual(again.written, []);
    assert.equal(readFileSync(join(dir, "05.11.26.md"), "utf8"), "Змінено руками");

    rmSync(join(dir, "05.11.26.md"));
    assert.deepEqual(exportJournal(store, dir).written, ["05.11.26.md"]);
    store.close();
  });
});

test("dry run of export names and writes nothing", () => {
  withFolder({}, (dir, db) => {
    const store = new JournalStore(db);
    store.add({ date: "2026-11-05", body: "Текст", source: "bot" });
    const out = join(dir, "export");
    assert.deepEqual(exportJournal(store, out, true).written, ["05.11.26.md"]);
    assert.equal(existsSync(out), false);
    assert.equal(store.all("SELECT export_name FROM journal_entries")[0].export_name, null);
    store.close();
  });
});

test("a deleted entry's file is retired and its name is never given to a new entry", () => {
  withFolder({}, (dir, db) => {
    const store = new JournalStore(db);
    const id = Number(store.add({ date: "2026-11-05", body: "Перший", source: "bot" }).lastInsertRowid);
    exportJournal(store, dir);
    assert.ok(store.removeBotEntry(id));
    store.add({ date: "2026-11-05", body: "Новий", source: "bot" });
    const report = exportJournal(store, dir);
    assert.deepEqual(report.retired, ["05.11.26.md"]);
    assert.deepEqual(report.written, ["05.11.26 (2).md"]);
    assert.equal(readFileSync(join(dir, ".deleted", "05.11.26.md"), "utf8"), "Перший");
    assert.deepEqual(
      report.files.map((f) => f.name),
      ["05.11.26 (2).md"],
    );
    store.close();
  });
});
