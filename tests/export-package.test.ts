import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { Store } from "../src/store.ts";
import { JournalStore } from "../src/journal.ts";
import { buildExport } from "../src/export-package.ts";
import { handle } from "../src/bot.ts";
import { zip } from "../src/zip.ts";

// Reads the central directory, so it checks the archive the way an unpacking tool would.
function unzip(archive: Buffer) {
  const end = archive.lastIndexOf("PK\x05\x06");
  const count = archive.readUInt16LE(end + 10);
  let at = archive.readUInt32LE(end + 16);
  const files = new Map<string, Buffer>();
  for (let i = 0; i < count; i++) {
    const nameLength = archive.readUInt16LE(at + 28);
    const size = archive.readUInt32LE(at + 20);
    const local = archive.readUInt32LE(at + 42);
    const name = archive.subarray(at + 46, at + 46 + nameLength).toString("utf8");
    const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
    const data = inflateRawSync(archive.subarray(start, start + archive.readUInt32LE(at + 20)));
    assert.equal(data.length, archive.readUInt32LE(at + 24));
    files.set(name, data);
    assert.ok(size >= 0);
    at += 46 + nameLength + archive.readUInt16LE(at + 30) + archive.readUInt16LE(at + 32);
  }
  return files;
}
test("zip round-trips names and bytes", () => {
  const files = unzip(
    zip([
      { name: "Медіатека/Матеріали/а.md", data: "# Привіт" },
      { name: "b.bin", data: Buffer.alloc(5000, 7) },
    ]),
  );
  assert.equal(files.get("Медіатека/Матеріали/а.md")!.toString(), "# Привіт");
  assert.equal(files.get("b.bin")!.length, 5000);
});
test("only new notes are sent, and only once", () => {
  const s = new Store(":memory:");
  const a = s.capture(1, "https://example.com/a");
  s.edit(a, { title: "Перша" });
  const first = buildExport(s);
  assert.equal(first.notes, 1);
  const files = unzip(first.zip!);
  assert.deepEqual([...files.keys()], [`Медіатека/Матеріали/Перша — ${a}.md`]);
  assert.match(files.get(`Медіатека/Матеріали/Перша — ${a}.md`)!.toString(), /media-reflection:personal/);
  // Not delivered until committed: the next attempt sends it again.
  assert.equal(buildExport(s).notes, 1);
  first.commit();
  assert.equal(buildExport(s).zip, null);
  const b = s.capture(2, "https://example.com/b");
  const second = buildExport(s);
  assert.equal(second.notes, 1);
  assert.deepEqual([...unzip(second.zip!).keys()].length, 1);
  assert.ok(!second.zip!.includes(Buffer.from(a)));
  s.close();
  assert.ok(b);
});
test("a note changed after export is recorded, not sent again", () => {
  const s = new Store(":memory:");
  const id = s.capture(1, "https://example.com/a");
  s.edit(id, { title: "Стара назва" });
  buildExport(s).commit();
  s.edit(id, { title: "Нова назва" });
  const next = buildExport(s);
  assert.equal(next.zip, null);
  assert.deepEqual(next.changed, ["Нова назва"]);
  buildExport(s);
  // The same change is recorded once; a further change adds a row.
  assert.equal(s.all("SELECT * FROM export_changes WHERE kind='changed'").length, 1);
  s.edit(id, { title: "Ще одна" });
  buildExport(s);
  assert.equal(s.all("SELECT * FROM export_changes WHERE kind='changed'").length, 2);
  s.close();
});
test("a deleted item is recorded with its title", () => {
  const s = new Store(":memory:");
  const id = s.capture(1, "https://example.com/a");
  s.edit(id, { title: "Видалю" });
  buildExport(s).commit();
  s.deleteItem(id);
  const next = buildExport(s);
  assert.deepEqual(next.deleted, ["Видалю"]);
  assert.equal(s.all("SELECT title FROM export_changes WHERE kind='deleted'")[0].title, "Видалю");
  s.close();
});
test("notes from the earlier vault export count as delivered", () => {
  const dir = mkdtempSync(join(tmpdir(), "export-seed-"));
  try {
    const path = join(dir, "media.sqlite");
    let s = new Store(path);
    const old = s.capture(1, "https://example.com/old");
    s.edit(old, { title: "Давня" });
    s.run(
      "INSERT INTO vault_exports VALUES (?,?,?,?)",
      "/vault",
      old,
      `Медіатека/Матеріали/Давня — ${old}.md`,
      "x",
    );
    s.run(
      "INSERT INTO vault_exports VALUES (?,?,?,?)",
      "/vault",
      "__overview__",
      "Медіатека/Медіатека.md",
      "y",
    );
    s.close();
    s = new Store(path);
    const fresh = s.capture(2, "https://example.com/new");
    const pkg = buildExport(s);
    assert.equal(pkg.notes, 1);
    assert.ok(!pkg.zip!.includes(Buffer.from(old)));
    assert.ok(fresh);
    assert.deepEqual(pkg.changed, ["Давня"]);
    assert.equal(s.all("SELECT * FROM export_notes WHERE item_id='__overview__'").length, 0);
    s.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("covers are sent once with their note", () => {
  const dir = mkdtempSync(join(tmpdir(), "export-cover-"));
  try {
    const s = new Store(join(dir, "media.sqlite"));
    const id = s.capture(1, "https://example.com/a");
    mkdirSync(join(dir, "covers"), { recursive: true });
    writeFileSync(join(dir, "covers", `${id}.jpg`), Buffer.from([1, 2, 3]));
    s.patch(id, { cover: `${id}.jpg` });
    const first = buildExport(s);
    assert.equal(first.covers, 1);
    assert.deepEqual(unzip(first.zip!).get(`Медіатека/Обкладинки/${id}.jpg`), Buffer.from([1, 2, 3]));
    first.commit();
    assert.equal(buildExport(s).zip, null);
    s.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("the bot commits an export only after the file is sent", async () => {
  const s = new Store(":memory:");
  const id = s.capture(1, "https://example.com/a");
  s.edit(id, { title: "Нотатка" });
  const msg = (n: number, text: string) => ({
    update_id: n,
    message: { message_id: n, from: { id: 42 }, chat: { id: 42, type: "private" }, text },
  });
  const sent: any[] = [];
  const failing = async (_t: string, _k?: any, out?: any) => {
    if (out?.document) throw new Error("Telegram sendDocument: code 500");
    sent.push(_t);
    return 1;
  };
  await handle(s, msg(1, "Експорт"), 42, failing);
  assert.match(sent.at(-1), /Експорт не вдався/);
  assert.equal(s.all("SELECT * FROM export_notes").length, 0);
  const documents: any[] = [];
  const working = async (t: string, _k?: any, out?: any) => {
    if (out?.document) documents.push({ t, name: out.document.name });
    sent.push(t);
    return 1;
  };
  await handle(s, msg(2, "Експорт"), 42, working);
  assert.equal(documents.length, 1);
  assert.match(documents[0].t, /нотаток 1/);
  assert.equal(s.all("SELECT * FROM export_notes").length, 1);
  await handle(s, msg(3, "Експорт"), 42, working);
  assert.match(sent.at(-1), /Нових записів для експорту немає/);
  s.close();
});

test("new diary entries and ideas go into the same archive, once, and imported ones never", () => {
  const dir = mkdtempSync(join(tmpdir(), "export-journal-"));
  try {
    const s = new Store(":memory:");
    const journal = new JournalStore(":memory:");
    const options = { journal, journalDir: join(dir, "diary"), ideasDir: join(dir, "ideas") };
    journal.add({ date: "2026-11-01", body: "Давній запис", source: "import", sourceName: "01.11.26.md" });
    journal.add({ date: "2026-11-09", body: "Вчорашній запис", source: "bot" });
    journal.addIdea({ body: "Ідея", source: "text", date: "2026-11-09", time: "14:30" });
    const first = buildExport(s, options);
    assert.equal(first.diary, 1);
    assert.equal(first.ideas, 1);
    const files = unzip(first.zip!);
    assert.equal(files.get("Journal/09.11.26.md")!.toString(), "Вчорашній запис");
    assert.equal(files.get("Journal/Ideas/Inbox/09.11.26 14-30.md")!.toString(), "Ідея");
    assert.equal(files.size, 2);
    // Not delivered until committed.
    assert.equal(buildExport(s, options).diary, 1);
    first.commit();
    assert.equal(buildExport(s, options).zip, null);
    // The folders `journal:pull` reads now hold the files too, so it will not take them twice.
    assert.ok(readdirSync(join(dir, "diary")).includes("09.11.26.md"));
    journal.add({ date: "2026-11-09", body: "Другий за день", source: "bot" });
    assert.ok(unzip(buildExport(s, options).zip!).has("Journal/09.11.26 (2).md"));
    s.close();
    journal.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
