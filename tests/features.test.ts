import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.ts";
import { handle, weekly, type Out } from "../src/bot.ts";
import { exportVault } from "../src/vault.ts";
import type { Metadata } from "../src/metadata.ts";

const msg = (id: number, text: string) => ({
  update_id: id,
  message: { message_id: id, from: { id: 42 }, chat: { id: 42, type: "private" }, text },
});
const cb = (id: number, data: string, mid: number, extra: object = {}) => ({
  update_id: id,
  callback_query: {
    from: { id: 42 },
    data,
    message: { message_id: mid, chat: { id: 42, type: "private" }, ...extra },
  },
});
function harness() {
  const s = new Store(":memory:");
  const out: { text: string; k?: any; o?: Out; id: number }[] = [];
  const send = async (text: string, k?: any, o?: Out) => {
    const id = o?.edit?.id ?? 100 + out.length;
    out.push({ text, k, o, id });
    return id;
  };
  return { s, out, send };
}
const meta = (patch: Partial<Metadata> = {}): Metadata => ({
  title: null,
  creator: null,
  description: null,
  image: null,
  site: null,
  url: null,
  ...patch,
});

test("a short message right after a bare link becomes a note on it, and can be split off", async () => {
  const { s, out, send } = harness();
  await handle(s, msg(1, "https://example.com/a"), 42, send);
  const id = s.items()[0].id;
  await handle(s, msg(2, "🤘 клас"), 42, send);
  assert.equal(s.items().length, 1);
  assert.deepEqual(
    s.reflections(id).map((r) => r.body),
    ["🤘 клас"],
  );
  const detach = out.at(-1)!.k.inline_keyboard[0][0].callback_data;
  await handle(s, cb(3, detach, out.at(-1)!.id), 42, send);
  assert.equal(s.items().length, 2);
  assert.equal(s.reflections(id).length, 0);
  assert.ok(s.items().some((i) => i.title === "🤘 клас"));
});

test("a reflection never becomes the title; empty AI answers do not erase tags or type", async () => {
  const { s, out, send } = harness();
  await handle(s, msg(1, "https://example.com/a"), 42, send, async () => ({
    question: null,
    type: "article",
    tags: ["тема"],
    summary: "Опис",
  }));
  const id = s.items()[0].id;
  await handle(s, cb(2, `reflect:${id}`, out[0].id), 42, send);
  await handle(s, msg(3, "🤘 клас"), 42, send, async () => ({
    question: null,
    type: "unknown",
    tags: [],
    title: "🤘 клас",
  }));
  const item = s.item(id)!;
  assert.equal(item.title, "https://example.com/a");
  assert.deepEqual(item.tags, ["тема"]);
  assert.equal(item.type, "article");
});

test("card reactions toggle in place and take the item out of «Без вражень»", async () => {
  const { s, out, send } = harness();
  await handle(s, msg(1, "Нотатка"), 42, send);
  const id = s.items()[0].id;
  await handle(s, cb(2, `reaction:positive:${id}`, out[0].id), 42, send);
  assert.equal(s.item(id)!.reaction, "positive");
  assert.equal(out.at(-1)!.o?.edit?.id, out[0].id);
  assert.equal(s.unreflected().length, 0);
  await handle(s, cb(3, `reaction:positive:${id}`, out[0].id), 42, send);
  assert.equal(s.item(id)!.reaction, null);
});

