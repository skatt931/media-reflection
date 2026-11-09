import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store, normalizeTags } from "../src/store.ts";
import { createSearch, retrieve } from "../src/search.ts";
import { handle, commands, type Out } from "../src/bot.ts";
import { JournalStore } from "../src/journal.ts";
import { exportVault } from "../src/vault.ts";
import type { AnalysisContext } from "../src/groq.ts";

const msg = (id: number, text: string) => ({
  update_id: id,
  message: { message_id: id, from: { id: 42 }, chat: { id: 42, type: "private" }, text },
});
const cb = (id: number, data: string, mid: number) => ({
  update_id: id,
  callback_query: { from: { id: 42 }, data, message: { message_id: mid, chat: { id: 42, type: "private" } } },
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
const plan = (patch: object = {}) => ({
  terms: [],
  types: [],
  reaction: null,
  status: null,
  from: null,
  to: null,
  best: false,
  limit: 10,
  ...patch,
});
const labels = (k: any) => k.inline_keyboard.flat().map((b: any) => b.text);

test("tags use spaces; old underscore tags are converted; Obsidian still gets underscores", () => {
  assert.deepEqual(normalizeTags(["Штучний_інтелект", " 3D  друк ", "#дизайн", "ai"]), [
    "штучний інтелект",
    "3d друк",
    "дизайн",
    "ai",
  ]);
  const dir = mkdtempSync(join(tmpdir(), "tags-"));
  const vault = join(dir, "vault");
  mkdirSync(join(vault, ".obsidian"), { recursive: true });
  try {
    const old = new Store(join(dir, "db.sqlite"));
    const id = old.capture(1, "https://example.com/page");
    old.patch(id, { tags: ["штучний_інтелект", "політика"] });
    old.close();
    const s = new Store(join(dir, "db.sqlite"));
    assert.deepEqual(s.item(id)!.tags, ["штучний інтелект", "політика"]);
    exportVault(s, vault);
    const [note] = readdirSync(join(vault, "Медіатека", "Матеріали"));
    assert.match(
      readFileSync(join(vault, "Медіатека", "Матеріали", note), "utf8"),
      /tags: \["штучний_інтелект","політика"\]/,
    );
    s.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("search matches other word endings and multi-word tags", () => {
  const s = new Store(":memory:");
  const witcher = s.capture(1, "Відьмак огляд");
  const ai = s.capture(2, "https://example.com/news");
  s.patch(ai, { tags: ["штучний інтелект"] });
  s.capture(3, "Відьмаки й чарівниці — інше");
  const ids = (terms: string[]) => retrieve(s, plan({ terms })).map((i) => i.id);
  assert.ok(ids(["Відьмака"]).includes(witcher));
  assert.deepEqual(ids(["штучного інтелекту"]), [ai]);
  assert.deepEqual(ids(["інтелект кіно"]), []);
  s.close();
});

test("type words in the query keep the AI's type filter: resources, music", async () => {
  const s = new Store(":memory:");
  const site = s.capture(1, "https://dribbble.com/");
  const track = s.capture(2, "https://open.spotify.com/track/1");
  const album = s.capture(3, "https://open.spotify.com/album/1");
  s.capture(4, "https://youtube.com/watch?v=1");
  const search = (query: string, types: string[]) =>
    createSearch(s, async (name) => (name === "library_query" ? plan({ types }) : null))(query, []);
  assert.deepEqual((await search("покажи ресурси", ["resource"])).ids, [site]);
  assert.deepEqual(
    new Set((await search("яку музику я слухав", ["music_track"])).ids),
    new Set([track, album]),
  );
  // A type the query never names is still dropped: «Witcher» alone does not mean a game.
  assert.equal((await search("Witcher", ["game"])).plan.types.length, 0);
  s.close();
});

test("the AI also sees items without a word match and may pick them by meaning", async () => {
  const s = new Store(":memory:");
  const id = s.capture(1, "https://example.com/talk");
  s.patch(id, { title: "Machine learning talk", tags: ["машинне навчання"] });
  const seen: any[] = [];
  const request = async (name: string, _i: string, input: any) => {
    seen.push(input);
    return name === "library_query"
      ? plan({ terms: ["нейромережі"], limit: 5 })
      : { text: "Є доповідь про машинне навчання.", ids: [id] };
  };
  const result = await createSearch(s, request)("щось про нейромережі", []);
  assert.deepEqual(result.ids, [id]);
  assert.equal(seen[1].candidates[0].wordMatch, false);
  // Without the AI's answer, an item without a word match is not a result.
  const fallback = await createSearch(s, async (name: string) =>
    name === "library_query" ? plan({ terms: ["нейромережі"] }) : null,
  )("щось про нейромережі", []);
  assert.deepEqual(fallback.ids, []);
  assert.match(fallback.text, /Нічого/);
  s.close();
});

test("«За типом» lists only present types with counts and opens a paged list", async () => {
  const { s, out, send } = harness();
  s.capture(1, "https://youtube.com/watch?v=1");
  s.capture(2, "https://youtube.com/watch?v=2");
  s.capture(3, "https://dribbble.com/");
  await handle(s, msg(10, "Бібліотека"), 42, send);
  const menu = out.at(-1)!;
  assert.ok(labels(menu.k).includes("За типом"));
  await handle(s, cb(11, "library:types", menu.id), 42, send);
  assert.deepEqual(labels(out.at(-1)!.k), ["Відео 2", "Ресурс 1", "← Назад"]);
  assert.equal(out.at(-1)!.o?.edit?.id, menu.id);
  await handle(s, cb(12, "bytype:video", menu.id), 42, send);
  assert.match(out.at(-1)!.text, /^Відео · 1\/2/);
  await handle(s, cb(13, "library:menu", menu.id), 42, send);
  assert.equal(out.at(-1)!.text, "Що показати?");
});

test("help is one message whose topic buttons swap the text", async () => {
  const { s, out, send } = harness();
  await handle(s, msg(1, "/help"), 42, send);
  const first = out.at(-1)!;
  assert.ok(labels(first.k).includes("Пошук"));
  await handle(s, cb(2, "help:find", first.id), 42, send);
  assert.match(out.at(-1)!.text, /^Пошук\n/);
  assert.equal(out.at(-1)!.o?.edit?.id, first.id);
  assert.ok(labels(out.at(-1)!.k).includes("← Зміст"));
  await handle(s, cb(3, "help:index", first.id), 42, send);
  assert.equal(out.at(-1)!.text, first.text);
  assert.ok(!out.some((o) => /Відьмак/.test(o.text)));
});

test("help lists every command and «Довідка» is always on the keyboard", async () => {
  const { s, out, send } = harness();
  await handle(s, msg(1, "/start"), 42, send);
  const hello = out.at(-2)!;
  assert.deepEqual(hello.k.keyboard, [
    ["Щоденник", "Ідея", "Довідка"],
    ["Бібліотека", "Запитати", "Експорт"],
  ]);
  const index = out.at(-1)!.text;
  for (const { command, description } of commands)
    assert.ok(index.includes(`/${command} — ${description}`), command);
  // The button is the same as the command.
  await handle(s, msg(2, "Довідка"), 42, send);
  assert.equal(out.at(-1)!.text, index);
  // Inside a dialog the keyboard keeps it too.
  await handle(s, msg(3, "/idea"), 42, send, undefined, { journal: new JournalStore(":memory:") });
  assert.ok(out.at(-1)!.k.keyboard.flat().includes("Довідка"));
  // The keyboard buttons are the same as /diary and /idea (bare /idea waits for the next message).
  await handle(s, msg(4, "Ідея"), 42, send, undefined, { journal: new JournalStore(":memory:") });
  assert.match(out.at(-1)!.text, /наступним повідомленням/);
  await handle(s, msg(5, "Щоденник"), 42, send, undefined, { journal: new JournalStore(":memory:") });
  assert.match(out.at(-1)!.text, /Щоденник/);
});

test("AI gets the existing tags; /enrich re-tags items done by the older prompt", async () => {
  const { s, out, send } = harness();
  const known = s.capture(1, "https://example.com/a");
  s.patch(known, { tags: ["штучний інтелект"], ai_done: 2 });
  const old = s.capture(2, "https://example.com/b");
  s.patch(old, { tags: ["ai"], ai_done: true });
  const contexts: AnalysisContext[] = [];
  const ai = async (c: AnalysisContext) => (
    contexts.push(c),
    { question: null, type: null, tags: ["штучний інтелект", "новини"] }
  );
  await handle(s, msg(3, "/enrich"), 42, send, ai);
  assert.equal(contexts.length, 1);
  assert.ok(contexts[0].knownTags!.includes("штучний інтелект"));
  assert.deepEqual(s.item(old)!.tags, ["штучний інтелект", "новини"]);
  assert.match(out.at(-1)!.text, /Оновлено 1 з 1/);
});
