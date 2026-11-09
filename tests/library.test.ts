import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.ts";
import { MINIAPP_HOST, startMiniApp } from "../src/miniapp/server.ts";

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
};

let dir: string;
let store: Store;
let base: string;
let close: () => void;
const ids: Record<string, string> = {};

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "library-"));
  store = new Store(join(dir, "media.sqlite"));
  let n = 0;
  const add = (key: string, date: string, url: string, patch: Record<string, unknown> = {}) => {
    ids[key] = store.capture(++n, url, at(date));
    store.patch(ids[key], patch);
    store.fitStatusToType(ids[key]);
  };
  add("article", "2026-11-08", "https://longreads.example/pause", {
    title: "Повільний дизайн",
    type: "article",
    creator: "Марта Кравець",
    tags: ["дизайн", "інтерфейси", "повільний дизайн", "четвертий"],
    summary: "Есей про паузи.",
    reaction: "positive",
    cover: "article.jpg",
    manual_fields: ["secret"],
  });
  add("podcast", "2026-11-06", "https://pod.example/42", {
    title: "Епізод 42",
    type: "podcast",
    reaction: "loved",
  });
  add("game", "2026-10-03", "https://game.example/quiet", { title: "Тиха гавань", type: "game" });
  add("later", "2026-10-20", "https://later.example/read", {
    title: "Прочитати пізніше",
    type: "article",
    status: "saved",
  });
  add("resource", "2026-09-01", "https://tools.example", {
    title: "Галерея екранів",
    type: "resource",
    status: null,
  });
  store.addReflection(100, ids.article, "Найкраща думка: пауза — частина інтерфейсу.", at("2026-11-08"));
  store.addReflection(101, ids.article, "Перечитав увечері.", at("2026-11-09"));
  store.addReflection(102, ids.podcast, "Слухав у дорозі.", at("2026-11-06"));
  mkdirSync(join(dir, "covers"), { recursive: true });
  writeFileSync(join(dir, "covers/article.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));

  const server = await startMiniApp({ token: TOKEN, owner: OWNER, store, now: () => NOW, staticDir: dir }, 0);
  assert.ok(server);
  base = `http://${MINIAPP_HOST}:${(server.address() as AddressInfo).port}`;
  close = () => {
    server.closeAllConnections();
    server.close();
  };
});

after(() => {
  close();
  store.close();
  rmSync(dir, { recursive: true, force: true });
});

const get = async (path: string, init: RequestInit = { headers }) => fetch(`${base}${path}`, init);
const list = async (query = "") => (await get(`/api/library${query}`)).json() as Promise<any>;
const titles = (body: any) => body.items.map((i: any) => i.title);

test("library: no answer without initData", async () => {
  for (const path of ["/api/library", `/api/library/${ids.article}`, `/api/library/${ids.article}/cover`])
    assert.equal((await get(path, {})).status, 401, path);
});

test("library: cards by date, newest first, with the fields the screens need", async () => {
  const body = await list();
  assert.deepEqual(titles(body), [
    "Повільний дизайн",
    "Епізод 42",
    "Прочитати пізніше",
    "Тиха гавань",
    "Галерея екранів",
  ]);
  assert.equal(body.total, 5);
  const [article] = body.items;
  assert.equal(article.id, ids.article);
  assert.equal(article.creator, "Марта Кравець");
  assert.equal(article.source, "longreads.example");
  assert.equal(article.date, "2026-11-08");
  assert.equal(article.reaction, "positive");
  assert.equal(article.cover, true);
  assert.deepEqual(article.tags, ["дизайн", "інтерфейси", "повільний дизайн"]);
  assert.equal(body.items[1].cover, false);
  assert.equal(body.labels.types.article, "Стаття");
  assert.equal(body.labels.reactions.loved, "Улюблене");
});

test("library: only the fields of the screens leave the server", async () => {
  const [article] = (await list()).items;
  assert.ok(!("manual_fields" in article) && !("details" in article) && !("url" in article));
  const detail = await (await get(`/api/library/${ids.article}`)).json();
  assert.ok(!("manual_fields" in detail) && !("cover_file" in detail));
  assert.equal(detail.url, "https://longreads.example/pause");
});

test("library: counts describe the whole library, whatever the filter", async () => {
  const { counts } = await list("?type=game");
  assert.equal(counts.saved, 1);
  assert.deepEqual(counts.types, { article: 2, podcast: 1, game: 1, resource: 1 });
  // «Без вражень» is the bot's own set: seen, no note yet, not «На потім», not a resource.
  assert.equal(counts.unreviewed, 1);
});

