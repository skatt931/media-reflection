import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { JournalStore, exportIdeas, exportJournal, journalSchemaVersion } from "../src/journal.ts";
import { Store } from "../src/store.ts";
import { MINIAPP_HOST, startMiniApp } from "../src/miniapp/server.ts";
import { addDiaryEntry, addIdea, addImpression, editItem } from "../src/miniapp/write.ts";

const TOKEN = "123456:test-token";
const OWNER = 42;
const NOW = new Date("2026-11-09T12:00:00Z");
const at = (date: string) => new Date(`${date}T12:00:00Z`);

function sign(fields: Record<string, string>) {
  const text = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  const hash = createHmac("sha256", secret).update(text).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}
const headers = {
  authorization: `tma ${sign({
    auth_date: String(Math.floor(NOW.getTime() / 1000) - 60),
    user: JSON.stringify({ id: OWNER }),
  })}`,
  "content-type": "application/json",
};

let dir: string;
let store: Store;
let journal: JournalStore;
let base: string;
let close: () => void;
let article: string;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "write-"));
  store = new Store(":memory:");
  journal = new JournalStore(":memory:");
  article = store.capture(1, "https://longreads.example/pause", at("2026-11-08"));
  store.patch(article, { title: "Повільний дизайн", type: "article", creator: "Марта", tags: ["дизайн"] });
  const server = await startMiniApp(
    { token: TOKEN, owner: OWNER, store, journal, now: () => NOW, staticDir: dir },
    0,
  );
  assert.ok(server);
  base = `http://${MINIAPP_HOST}:${(server.address() as AddressInfo).port}`;
  close = () => {
    server.closeAllConnections();
    server.close();
  };
});

test("ideas: only a resolved idea can be deleted, and its note leaves the export", async () => {
  const made = await call("POST", "/api/ideas", { body: "Випадково додана ідея" });
  const id = made.body.id;
  const out = join(dir, "ideas-delete");
  exportIdeas(journal, out);
  assert.equal(readdirSync(out).filter((n) => n.endsWith(".md")).length >= 1, true);

  // A live idea is refused: the slip has to go through «вирішено» first.
  assert.equal((await call("POST", `/api/ideas/${id}/delete`)).status, 400);
  assert.ok(journal.idea(id));
  assert.equal((await call("GET", `/api/ideas/${id}/delete`)).status, 405);

  assert.equal((await call("POST", `/api/ideas/${id}/resolve`)).status, 200);
  assert.equal((await call("POST", `/api/ideas/${id}/delete`)).status, 200);
  assert.equal(journal.idea(id), undefined);
  const list = (await call("GET", "/api/ideas")).body;
  assert.ok(![...list.ideas, ...list.resolved].some((i: { id: number }) => i.id === id));
  assert.equal((await call("POST", `/api/ideas/${id}/delete`)).status, 404);
  assert.equal((await call("POST", "/api/ideas/9999/delete")).status, 404);

  // The file written earlier moves to `.deleted/`, as for an idea deleted in the bot.
  const report = exportIdeas(journal, out);
  assert.equal(report.retired.length, 1);
});

after(() => {
  close();
  store.close();
  journal.close();
  rmSync(dir, { recursive: true, force: true });
});

async function call(method: string, path: string, body?: unknown, h: Record<string, string> = headers) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: h,
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json().catch(() => null) };
}

test("writes need the owner's initData, like reads", async () => {
  const { authorization: _a, ...anonymous } = headers;
  for (const [method, path] of [
    ["POST", "/api/diary"],
    ["POST", "/api/ideas"],
    ["POST", "/api/ideas/1/resolve"],
    ["POST", "/api/ideas/1/delete"],
    ["PATCH", `/api/library/${article}`],
    ["POST", `/api/library/${article}/impressions`],
  ])
    assert.equal((await call(method, path, { body: "x", date: "2026-11-09" }, anonymous)).status, 401, path);
  assert.equal(journal.all("SELECT id FROM journal_entries").length, 0);
});

