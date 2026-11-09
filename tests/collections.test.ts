import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import {
  addToCollection,
  collectionRows,
  collectionsOf,
  createCollection,
  memberIds,
  namesOf,
} from "../src/collections.ts";
import { handle } from "../src/bot.ts";
import { Store } from "../src/store.ts";
import { MINIAPP_HOST, startMiniApp } from "../src/miniapp/server.ts";

const TOKEN = "123456:test-token";
const OWNER = 42;
const NOW = new Date("2026-11-09T12:00:00Z");

function auth() {
  const fields = {
    auth_date: String(Math.floor(NOW.getTime() / 1000) - 60),
    user: JSON.stringify({ id: OWNER }),
  };
  const text = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const hash = createHmac("sha256", createHmac("sha256", "WebAppData").update(TOKEN).digest())
    .update(text)
    .digest("hex");
  return `tma ${new URLSearchParams({ ...fields, hash }).toString()}`;
}

function library() {
  const s = new Store(":memory:");
  const ids = ["a", "b", "c"].map((name, i) => {
    const id = s.capture(i + 1, `https://example.com/${name}`, new Date(`2026-11-0${i + 1}T10:00:00Z`));
    s.patch(id, { title: `Матеріал ${name}` });
    return id;
  });
  return { s, ids };
}

test("collections: names are trimmed, unique without regard to case, and bounded", () => {
  const { s } = library();
  assert.equal(createCollection(s, "   ").ok, false);
  assert.equal(createCollection(s, "x".repeat(61)).ok, false);
  assert.equal(createCollection(s, 5).ok, false);
  const made = createCollection(s, "  Дизайн   мого застосунку ");
  assert.ok(made.ok);
  assert.equal(collectionRows(s)[0].name, "Дизайн мого застосунку");
  assert.deepEqual(createCollection(s, "дизайн мого ЗАСТОСУНКУ"), { ok: false, error: "exists" });
});

test("collections: adding twice changes nothing, the newest addition comes first, deleting a material empties its place", () => {
  const { s, ids } = library();
  const made = createCollection(s, "Для виступу");
  assert.ok(made.ok);
  const id = made.id;
  assert.equal(addToCollection(s, id, ids[0], new Date("2026-11-05T10:00:00Z")), true);
  assert.equal(addToCollection(s, id, ids[0], new Date("2026-11-06T10:00:00Z")), true);
  assert.equal(addToCollection(s, id, ids[1], new Date("2026-11-07T10:00:00Z")), true);
  assert.equal(addToCollection(s, id, "missing"), false);
  assert.equal(addToCollection(s, "missing", ids[0]), false);
  assert.deepEqual(memberIds(s, id), [ids[1], ids[0]]);
  assert.deepEqual(namesOf(s, ids[0]), ["Для виступу"]);
  s.deleteItem(ids[1]);
  assert.deepEqual(memberIds(s, id), [ids[0]]);
  assert.equal(collectionRows(s)[0].count, 1);
  assert.deepEqual(collectionsOf(s, ids[1]), []);
});

test("collections: a page merged into an older material keeps one place in the set", () => {
  const { s, ids } = library();
  const made = createCollection(s, "Набір");
  assert.ok(made.ok);
  addToCollection(s, made.id, ids[0]);
  addToCollection(s, made.id, ids[1]);
  s.run("UPDATE items SET url=? WHERE id=?", "https://example.com/canonical", ids[0]);
  const merged = s.applyMetadata(ids[1], {
    url: "https://example.com/canonical",
    title: "Одна сторінка",
  } as any);
  assert.equal(merged, ids[0]);
  assert.deepEqual(memberIds(s, made.id), [ids[0]]);
  assert.deepEqual(collectionsOf(s, ids[1]), []);
});

