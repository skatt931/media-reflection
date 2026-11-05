import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.ts";
import { review, slideText } from "../src/stats.ts";
import { handle, reviews, type Out } from "../src/bot.ts";
import { exportVault } from "../src/vault.ts";

const at = (date: string) => new Date(`${date}T12:00:00Z`);
function library(s: Store) {
  let n = 0;
  const add = (date: string, url: string, patch: Record<string, unknown> = {}) => {
    const id = s.capture(++n, url, at(date));
    s.patch(id, patch);
    return id;
  };
  add("2026-10-10", "https://youtube.com/watch?v=old", { tags: ["кіно"] });
  const witcherGame = add("2026-11-02", "https://store.steampowered.com/app/1", {
    title: "Відьмак 3",
    entities: ["Відьмак"],
    tags: ["ігри"],
    reaction: "positive",
  });
  add("2026-11-03", "https://youtube.com/watch?v=a", {
    title: "Огляд серіалу",
    entities: ["відьмак"],
    tags: ["ігри", "серіали"],
    creator: "Канал",
    reaction: "positive",
  });
  add("2026-11-04", "https://youtube.com/watch?v=b", {
    creator: "Канал",
    tags: ["серіали"],
    reaction: "negative",
  });
  const later = add("2026-11-05", "https://example.com/article", { status: "saved" });
  s.capture(++n, "https://store.steampowered.com/app/1", at("2026-11-06"));
  s.addReflection(++n, witcherGame, "дуже сподобалось", at("2026-11-06"));
  s.addReflection(++n, witcherGame, "ще думка", at("2026-11-07"));
  return { later };
}

test("status, reaction and type changes are logged; other edits are not", () => {
  const s = new Store(":memory:");
  const id = s.capture(1, "https://example.com/page");
  s.edit(id, { status: "saved" }, at("2026-11-01"));
  s.edit(id, { reaction: "positive" });
  s.edit(id, { reaction: "positive" });
  s.edit(id, { title: "Інша назва" });
  assert.deepEqual(
    s.all("SELECT field, old, new FROM events").map((e) => ({ ...e })),
    [
      { field: "status", old: "consumed", new: "saved" },
      { field: "reaction", old: null, new: "positive" },
    ],
  );
  s.deleteItem(id);
  assert.equal(s.all("SELECT * FROM events").length, 0);
});

test("month review: mix, likes, topics across types, habits, backlog", () => {
  const s = new Store(":memory:");
  const { later } = library(s);
  s.edit(later, { status: "consumed" }, at("2026-11-08"));
  const r = review(s, "2026-11")!;
  assert.equal(r.title, "Листопад 2026");
  const slide = (heading: string) => r.slides.find((x) => x.heading === heading)?.lines ?? [];
  assert.equal(slide("Що зберіг")[0], "Збережено: 4 (минулого місяця — 1)");
  assert.equal(slide("Що зберіг")[1], "Типи: Відео 2 · Гра 1 · Інше 1");
  assert.equal(slide("Що сподобалось")[0], "👍 2 · 😐 0 · 👎 1");
  assert.equal(slide("Що сподобалось")[2], "• «Відьмак 3»");
  assert.ok(slide("Теми й імена").includes("Нове: ігри, серіали"));
  assert.ok(slide("Теми й імена").includes("Відьмак: гра, відео"));
  assert.ok(slide("Теми й імена").includes("Автори: Канал (2)"));
  assert.ok(slide("Звички").includes("Найбільше написав про «Відьмак 3»"));
  assert.ok(slide("Звички").includes("Зберіг 2×: «Відьмак 3»"));
  assert.equal(slide("На потім")[0], "Додано: 0 · переглянуто: 1");
  assert.match(slideText(r, 0), /^Листопад 2026 · 1\/\d\n\nЩо зберіг\n\nЗбережено: 4/);
  assert.equal(review(s, "2026-09"), null);
});

test("❤️ gets its own favourites slide and counts as liked for taste", () => {
  const s = new Store(":memory:");
  const add = (n: number, url: string, reaction: string) =>
    s.patch(s.capture(n, url, at("2026-11-1" + n)), { reaction, title: `Запис ${n}` });
  add(1, "https://youtube.com/watch?v=1", "loved");
  add(2, "https://youtube.com/watch?v=2", "loved");
  add(3, "https://youtube.com/watch?v=3", "positive");
  add(4, "https://example.com/1", "negative");
  add(5, "https://example.com/2", "mixed");
  add(6, "https://example.com/3", "positive");
  const r = review(s, "2026-11")!;
  assert.deepEqual(r.slides[1], { heading: "Улюблене ❤️", lines: ["• «Запис 1»", "• «Запис 2»"] });
  const likes = r.slides.find((x) => x.heading === "Що сподобалось")!.lines;
  assert.equal(likes[0], "❤️ 2 · 👍 2 · 😐 1 · 👎 1");
  assert.ok(likes.includes("Найчастіше подобається: Відео (3 з 3)"));
  assert.ok(likes.includes("Найрідше: Інше (1 з 3)"));
});