test("bodies: JSON only, bounded, well formed", async () => {
  assert.equal(
    (await call("POST", "/api/ideas", "body=x", { ...headers, "content-type": "text/plain" })).status,
    415,
  );
  assert.equal((await call("POST", "/api/ideas", "{not json")).status, 400);
  assert.equal((await call("POST", "/api/ideas", "[]")).status, 400);
  assert.equal(
    (await call("POST", "/api/diary", { date: "2026-11-09", body: "я".repeat(600_000) })).status,
    413,
  );
  assert.equal(journal.ideaCount(), 0);
});

test("diary: a new entry is written like the bot's and goes to Obsidian with the next copy", async () => {
  const created = await call("POST", "/api/diary", {
    date: "2026-11-05",
    body: "  Перший запис з Mini App.\r\n\r\nДруга частина.  ",
  });
  assert.equal(created.status, 201);
  const row = journal.entry(created.body.id);
  assert.equal(row.source, "bot");
  assert.equal(row.entry_date, "2026-11-05");
  assert.equal(row.body, "Перший запис з Mini App.\n\nДруга частина.");

  const list = await call("GET", "/api/diary");
  assert.deepEqual(
    list.body.entries.map((e: { id: number }) => e.id),
    [created.body.id],
  );
  const out = join(dir, "vault");
  exportJournal(journal, out);
  assert.deepEqual(
    readdirSync(out).filter((n) => n.endsWith(".md")),
    ["05.11.26.md"],
  );
  assert.equal(readFileSync(join(out, "05.11.26.md"), "utf8"), row.body);
});

test("diary: refusals name the field; a repeat within two minutes writes nothing new", async () => {
  const refused = async (body: unknown) => (await call("POST", "/api/diary", body)).body.error;
  assert.equal(await refused({ date: "2026-11-09" }), "body");
  assert.equal(await refused({ date: "2026-11-09", body: "   " }), "body");
  assert.equal(await refused({ date: "2026-11-09", body: 5 }), "body");
  assert.equal(await refused({ body: "x" }), "date");
  assert.equal(await refused({ date: "2026-02-30", body: "x" }), "date");
  assert.equal(await refused({ date: "10.11.2026", body: "x" }), "date");
  // Tomorrow (in the owner's time zone) is not written yet.
  assert.equal(await refused({ date: "2026-11-11", body: "x" }), "date");

  const before = journal.all("SELECT id FROM journal_entries").length;
  const first = await call("POST", "/api/diary", { date: "2026-11-09", body: "Двічі натиснув." });
  const second = await call("POST", "/api/diary", { date: "2026-11-09", body: "Двічі натиснув." });
  assert.equal(first.body.id, second.body.id);
  assert.equal(journal.all("SELECT id FROM journal_entries").length, before + 1);
  // The same text for another day is another entry.
  const other = await call("POST", "/api/diary", { date: "2026-11-08", body: "Двічі натиснув." });
  assert.notEqual(other.body.id, first.body.id);
});

test("ideas: add, resolve, restore; nothing is deleted and the export keeps resolved ones", async () => {
  const made = await call("POST", "/api/ideas", { body: "  Спробувати новий маршрут  " });
  assert.equal(made.status, 201);
  const idea = journal.idea(made.body.id);
  assert.equal(idea.body, "Спробувати новий маршрут");
  assert.equal(idea.source, "text");
  assert.equal(idea.idea_date, "2026-11-09");
  assert.equal(idea.resolved_at, null);
  assert.equal(
    (await call("POST", "/api/ideas", { body: "Спробувати новий маршрут" })).body.id,
    made.body.id,
  );
  assert.equal((await call("POST", "/api/ideas", { body: "" })).status, 400);

  const second = await call("POST", "/api/ideas", { body: "Друга ідея" });
  assert.equal((await call("POST", `/api/ideas/${made.body.id}/resolve`)).status, 200);
  let list = (await call("GET", "/api/ideas")).body;
  assert.deepEqual(
    list.ideas.map((i: { id: number }) => i.id),
    [second.body.id],
  );
  assert.deepEqual(
    list.resolved.map((i: { id: number }) => i.id),
    [made.body.id],
  );

  // The most recently resolved comes first among the resolved.
  assert.equal((await call("POST", `/api/ideas/${second.body.id}/resolve`)).status, 200);
  journal.run("UPDATE ideas SET resolved_at='2030-01-01T00:00:00.000Z' WHERE id=?", second.body.id);
  list = (await call("GET", "/api/ideas")).body;
  assert.deepEqual(
    list.resolved.map((i: { id: number }) => i.id),
    [second.body.id, made.body.id],
  );
  assert.deepEqual(list.ideas, []);

  // Resolved ideas are searched too, in their own list.
  const found = (await call("GET", `/api/ideas?q=${encodeURIComponent("маршруту")}`)).body;
  assert.deepEqual(
    found.resolved.map((i: { id: number }) => i.id),
    [made.body.id],
  );

  const out = join(dir, "ideas");
  assert.equal(exportIdeas(journal, out).files.length, journal.ideaCount());

  assert.equal((await call("POST", `/api/ideas/${made.body.id}/restore`)).status, 200);
  assert.equal(journal.idea(made.body.id).resolved_at, null);
  assert.equal((await call("POST", "/api/ideas/9999/resolve")).status, 404);
  assert.equal((await call("GET", `/api/ideas/${made.body.id}/resolve`)).status, 405);
});