test("lists are one message paged with arrows; actions keep the arrows", async () => {
  const { s, out, send } = harness();
  for (const n of [1, 2, 3]) await handle(s, msg(n, `Запис ${n}`), 42, send);
  const before = out.length;
  await handle(s, msg(4, "/list"), 42, send);
  assert.equal(out.length, before + 1);
  const pager = out.at(-1)!;
  assert.match(pager.text, /^Останні · 1\/3\n\nЗапис 3/);
  assert.equal(pager.o?.photo, undefined);
  const arrows = pager.k.inline_keyboard.at(-1);
  assert.deepEqual(
    arrows.map((b: any) => b.text),
    ["←", "→"],
  );
  await handle(s, cb(5, arrows[1].callback_data, pager.id), 42, send);
  assert.match(out.at(-1)!.text, /^Останні · 2\/3\n\nЗапис 2/);
  assert.equal(out.at(-1)!.o?.edit?.id, pager.id);
  const second = s.items()[1].id;
  await handle(s, cb(6, `reaction:mixed:${second}`, pager.id), 42, send);
  assert.match(out.at(-1)!.text, /^Останні · 2\/3/);
  assert.equal(out.at(-1)!.k.inline_keyboard.at(-1)[0].text, "←");
  await handle(s, cb(7, "page:2", pager.id), 42, send);
  await handle(
    s,
    {
      ...msg(8, "думка про перший"),
      message: {
        ...msg(8, "").message,
        text: "думка про перший",
        reply_to_message: { message_id: pager.id },
      },
    },
    42,
    send,
  );
  assert.deepEqual(
    s.reflections(s.items()[2].id).map((r) => r.body),
    ["думка про перший"],
  );
});

test("submenus edit the card instead of sending new messages", async () => {
  const { s, out, send } = harness();
  await handle(s, msg(1, "https://example.com"), 42, send);
  const id = s.items()[0].id;
  const card = out[0].id;
  await handle(s, cb(2, `details:${id}`, card), 42, send);
  await handle(s, cb(3, `type:${id}`, card), 42, send);
  await handle(s, cb(4, `settype:game:${id}`, card), 42, send);
  assert.ok(out.slice(1).every((x) => x.o?.edit?.id === card));
  assert.equal(s.item(id)!.type, "game");
});