test("library: filters by type, state and reaction", async () => {
  assert.deepEqual(titles(await list("?type=game,podcast")), ["Епізод 42", "Тиха гавань"]);
  assert.deepEqual(titles(await list("?status=saved")), ["Прочитати пізніше"]);
  assert.deepEqual(titles(await list("?reaction=loved,positive")), ["Повільний дизайн", "Епізод 42"]);
  assert.deepEqual(titles(await list("?reaction=none")), [
    "Прочитати пізніше",
    "Тиха гавань",
    "Галерея екранів",
  ]);
  assert.deepEqual(titles(await list("?type=article&reaction=positive")), ["Повільний дизайн"]);
  assert.deepEqual(titles(await list("?type=nothing")), []);
});

test("library: «Без вражень» matches the bot", async () => {
  assert.deepEqual(titles(await list("?unreviewed=1")), ["Тиха гавань"]);
  assert.deepEqual(titles(await list("?unreviewed=1&type=podcast")), []);
});

test("library: «Без думки» keeps what has no thought, whatever the reaction and type", async () => {
  // Seen, no written thought: the game and the resource. «На потім» is not seen yet, the others have notes.
  assert.deepEqual(titles(await list("?nothought=1")), ["Тиха гавань", "Галерея екранів"]);
  assert.equal((await list()).counts.noThought, 2);
  assert.deepEqual(titles(await list("?nothought=1&type=resource")), ["Галерея екранів"]);

  // A reaction alone does not take an item out of «Без думки» (it does out of «Без вражень»).
  store.patch(ids.resource, { reaction: "positive" });
  store.patch(ids.game, { reaction: "loved" });
  try {
    assert.deepEqual(titles(await list("?nothought=1")), ["Тиха гавань", "Галерея екранів"]);
    const cards = (await list()).items;
    const flag = (title: string) => cards.find((c: any) => c.title === title).noThought;
    assert.equal(flag("Тиха гавань"), true);
    assert.equal(flag("Галерея екранів"), true);
    assert.equal(flag("Повільний дизайн"), false);
    assert.equal(flag("Прочитати пізніше"), false);
    // A thought takes it out.
    store.addReflection(103, ids.game, "Заграв до ночі.", at("2026-11-09"));
    assert.deepEqual(titles(await list("?nothought=1")), ["Галерея екранів"]);
    assert.equal((await list()).counts.noThought, 1);
  } finally {
    store.patch(ids.resource, { reaction: null });
    store.patch(ids.game, { reaction: null });
    store.run("DELETE FROM reflections WHERE item_id=?", ids.game);
  }
});

test("library: search ignores endings and looks in notes", async () => {
  assert.deepEqual(titles(await list("?q=" + encodeURIComponent("повільного дизайну"))), [
    "Повільний дизайн",
  ]);
  assert.deepEqual(titles(await list("?q=" + encodeURIComponent("перечитав"))), ["Повільний дизайн"]);
  assert.deepEqual(titles(await list("?q=" + encodeURIComponent("слухав"))), ["Епізод 42"]);
  assert.deepEqual(titles(await list("?q=" + encodeURIComponent("щось інше"))), []);
  // Search and filters combine.
  assert.deepEqual(titles(await list("?q=" + encodeURIComponent("дизайн") + "&type=game")), []);
});

test("library: details with every impression", async () => {
  const response = await get(`/api/library/${ids.article}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const item = await response.json();
  assert.equal(item.title, "Повільний дизайн");
  assert.equal(item.summary, "Есей про паузи.");
  assert.deepEqual(item.tags, ["дизайн", "інтерфейси", "повільний дизайн", "четвертий"]);
  assert.deepEqual(item.impressions, [
    { date: "2026-11-08", body: "Найкраща думка: пауза — частина інтерфейсу." },
    { date: "2026-11-09", body: "Перечитав увечері." },
  ]);
  const bare = await (await get(`/api/library/${ids.game}`)).json();
  assert.deepEqual(bare.impressions, []);
});

test("library: unknown or malformed ids are 404", async () => {
  for (const id of ["nope", "%E0%A4%A", "..%2F..%2Fmedia.sqlite", "a/b"])
    assert.equal((await get(`/api/library/${id}`)).status, 404, id);
  assert.equal((await get("/api/library/nope/cover")).status, 404);
});

test("library: local cover is served, no cover is 404", async () => {
  const cover = await get(`/api/library/${ids.article}/cover`);
  assert.equal(cover.status, 200);
  assert.equal(cover.headers.get("content-type"), "image/jpeg");
  assert.match(cover.headers.get("cache-control") ?? "", /private/);
  assert.deepEqual([...new Uint8Array(await cover.arrayBuffer())], [0xff, 0xd8, 0xff, 0xd9]);
  assert.equal((await get(`/api/library/${ids.podcast}/cover`)).status, 404);
});

test("library: read-only, and a cover name cannot leave the covers folder", async () => {
  assert.equal((await get("/api/library", { method: "POST", headers })).status, 405);
  store.patch(ids.game, { cover: "../media.sqlite" });
  assert.equal((await get(`/api/library/${ids.game}/cover`)).status, 404);
  assert.equal((await list()).items.find((i: any) => i.id === ids.game).cover, false);
});