test("library: type, state, reaction and tags are edited through the bot's own edit, and are locked from the AI", async () => {
  const id = encodeURIComponent(article);
  const tagged = await call("PATCH", `/api/library/${id}`, {
    tags: ["Дизайн", "повільний дизайн", "дизайн", "  "],
  });
  assert.equal(tagged.status, 200);
  assert.deepEqual(tagged.body.tags, ["дизайн", "повільний дизайн"]);

  const typed = await call("PATCH", `/api/library/${id}`, { type: "podcast" });
  assert.equal(typed.body.type, "podcast");
  const reacted = await call("PATCH", `/api/library/${id}`, { reaction: "loved" });
  assert.equal(reacted.body.reaction, "loved");
  assert.equal((await call("PATCH", `/api/library/${id}`, { reaction: null })).body.reaction, null);

  // What was set by hand is locked: an AI answer changes the rest only.
  store.applyAI(article, {
    type: "video",
    tags: ["ai-тег"],
    summary: "AI-опис",
    title: null,
    creator: null,
    entities: [],
  } as any);
  const item = store.item(article)!;
  assert.equal(item.type, "podcast");
  assert.deepEqual(item.tags, ["дизайн", "повільний дизайн"]);
  assert.equal(item.summary, "AI-опис");
  // Changes of type and reaction are logged for analytics, as in the bot.
  assert.deepEqual(
    store
      .all("SELECT field, old, new FROM events WHERE item_id=? ORDER BY id", article)
      .map((e) => [e.field, e.old, e.new]),
    [
      ["type", "article", "podcast"],
      ["reaction", null, "loved"],
      ["reaction", "loved", null],
    ],
  );
  assert.equal(Object.hasOwn(tagged.body, "manual_fields"), false);
});

test("library: state keeps its date the way the bot does", async () => {
  const id = store.capture(20, "https://game.example/quiet", at("2026-10-03"));
  store.patch(id, { title: "Тиха гавань", type: "game" });
  const path = `/api/library/${encodeURIComponent(id)}`;
  assert.equal(store.item(id)!.status, "consumed");

  const later = await call("PATCH", path, { status: "saved" });
  assert.equal(later.body.status, "saved");
  assert.equal(store.item(id)!.consumed_on, null);

  // Back to «Ознайомився» with no date yet: today.
  assert.equal((await call("PATCH", path, { status: "consumed" })).body.date, "2026-11-09");
  assert.equal(store.item(id)!.consumed_on, "2026-11-09");
  // A date already there stays when the state changes again.
  store.patch(id, { consumed_on: "2026-10-03" });
  assert.equal((await call("PATCH", path, { status: "finished" })).body.date, "2026-10-03");
  assert.equal((await call("PATCH", path, { status: "in_progress" })).body.status, "in_progress");
});