test("collections API: create, add, take out, rename, delete; only for the owner", async () => {
  const { s, ids } = library();
  const server = await startMiniApp(
    { token: TOKEN, owner: OWNER, store: s, now: () => NOW, staticDir: "/nonexistent" },
    0,
  );
  assert.ok(server);
  const base = `http://${MINIAPP_HOST}:${(server.address() as AddressInfo).port}`;
  const headers = { authorization: auth(), "content-type": "application/json" };
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(base + path, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    return { status: res.status, body: text.startsWith("{") ? JSON.parse(text) : text };
  };
  try {
    assert.equal((await fetch(`${base}/api/collections`)).status, 401);
    assert.equal((await call("GET", "/api/collections")).body.collections.length, 0);
    assert.equal((await call("POST", "/api/collections", { name: "" })).status, 400);
    const made = await call("POST", "/api/collections", { name: "Дизайн" });
    assert.equal(made.status, 201);
    const id = made.body.id;
    assert.equal((await call("POST", "/api/collections", { name: "дизайн" })).status, 400);

    const added = await call("POST", `/api/collections/${id}/items`, { itemId: ids[0] });
    assert.equal(added.status, 200);
    assert.deepEqual(
      added.body.items.map((i: any) => i.title),
      ["Матеріал a"],
    );
    assert.equal((await call("POST", `/api/collections/${id}/items`, { itemId: "nope" })).status, 404);
    assert.equal((await call("POST", `/api/collections/${id}/items`, {})).status, 400);

    const item = await call("GET", `/api/library/${ids[0]}`);
    assert.deepEqual(item.body.collections, [id]);
    const list = await call("GET", "/api/collections");
    assert.equal(list.body.collections[0].count, 1);
    assert.deepEqual(list.body.collections[0].tiles, [{ id: ids[0], title: "Матеріал a", cover: false }]);

    assert.equal(
      (await call("PATCH", `/api/collections/${id}`, { name: "Дизайн мого застосунку" })).body.name,
      "Дизайн мого застосунку",
    );
    assert.equal(
      (await call("POST", `/api/collections/${id}/remove`, { itemId: ids[0] })).body.items.length,
      0,
    );
    assert.equal((await call("GET", "/api/collections/missing")).status, 404);
    assert.equal((await call("PUT", `/api/collections/${id}`)).status, 405);

    await call("POST", `/api/collections/${id}/items`, { itemId: ids[1] });
    assert.equal((await call("POST", `/api/collections/${id}/delete`)).status, 200);
    assert.equal((await call("GET", `/api/collections/${id}`)).status, 404);
    // The material itself stays.
    assert.equal((await call("GET", `/api/library/${ids[1]}`)).status, 200);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});

test("bot: «В добірку» creates a collection from a card and ticks it on the next look", async () => {
  const { s, ids } = library();
  const sent: { t: string; k?: any }[] = [];
  const send = async (t: string, k?: any) => (sent.push({ t, k }), 100 + sent.length);
  const callback = (update: number, data: string) =>
    handle(
      s,
      {
        update_id: update,
        callback_query: {
          from: { id: 42 },
          data,
          message: { message_id: 7, chat: { id: 42, type: "private" } },
        },
      },
      42,
      send,
    );
  const say = (update: number, text: string) =>
    handle(
      s,
      {
        update_id: update,
        message: { message_id: update, from: { id: 42 }, chat: { id: 42, type: "private" }, text },
      },
      42,
      send,
    );

  await callback(1, `colls:${ids[0]}`);
  const rows = () =>
    sent
      .at(-1)!
      .k.inline_keyboard.flat()
      .map((b: any) => b.text);
  assert.ok(rows().includes("+ Нова добірка"));
  await callback(2, `collnew:${ids[0]}`);
  assert.match(sent.at(-1)!.t, /Як назвати добірку/);
  await say(3, "Дизайн мого застосунку");
  assert.match(sent.at(-1)!.t, /^Створено «Дизайн мого застосунку»/);
  assert.deepEqual(namesOf(s, ids[0]), ["Дизайн мого застосунку"]);

  await callback(4, `colls:${ids[0]}`);
  assert.ok(rows().includes("✓ Дизайн мого застосунку · 1"));
  const [{ id }] = collectionRows(s);
  await callback(5, `coll:${id}:${ids[1]}`);
  assert.deepEqual(memberIds(s, id).sort(), [ids[0], ids[1]].sort());
  await callback(6, `coll:${id}:${ids[1]}`);
  assert.deepEqual(memberIds(s, id), [ids[0]]);

  await callback(7, "library:collections");
  assert.ok(
    sent
      .at(-1)!
      .k.inline_keyboard.flat()
      .some((b: any) => b.callback_data === `collview:${id}`),
  );
  await callback(8, `collview:${id}`);
  assert.match(sent.at(-1)!.t, /^Дизайн мого застосунку · 1\/1/);
  // A name that is taken keeps the dialog open.
  await callback(9, `collnew:${ids[2]}`);
  await say(10, "дизайн мого застосунку");
  assert.match(sent.at(-1)!.t, /Така добірка вже є/);
  assert.deepEqual(namesOf(s, ids[2]), []);
});