test("delete asks for confirmation, removes the item and its vault note", async () => {
  const dir = mkdtempSync(join(tmpdir(), "delete-"));
  const vault = join(dir, "vault");
  mkdirSync(join(vault, ".obsidian"), { recursive: true });
  const s = new Store(join(dir, "db.sqlite"));
  try {
    const out: { text: string; k?: any; o?: Out; id: number }[] = [];
    const send = async (text: string, k?: any, o?: Out) => {
      const id = o?.edit?.id ?? 100 + out.length;
      out.push({ text, k, o, id });
      return id;
    };
    await handle(s, msg(1, "Перший"), 42, send);
    await handle(s, msg(2, "Другий"), 42, send);
    const [second, first] = s.items().map((i) => i.id);
    exportVault(s, vault);
    const materials = join(vault, "Медіатека", "Матеріали");
    const edited = readdirSync(materials).find((f) => f.startsWith("Другий"))!;
    writeFileSync(join(materials, edited), readFileSync(join(materials, edited), "utf8") + "моє\n");
    await handle(s, cb(3, `delete:${first}`, out[0].id), 42, send);
    assert.equal(out.at(-1)!.k.inline_keyboard[0][0].callback_data, `remove:${first}`);
    assert.ok(s.item(first));
    const notice = await handle(s, cb(4, `remove:${first}`, out[0].id), 42, send);
    assert.equal(notice, "Видалено");
    assert.equal(s.item(first), undefined);
    assert.equal(s.snapshot().captures.length, 1);
    await handle(s, cb(5, `remove:${second}`, out[1].id), 42, send);
    const report = exportVault(s, vault);
    assert.equal(report.removed, 1);
    assert.deepEqual(report.kept, [edited.slice(0, -3)]);
    assert.deepEqual(readdirSync(materials), [edited]);
    assert.equal(exportVault(s, vault).removed, 0);
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("hidden links are read from entities; forwarded text is not a note", async () => {
  const { s, send } = harness();
  const base = msg(1, "дивись тут").message;
  await handle(
    s,
    {
      update_id: 1,
      message: {
        ...base,
        entities: [{ type: "text_link", offset: 7, length: 3, url: "https://example.com/a" }],
      },
    },
    42,
    send,
  );
  const a = s.items()[0];
  assert.equal(a.url, "https://example.com/a");
  assert.deepEqual(
    s.reflections(a.id).map((r) => r.body),
    ["дивись тут"],
  );
  await handle(
    s,
    {
      update_id: 2,
      message: {
        ...msg(2, "").message,
        text: "Пост каналу https://example.com/b",
        forward_origin: { type: "channel" },
      },
    },
    42,
    send,
  );
  const b = s.items()[0];
  assert.equal(b.url, "https://example.com/b");
  assert.equal(s.reflections(b.id).length, 0);
});

test("voice is transcribed once and then handled like text", async () => {
  const { s, out, send } = harness();
  let calls = 0;
  const services = {
    transcribe: async () => {
      calls++;
      return "https://example.com голосова думка";
    },
  };
  const voice = {
    update_id: 1,
    message: {
      message_id: 1,
      from: { id: 42 },
      chat: { id: 42, type: "private" },
      voice: { file_id: "f", file_size: 1000 },
    },
  };
  let fail = true;
  const flaky = async (text: string, k?: any, o?: Out) => {
    if (fail && !text.startsWith("🎤")) {
      fail = false;
      throw Error("offline");
    }
    return send(text, k, o);
  };
  await assert.rejects(handle(s, voice, 42, flaky, undefined, services));
  await handle(s, voice, 42, flaky, undefined, services);
  assert.equal(calls, 1);
  assert.equal(s.items().length, 1);
  assert.equal(s.snapshot().reflections[0].body, "голосова думка");
  assert.ok(out.some((x) => x.text.startsWith("🎤")));
});

test("weekly digest: one silent message on Friday evening, updated in place while unopened", async () => {
  const { s, out, send } = harness();
  s.capture(1, "https://youtube.com/watch?v=a", new Date("2026-11-02T10:00:00Z"));
  s.capture(2, "https://example.com/b думка", new Date("2026-11-03T10:00:00Z"));
  const friday = (time: string) => new Date(`2026-11-06T${time}Z`);
  await weekly(s, send, new Date("2026-11-05T18:00:00Z"));
  await weekly(s, send, friday("16:00:00"));
  assert.equal(out.length, 0);
  await weekly(s, send, friday("17:30:00"));
  assert.equal(out.length, 1);
  assert.equal(out[0].text, "За тиждень збережено 2: Відео 1 · Інше 1.\nБез вражень: 1.");
  assert.equal(out[0].o?.silent, true);
  assert.equal(out[0].o?.edit, undefined);
  await weekly(s, send, friday("19:00:00"));
  assert.equal(out.length, 1);

  s.capture(3, "https://example.com/c", new Date("2026-11-10T10:00:00Z"));
  await weekly(s, send, new Date("2026-11-13T18:00:00Z"));
  assert.equal(out[1].o?.edit?.id, out[0].id);
  assert.match(out[1].text, /^З 30\.10 збережено 3/);

  await handle(s, cb(10, "weekly:open", out[0].id), 42, send);
  assert.match(out.at(-1)!.text, /^Без вражень · 1\/2/);
  s.capture(4, "https://example.com/d", new Date("2026-11-15T10:00:00Z"));
  const before = out.length;
  await weekly(s, send, new Date("2026-11-20T18:00:00Z"));
  assert.equal(out[before].o?.edit, undefined);
  assert.match(out[before].text, /^За тиждень збережено 1/);
  await weekly(s, send, new Date("2026-11-27T18:00:00Z"), "off");
  assert.equal(out.length, before + 1);
});

test("a share link that resolves to an already saved post is merged into it", async () => {
  const { s, send } = harness();
  const existing = s.capture(1, "https://www.threads.com/@x/post/1");
  s.patch(existing, { metadata_loaded: 2 });
  const services = {
    metadata: async () => meta({ title: "Пост", site: "Threads", url: "https://www.threads.com/@x/post/1" }),
  };
  await handle(s, msg(2, "https://www.threads.com/share/abc думка"), 42, send, undefined, services);
  assert.equal(s.items().length, 1);
  assert.equal(s.captures(existing).length, 2);
  assert.deepEqual(
    s.reflections(existing).map((r) => r.body),
    ["думка"],
  );
});

test("/enrich fills in old items: page title wins over AI, AI adds tags", async () => {
  const { s, out, send } = harness();
  const id = s.capture(1, "https://www.threads.com/share/abc");
  const services = {
    metadata: async () =>
      meta({
        title: "Чотири кандидати",
        creator: "EC (@ec)",
        description: "Чотири кандидати в ЄС",
        site: "Threads",
      }),
  };
  const ai = async () => ({
    question: null,
    type: "social_post",
    tags: ["єс"],
    title: "Чотири",
    summary: "Про ЄС",
  });
  await handle(s, msg(2, "/enrich"), 42, send, ai, services);
  const item = s.item(id)!;
  assert.equal(item.title, "Чотири кандидати");
  assert.equal(item.creator, "EC (@ec)");
  assert.deepEqual(item.tags, ["єс"]);
  assert.match(out.at(-1)!.text, /Оновлено 1 з 1/);
  await handle(s, msg(3, "/enrich"), 42, send, ai, services);
  assert.match(out.at(-1)!.text, /нічого/);
});

test("cover image is shown on the card and copied into the vault", async () => {
  const dir = mkdtempSync(join(tmpdir(), "covers-"));
  const vault = join(dir, "vault");
  mkdirSync(join(vault, ".obsidian"), { recursive: true });
  const s = new Store(join(dir, "db.sqlite"));
  try {
    const sent: { o?: Out }[] = [];
    const send = async (_t: string, _k?: any, o?: Out) => (sent.push({ o }), 100 + sent.length);
    const services = {
      metadata: async () => meta({ title: "Пост", image: "https://cdn.test/a.jpg" }),
      cover: async (id: string) => {
        mkdirSync(s.coverDir!, { recursive: true });
        writeFileSync(join(s.coverDir!, `${id}.jpg`), "jpg");
        return `${id}.jpg`;
      },
    };
    await handle(s, msg(1, "https://example.com/post"), 42, send, undefined, services);
    const id = s.items()[0].id;
    assert.ok(sent.at(-1)!.o?.photo?.path.endsWith(`${id}.jpg`));
    exportVault(s, vault);
    assert.ok(existsSync(join(vault, "Медіатека", "Обкладинки", `${id}.jpg`)));
    const materials = join(vault, "Медіатека", "Матеріали");
    const note = readFileSync(join(materials, readdirSync(materials)[0]), "utf8");
    assert.ok(note.includes(`![[Медіатека/Обкладинки/${id}.jpg|400]]`));
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("startup fixes legacy rows: tracking params stripped, old music type mapped", () => {
  const dir = mkdtempSync(join(tmpdir(), "legacy-"));
  const file = join(dir, "db.sqlite");
  try {
    let s = new Store(file);
    s.close();
    const db = new DatabaseSync(file);
    db.exec(
      "INSERT INTO items(id,url,title,type,created_at,details) VALUES ('a','https://open.spotify.com/track/1?si=x','https://open.spotify.com/track/1?si=x','music','2026-11-04T00:00:00Z','{}')",
    );
    db.exec(
      "INSERT INTO items(id,url,title,type,created_at,details) VALUES ('b','https://www.threads.com/share/x','t','unknown','2026-11-04T00:00:00Z','{\"creator\":\"невідомий\"}')",
    );
    db.close();
    s = new Store(file);
    assert.equal(s.item("b")!.type, "social_post");
    assert.equal(s.item("b")!.creator, null);
    const item = s.item("a")!;
    assert.equal(item.url, "https://open.spotify.com/track/1");
    assert.equal(item.title, "https://open.spotify.com/track/1");
    assert.equal(item.type, "music_track");
    s.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("prune removes bookkeeping for finished updates only", async () => {
  const { s, send } = harness();
  await handle(s, msg(1, "/ask щось"), 42, send, undefined, {
    ask: async () => ({
      text: "x",
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
    }),
  });
  s.requestContext(99);
  s.prune();
  assert.equal(s.value("answer:1"), undefined);
  assert.deepEqual(
    s.all("SELECT id FROM update_context").map((r) => r.id),
    [99],
  );
});