test("library: a reaction answers the reflection prompt, an impression leaves «Без вражень»", async () => {
  const one = store.capture(30, "https://a.example/x", at("2026-11-01"));
  const two = store.capture(31, "https://b.example/y", at("2026-11-01"));
  for (const id of [one, two]) store.link(Number(id.slice(0, 4).replace(/\D/g, "")) + 500, id);
  const unreviewed = () => store.unreflected("2026-11-09").map((i) => i.id);
  assert.ok(unreviewed().includes(one) && unreviewed().includes(two));

  await call("PATCH", `/api/library/${encodeURIComponent(one)}`, { reaction: "positive" });
  assert.ok(!unreviewed().includes(one));

  const note = await call("POST", `/api/library/${encodeURIComponent(two)}/impressions`, {
    body: " Читав у поїзді. ",
  });
  assert.equal(note.status, 200);
  assert.deepEqual(
    note.body.impressions.map((n: { body: string }) => n.body),
    ["Читав у поїзді."],
  );
  assert.ok(!unreviewed().includes(two));
  // The id never meets a Telegram update id, and a repeat adds nothing.
  assert.ok(
    store.all("SELECT update_id FROM reflections WHERE item_id=?", two).every((r) => r.update_id < 0),
  );
  await call("POST", `/api/library/${encodeURIComponent(two)}/impressions`, { body: "Читав у поїзді." });
  assert.equal(store.reflections(two).length, 1);
  // A second, different note keeps both, oldest first.
  await call("POST", `/api/library/${encodeURIComponent(two)}/impressions`, { body: "Ще раз про це." });
  assert.equal(store.reflections(two).length, 2);
});

test("library: refusals", async () => {
  const path = `/api/library/${encodeURIComponent(article)}`;
  const refused = async (body: unknown) => (await call("PATCH", path, body)).body.error;
  assert.equal(await refused({ type: "nonsense" }), "type");
  assert.equal(await refused({ type: null }), "type");
  assert.equal(await refused({ status: "gone" }), "status");
  assert.equal(await refused({ reaction: "meh" }), "reaction");
  assert.equal(await refused({ tags: "a,b" }), "tags");
  assert.equal(await refused({ tags: [1] }), "tags");
  assert.equal(await refused({ tags: Array.from({ length: 21 }, (_, i) => `тег${i}`) }), "tags");
  assert.equal(await refused({}), "empty");
  // Fields the screens may not change are not changed, whatever the body says.
  const before = store.item(article)!;
  assert.equal((await call("PATCH", path, { title: "Інша назва", url: "https://evil.example" })).status, 400);
  assert.equal(store.item(article)!.title, before.title);
  assert.equal(store.item(article)!.url, before.url);

  assert.equal((await call("PATCH", "/api/library/nope", { type: "film" })).status, 404);
  assert.equal((await call("POST", "/api/library/nope/impressions", { body: "x" })).status, 404);
  assert.equal((await call("POST", path, { body: "x" })).status, 405);
  assert.equal((await call("PATCH", `${path}/cover`, {})).status, 405);
  assert.equal((await call("POST", "/api/library", {})).status, 405);
  assert.equal((await call("POST", `${path}/impressions`, { body: "" })).body.error, "body");
  assert.equal((await call("POST", `${path}/impressions`, { body: "я".repeat(4001) })).body.error, "body");
});

test("write functions can be called without the server", () => {
  const j = new JournalStore(":memory:");
  assert.deepEqual(addDiaryEntry(j, { date: "2026-11-09", body: "x" }, NOW).ok, true);
  assert.equal(addIdea(j, { body: "y" }, NOW).ok, true);
  assert.equal(editItem(new Store(":memory:"), "missing", { type: "film" }).ok, false);
  assert.equal(addImpression(new Store(":memory:"), "missing", { body: "z" }).ok, false);
  j.close();
});

test("the ideas table gets resolved_at without touching the ideas already there", () => {
  const folder = mkdtempSync(join(tmpdir(), "resolved-"));
  try {
    const path = join(folder, "journal.sqlite");
    const old = new JournalStore(path);
    old.addIdea({ body: "Стара ідея", source: "text", date: "2026-11-05", time: "10:00" });
    old.db.exec("ALTER TABLE ideas DROP COLUMN resolved_at; PRAGMA user_version=4");
    old.close();
    const next = new JournalStore(path);
    assert.equal(Number(next.all("PRAGMA user_version")[0].user_version), journalSchemaVersion);
    assert.equal(next.all("SELECT body, resolved_at FROM ideas")[0].body, "Стара ідея");
    assert.equal(next.all("SELECT resolved_at FROM ideas")[0].resolved_at, null);
    next.close();
    new DatabaseSync(path).close();
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
});
