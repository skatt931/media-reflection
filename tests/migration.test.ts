import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.ts";
test("old PoC SQLite upgrades additively and preserves records and edited fields on restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "media-migration-"));
  const file = join(dir, "db.sqlite");
  try {
    const db = new DatabaseSync(file);
    db.exec(
      "CREATE TABLE items(id TEXT PRIMARY KEY,url TEXT UNIQUE,title TEXT NOT NULL,type TEXT NOT NULL,created_at TEXT NOT NULL); INSERT INTO items VALUES ('old','https://example.com','Старе','unknown','2026-11-04T00:00:00Z');",
    );
    db.close();
    let store = new Store(file);
    assert.equal(store.item("old")!.title, "Старе");
    assert.equal(store.item("old")!.status, "saved");
    store.patch("old", { creator: "Автор", tags: ["тег"], consumed_on: "2026-11-03" });
    store.setContext({ mode: "edit", id: "old", field: "title" });
    store.close();
    store = new Store(file);
    assert.deepEqual(store.item("old")!.tags, ["тег"]);
    assert.equal(store.context().field, "title");
    assert.equal(store.snapshot().schema_version, 3);
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
test("legacy manually edited and cleared fields stay protected from new automatic enrichment", () => {
  const dir = mkdtempSync(join(tmpdir(), "media-legacy-"));
  const file = join(dir, "db.sqlite");
  try {
    const db = new DatabaseSync(file);
    db.exec(
      "CREATE TABLE items(id TEXT PRIMARY KEY,url TEXT UNIQUE,title TEXT NOT NULL,type TEXT NOT NULL,created_at TEXT NOT NULL,details TEXT NOT NULL); INSERT INTO items VALUES ('old','https://example.com','Моя назва','book','2026-11-04T00:00:00Z','{\"creator\":\"Мій автор\",\"tags\":[],\"summary\":null,\"manual_type\":true}');",
    );
    db.close();
    const store = new Store(file);
    store.applyAI("old", {
      question: null,
      type: "video",
      title: "Інше",
      creator: "Інший",
      tags: ["тег"],
      summary: "Опис",
    });
    const item = store.item("old")!;
    assert.equal(item.title, "Моя назва");
    assert.equal(item.creator, "Мій автор");
    assert.deepEqual(item.tags, []);
    assert.equal(item.summary, null);
    assert.equal(item.type, "book");
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