test("year review adds month by month, first and last item", () => {
  const s = new Store(":memory:");
  library(s);
  const r = review(s, "2026")!;
  assert.equal(r.title, "2026 рік");
  assert.deepEqual(r.slides.at(-1), {
    heading: "Місяць за місяцем",
    lines: [
      "жов 1 · лис 4",
      "Найактивніший: листопад (4)",
      "Перший запис: «Відео · youtube.com»",
      "Останній: «Інше · example.com»",
    ],
  });
});

test("reviews are sent once on the 1st after the set time, the year review in January", async () => {
  const s = new Store(":memory:");
  library(s);
  const out: { text: string; o?: Out }[] = [];
  const send = async (text: string, _k?: any, o?: Out) => (out.push({ text, o }), 100 + out.length);
  await reviews(s, send, new Date("2026-11-20T12:00:00Z"));
  assert.match(out[0].text, /^Жовтень 2026/);
  out.length = 0;
  await reviews(s, send, new Date("2026-12-01T07:00:00Z"));
  assert.equal(out.length, 0);
  await reviews(s, send, new Date("2026-12-01T10:00:00Z"));
  await reviews(s, send, new Date("2026-12-02T10:00:00Z"));
  assert.equal(out.length, 1);
  assert.match(out[0].text, /^Листопад 2026/);
  assert.equal(out[0].o?.silent, true);
  await reviews(s, send, new Date("2027-01-01T10:00:00Z"));
  assert.deepEqual(
    out.slice(1).map((x) => x.text.split(" · ")[0]),
    ["2026 рік"],
  );
});

test("/review shows slides in one message; arrows edit it", async () => {
  const s = new Store(":memory:");
  library(s);
  const out: { text: string; k?: any; o?: Out; id: number }[] = [];
  const send = async (text: string, k?: any, o?: Out) => {
    const id = o?.edit?.id ?? 100 + out.length;
    out.push({ text, k, o, id });
    return id;
  };
  const msg = (id: number, text: string) => ({
    update_id: id,
    message: { message_id: id, from: { id: 42 }, chat: { id: 42, type: "private" }, text },
  });
  await handle(s, msg(1, "/review 2026-11"), 42, send);
  const first = out.at(-1)!;
  assert.match(first.text, /^Листопад 2026 · 1\//);
  const next = first.k.inline_keyboard[0][1].callback_data;
  await handle(
    s,
    {
      update_id: 2,
      callback_query: {
        from: { id: 42 },
        data: next,
        message: { message_id: first.id, chat: { id: 42, type: "private" } },
      },
    },
    42,
    send,
  );
  assert.match(out.at(-1)!.text, /^Листопад 2026 · 2\/\d\n\nЩо сподобалось/);
  assert.equal(out.at(-1)!.o?.edit?.id, first.id);
  await handle(s, msg(3, "/review 2019"), 42, send);
  assert.match(out.at(-1)!.text, /немає/);
  await handle(s, msg(4, "/review вчора"), 42, send);
  assert.match(out.at(-1)!.text, /Формат/);
});

test("export writes month and year reviews with links to material notes", () => {
  const dir = mkdtempSync(join(tmpdir(), "reviews-"));
  const vault = join(dir, "vault");
  mkdirSync(join(vault, ".obsidian"), { recursive: true });
  const s = new Store(join(dir, "db.sqlite"));
  try {
    library(s);
    exportVault(s, vault);
    const note = readFileSync(join(vault, "Медіатека", "Підсумки", "2026-11.md"), "utf8");
    assert.match(note, /^# Листопад 2026/);
    assert.match(note, /  - \[\[Матеріали\/Відьмак 3 — .+\|Відьмак 3\]\]/);
    assert.ok(
      readFileSync(join(vault, "Медіатека", "Підсумки", "2026.md"), "utf8").includes("Місяць за місяцем"),
    );
    const overview = readFileSync(join(vault, "Медіатека", "Медіатека.md"), "utf8");
    assert.ok(overview.includes("[[Підсумки/2026-11|Листопад 2026]]"));
    const again = exportVault(s, vault);
    assert.equal(again.conflicts.length, 0);
  } finally {
    s.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
