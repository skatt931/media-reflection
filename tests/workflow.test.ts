import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.ts";
import { handle } from "../src/bot.ts";
const msg = (id: number, text: string) => ({
  update_id: id,
  message: { message_id: id, date: 1793782800, from: { id: 42 }, chat: { id: 42, type: "private" }, text },
});
test("new capture defaults consumed, repeated media retains status and history", () => {
  const s = new Store(":memory:");
  const id = s.capture(1, "https://example.com/page", new Date("2026-11-03T20:00:00Z"));
  assert.equal(s.item(id)!.status, "consumed");
  assert.equal(s.item(id)!.consumed_on, "2026-11-03");
  assert.equal(s.item(id)!.date_source, "capture");
  s.edit(id, { status: "saved", consumed_on: null });
  assert.equal(s.capture(2, "https://example.com/page ще одна думка"), id);
  assert.equal(s.item(id)!.status, "saved");
  assert.equal(s.snapshot().captures.length, 2);
  s.close();
});
test("AI autofills low stakes fields; manual per-field changes including cleared values win", () => {
  const s = new Store(":memory:");
  const id = s.capture(1, "Моя нотатка");
  s.applyAI(id, {
    question: null,
    type: "article",
    tags: ["тема"],
    entities: ["Blender"],
    summary: "Про освітлення",
  });
  assert.equal(s.item(id)!.type, "article");
  assert.deepEqual(s.item(id)!.tags, ["тема"]);
  s.edit(id, { tags: [], type: "book", summary: null });
  s.applyAI(id, {
    question: null,
    type: "video",
    tags: ["інше"],
    entities: ["Blender"],
    summary: "Новий опис",
  });
  assert.equal(s.item(id)!.type, "book");
  assert.deepEqual(s.item(id)!.tags, []);
  assert.equal(s.item(id)!.summary, null);
  s.close();
});
test("capture categorizes automatically and presents only two inline actions", async () => {
  const s = new Store(":memory:");
  const out: any[] = [];
  let n = 100;
  const send = async (text: string, k?: any) => {
    out.push({ text, k });
    return n++;
  };
  await handle(s, msg(1, "Дослідження про Blender"), 42, send, async () => ({
    question: null,
    type: "article",
    tags: ["blender"],
    entities: ["Blender"],
    summary: "Про Blender",
  }));
  assert.equal(s.items()[0].type, "article");
  assert.deepEqual(s.items()[0].tags, ["blender"]);
  assert.deepEqual(
    out
      .at(-1)
      .k.inline_keyboard.flat()
      .map((b: any) => b.callback_data.split(":")[0]),
    ["reaction", "reaction", "reaction", "reaction", "reflect", "later", "details"],
  );
  assert.ok(!JSON.stringify(out).includes("accept:"));
  s.close();
});
test("ask mode remembers followups and never captures queries; export is explicit and owner-only", async () => {
  const s = new Store(":memory:");
  const out: any[] = [];
  let n = 100;
  const send = async (text: string, k?: any) => {
    out.push({ text, k });
    return n++;
  };
  let exports = 0;
  const calls: any[] = [];
  const services = {
    ask: async (query: string, history: string[]) => {
      calls.push({ query, history });
      return {
        text: "Нічого не знайдено.",
        ids: [],
        plan: {
          terms: [],
          types: [],
          reaction: null,
          status: null,
          from: null,
          to: null,
          best: false,
          limit: 5,
        },
      };
    },
    export: () => {
      exports++;
      return {
        name: "export.zip",
        zip: null,
        notes: 0,
        covers: 0,
        left: 0,
        changed: [],
        deleted: [],
        commit() {},
      };
    },
  };
  await handle(s, msg(1, "Запитати"), 42, send, undefined, services);
  await handle(s, msg(2, "Чи є щось про Відьмака?"), 42, send, undefined, services);
  await handle(s, msg(3, "А тільки відео?"), 42, send, undefined, services);
  assert.deepEqual(calls[1].history, ["Чи є щось про Відьмака?"]);
  assert.equal(s.items().length, 0);
  assert.equal(exports, 0);
  await handle(
    s,
    { ...msg(4, "Експорт"), message: { ...msg(4, "Експорт").message, from: { id: 99 } } },
    42,
    send,
    undefined,
    services,
  );
  assert.equal(exports, 0);
  await handle(s, msg(5, "Експорт"), 42, send, undefined, services);
  assert.equal(exports, 1);
  s.close();
});
test("retrying an interrupted reflection preserves routing and avoids duplicate AI work", async () => {
  const s = new Store(":memory:");
  const id = s.capture(1, "Матеріал");
  s.setContext({ mode: "reflection", id, followup: false, expires: Date.now() + 60000 });
  let calls = 0;
  const ai = async () => {
    calls++;
    return { question: "Чому?", type: "article", tags: ["тема"] };
  };
  const update = msg(2, "Моя думка");
  await assert.rejects(
    handle(
      s,
      update,
      42,
      async () => {
        throw Error("offline");
      },
      ai,
    ),
  );
  await handle(s, update, 42, async () => 100, ai);
  assert.equal(calls, 1);
  assert.equal(s.snapshot().reflections.length, 1);
  assert.equal(s.items().length, 1);
  s.close();
});
test("an interrupted reflection retry keeps its original route even after context expiry", async () => {
  const s = new Store(":memory:");
  const id = s.capture(1, "Матеріал");
  const now = Date.now();
  s.setContext({ mode: "reflection", id, followup: false, expires: now + 100 });
  const update = msg(2, "Думка");
  await assert.rejects(
    handle(s, update, 42, async () => {
      throw Error("offline");
    }),
  );
  const original = Date.now;
  try {
    Date.now = () => now + 10000;
    await handle(s, update, 42, async () => 100);
  } finally {
    Date.now = original;
  }
  assert.equal(s.items().length, 1);
  assert.equal(s.snapshot().reflections.length, 1);
  s.close();
});
