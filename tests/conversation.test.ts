import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.ts";
import { handle } from "../src/bot.ts";
const msg = (id: number, text: string, reply?: number) => ({
  update_id: id,
  message: {
    message_id: id,
    from: { id: 42 },
    chat: { id: 42, type: "private" },
    text,
    ...(reply ? { reply_to_message: { message_id: reply } } : {}),
  },
});
const cb = (id: number, data: string, mid: number) => ({
  update_id: id,
  callback_query: { from: { id: 42 }, data, message: { message_id: mid, chat: { id: 42, type: "private" } } },
});
function harness() {
  const s = new Store(":memory:");
  const out: any[] = [];
  const send = async (text: string, k?: any) => {
    out.push({ text, k, id: 100 + out.length });
    return out.at(-1).id;
  };
  return { s, out, send };
}
test("buttons update status, explicit date, reaction and metadata without AI", async () => {
  const { s, out, send } = harness();
  await handle(s, msg(1, "https://example.com/page"), 42, send);
  const item = s.items()[0];
  await handle(s, cb(2, `status:finished:${item.id}`, out[0].id), 42, send);
  assert.equal(s.item(item.id)!.status, "finished");
  const defaultDate = s.item(item.id)!.consumed_on;
  assert.ok(defaultDate);
  await handle(s, cb(3, `edit:consumed_on:${item.id}`, out.at(-1).id), 42, send);
  await handle(s, msg(4, "2026-02-30"), 42, send);
  assert.equal(s.item(item.id)!.consumed_on, defaultDate);
  await handle(s, msg(5, "2026-02-28"), 42, send);
  assert.equal(s.item(item.id)!.consumed_on, "2026-02-28");
  await handle(s, cb(6, `reaction:mixed:${item.id}`, out.at(-1).id), 42, send);
  assert.equal(s.item(item.id)!.reaction, "mixed");
  await handle(s, cb(7, `edit:creator:${item.id}`, out.at(-1).id), 42, send);
  await handle(s, msg(8, "Автор"), 42, send);
  assert.equal(s.item(item.id)!.creator, "Автор");
  s.close();
});
test("active reflection accepts plain text, one AI followup, categorization applies automatically", async () => {
  const { s, out, send } = harness();
  let calls = 0;
  const ai = async () => {
    calls++;
    return { question: "Що саме зачепило?", tags: ["атмосфера"], type: "article" };
  };
  await handle(s, msg(1, "https://example.com/page"), 42, send);
  const id = s.items()[0].id;
  await handle(s, cb(2, `reflect:${id}`, out[0].id), 42, send, ai);
  await handle(s, msg(3, "Сподобався стиль"), 42, send, ai);
  assert.equal(calls, 1);
  assert.deepEqual(s.item(id)!.tags, ["атмосфера"]);
  assert.equal(s.item(id)!.type, "article");
  await handle(s, msg(4, "Багато влучних прикладів"), 42, send, ai);
  assert.equal(calls, 2);
  assert.equal(s.snapshot().reflections.length, 2);
  assert.equal(out.filter((x) => x.text.includes("Що саме зачепило?")).length, 1);
  assert.ok(!JSON.stringify(out).includes("accept:"));
  s.close();
});
test("AI outage leaves original reflection intact and bot usable", async () => {
  const { s, out, send } = harness();
  await handle(s, msg(1, "https://example.com/page"), 42, send);
  const id = s.items()[0].id;
  await handle(s, cb(2, `reflect:${id}`, out[0].id), 42, send);
  await handle(s, msg(3, "Мій текст"), 42, send, async () => {
    throw Error("offline");
  });
  assert.equal(s.snapshot().reflections[0].body, "Мій текст");
  await handle(s, msg(4, "/list"), 42, send);
  assert.match(out.at(-1).text, /Мій текст/);
  s.close();
});
test("menu searches metadata; a snoozed item stays out of «Без вражень» until due", async () => {
  const { s, out, send } = harness();
  await handle(s, msg(1, "Нотатка про дизайн"), 42, send);
  const id = s.items()[0].id;
  s.patch(id, { snooze_until: "2999-01-01" });
  assert.equal(s.unreflected().length, 0);
  s.patch(id, { snooze_until: "2000-01-01", creator: "Олена", tags: ["дизайн"] });
  assert.equal(s.unreflected().length, 1);
  await handle(s, msg(3, "Пошук"), 42, send);
  await handle(s, msg(4, "Олена"), 42, send);
  assert.match(out.at(-1).text, /Олена/);
  s.close();
});
test("obsolete AI acceptance buttons do not modify manually set data", async () => {
  const { s, out, send } = harness();
  await handle(s, msg(1, "Текст"), 42, send);
  const id = s.items()[0].id;
  s.patch(id, { type: "book", manual_type: true, tags: ["моє"] });
  s.saveAI(1, id, { question: null, type: "article", tags: ["тема"] });
  await handle(s, cb(2, `accept:${id}`, out[0].id), 42, send);
  assert.equal(s.item(id)!.type, "book");
  assert.deepEqual(s.item(id)!.tags, ["моє"]);
  s.close();
});
