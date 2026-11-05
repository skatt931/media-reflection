import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.ts";
import { handle } from "../src/bot.ts";

const message = (id: number, text: string, reply?: number, user = 42) => ({
  update_id: id,
  message: {
    message_id: id,
    from: { id: user },
    chat: { id: user, type: "private" },
    text,
    ...(reply ? { reply_to_message: { message_id: reply } } : {}),
  },
});
test("capture survives restart, duplicate update is ignored, repeated URL retains captures", async () => {
  const dir = mkdtempSync(join(tmpdir(), "reflection-"));
  const path = join(dir, "test.sqlite");
  let s = new Store(path);
  const sent: any[] = [];
  const send = async (t: string, k?: any) => {
    sent.push({ t, k });
    return 100 + sent.length;
  };
  await handle(s, message(1, "https://youtu.be/abc перша думка"), 42, send);
  await handle(s, message(1, "https://youtu.be/abc перша думка"), 42, send);
  await handle(s, message(2, "https://youtu.be/abc друга думка"), 42, send);
  assert.equal(s.items().length, 1);
  assert.equal(s.snapshot().captures.length, 2);
  assert.equal(s.snapshot().reflections.length, 2);
  s.close();
  s = new Store(path);
  assert.equal(s.items().length, 1);
  assert.equal(s.offset(), 3);
  s.close();
  rmSync(dir, { recursive: true });
});
test("a reply to the pager adds a note to the shown item; outsiders and groups cannot modify data", async () => {
  const s = new Store(":memory:");
  let n = 100;
  const sent: any[] = [];
  const send = async (t: string, k?: any) => {
    sent.push({ t, k, id: ++n });
    return n;
  };
  await handle(s, message(1, "https://example.com"), 42, send);
  await handle(s, message(2, "/reflect"), 42, send);
  const prompt = sent.find((x) => x.t.startsWith("Без вражень · 1/1"));
  assert.ok(prompt);
  await handle(s, message(3, "мої враження", prompt.id), 42, send);
  assert.equal(s.snapshot().reflections[0].body, "мої враження");
  await handle(s, message(4, "/reflect"), 42, send);
  assert.match(sent.at(-1).t, /порожньо/);
  await handle(s, message(5, "secret", undefined, 99), 42, send);
  await handle(
    s,
    { ...message(6, "group"), message: { ...message(6, "group").message, chat: { id: 42, type: "group" } } },
    42,
    send,
  );
  assert.equal(s.items().length, 1);
  await handle(s, message(7, "another item"), 42, send);
  await handle(s, message(8, "/reflect"), 42, send);
  const p = sent.at(-1);
  const cb = p.k.inline_keyboard[0][0].callback_data;
  await handle(
    s,
    {
      update_id: 9,
      callback_query: {
        from: { id: 99 },
        data: cb,
        message: { message_id: p.id, chat: { id: 42, type: "private" } },
      },
    },
    42,
    send,
  );
  assert.equal(s.unreflected().length, 1);
  await handle(
    s,
    {
      update_id: 10,
      callback_query: {
        from: { id: 42 },
        data: cb,
        message: { message_id: p.id, chat: { id: 42, type: "private" } },
      },
    },
    42,
    send,
  );
  assert.equal(s.unreflected().length, 0);
  assert.equal(s.items().length, 2);
  s.close();
});
test("malformed URL is captured without breaking ingestion; unrelated reply creates no item", async () => {
  const s = new Store(":memory:");
  const send = async () => 123;
  await handle(s, message(1, "https://% погане посилання"), 42, send);
  assert.equal(s.items().length, 1);
  await handle(s, message(2, "не прив’язана відповідь", 9999), 42, send);
  assert.equal(s.items().length, 1);
  assert.equal(s.snapshot().reflections.length, 0);
  s.close();
});
test("failed confirmation retries without duplicate capture or initial reflection", async () => {
  const s = new Store(":memory:");
  const u = message(1, "https://example.com думка");
  await assert.rejects(
    handle(s, u, 42, async () => {
      throw new Error("offline");
    }),
  );
  assert.equal(s.offset(), 0);
  await handle(s, u, 42, async () => 123);
  assert.equal(s.snapshot().captures.length, 1);
  assert.equal(s.snapshot().reflections.length, 1);
  assert.equal(s.offset(), 2);
  s.close();
});
