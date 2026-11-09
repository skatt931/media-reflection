import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { handle, reviews } from "../src/bot.ts";
import { JournalStore } from "../src/journal.ts";
import { Store } from "../src/store.ts";
import { albumOf, firstSentence, lead, shelfOf } from "../src/miniapp/album.ts";
import { MINIAPP_HOST, startMiniApp } from "../src/miniapp/server.ts";

const at = (date: string) => new Date(`${date}T12:00:00Z`);

function november() {
  const s = new Store(":memory:");
  const journal = new JournalStore(":memory:");
  let n = 0;
  const add = (date: string, title: string, patch: Record<string, unknown> = {}) => {
    const id = s.capture(++n, `https://example.com/${n}`, at(date));
    s.patch(id, { title, ...patch });
    return id;
  };
  const altin = add("2026-11-02", "Altin Gün — Yol", { reaction: "loved" });
  const lullaby = add("2026-11-05", "Lullaby", { reaction: "loved" });
  const talk = add("2026-11-07", "Відео про анімації", { reaction: "positive" });
  const plain = add("2026-11-08", "Без реакції");
  add("2026-10-12", "Жовтневий", { reaction: "loved" });
  s.addReflection(
    100,
    altin,
    "Слухав дорогою додому. Бас тут такий, що його видно, а не лише чутно.",
    at("2026-11-02"),
  );
  s.addReflection(101, lullaby, "Це про осінню атмосферу.", at("2026-11-05"));
  s.addReflection(102, lullaby, "Вікно, чайник і дощ, який нічого від тебе не вимагає.", at("2026-11-06"));
  s.addReflection(103, talk, "Я одразу спробував використати те що побачив в своєму боті.", at("2026-11-07"));
  s.addReflection(104, plain, "Коротко", at("2026-11-08"));
  s.addReflection(105, plain, "Мало що з цього лишилося в пам’яті, але цікаво було.", at("2026-11-08"));
  journal.add({
    date: "2026-11-03",
    body: "Довгий день. Вийшов у двір і довго стояв під липою.",
    source: "bot",
  });
  journal.add({ date: "2026-11-09", body: "Другий запис без крапки в кінці", source: "bot" });
  journal.add({ date: "2026-10-30", body: "Жовтневий запис.", source: "bot" });
  return { s, journal, ids: { altin, lullaby, talk, plain } };
}

test("album: counts, ❤️ covers and diary entries of the month, nothing from other months", () => {
  const { s, journal, ids } = november();
  const album = albumOf(s, journal, "2026-11", "2026-11-09")!;
  assert.equal(album.done, false);
  assert.deepEqual(album.counts, { saved: 4, loved: 2, thoughts: 6, diary: 2 });
  assert.deepEqual(
    album.loved.map((t) => t.id),
    [ids.lullaby, ids.altin],
  );
  assert.equal(album.slots, 6);
  assert.deepEqual(
    album.diary.map((d) => [d.date, d.excerpt]),
    [
      ["2026-11-03", "Довгий день."],
      ["2026-11-09", "Другий запис без крапки в кінці"],
    ],
  );
  assert.equal(album.older, "2026-10");
  assert.equal(album.newer, null);
  assert.equal(albumOf(s, journal, "2026-10", "2026-11-09")!.done, true);
});

test("album: quotes are the owner's own words, one per material, ❤️ first, in the order written", () => {
  const { s, journal, ids } = november();
  const { quotes } = albumOf(s, journal, "2026-11", "2026-11-09")!;
  assert.deepEqual(
    quotes.map((q) => q.id),
    [ids.altin, ids.lullaby, ids.talk, ids.plain],
  );
  assert.equal(quotes[0].body, "Слухав дорогою додому. Бас тут такий, що його видно, а не лише чутно.");
  // Lullaby has two notes: the longer one is chosen.
  assert.equal(quotes[1].body, "Вікно, чайник і дощ, який нічого від тебе не вимагає.");
  assert.equal(quotes[3].body, "Мало що з цього лишилося в пам’яті, але цікаво було.");
  assert.ok(quotes.every((q) => !q.body.includes("Коротко")));
});

test("album: a finished month has no empty places; an open one grows by threes; no items, no album", () => {
  const { s, journal } = november();
  assert.equal(albumOf(s, journal, "2026-11", "2026-12-02")!.slots, 2);
  const open = new Store(":memory:");
  for (let i = 0; i < 6; i++) {
    const id = open.capture(i + 1, `https://example.com/${i}`, at("2026-11-02"));
    open.edit(id, { reaction: "loved" });
  }
  assert.equal(albumOf(open, undefined, "2026-11", "2026-11-09")!.slots, 9);
  assert.equal(albumOf(s, journal, "2026-09", "2026-11-09"), null);
  assert.equal(albumOf(s, journal, "2026-13", "2026-11-09"), null);
  assert.equal(albumOf(s, undefined, "2026-11", "2026-11-09")!.counts.diary, 0);
});

test("shelf: the open month first, finished ones behind it, with a face even without ❤️", () => {
  const { s } = november();
  s.capture(50, "https://example.com/sept", at("2026-09-10"));
  const { albums } = shelfOf(s, "2026-11-09");
  assert.deepEqual(
    albums.map((a) => [a.period, a.done, a.saved, a.loved]),
    [
      ["2026-11", false, 4, 2],
      ["2026-10", true, 1, 1],
      ["2026-09", true, 1, 0],
    ],
  );
  assert.equal(albums[0].thoughts, 6);
  assert.equal(albums[2].tiles.length, 1);
});

test("text helpers: cut at a sentence when there is one, never invent words", () => {
  assert.equal(lead("Коротке.", 50), "Коротке.");
  assert.equal(lead("Перше речення. Друге речення довге-довге-довге.", 30), "Перше речення.");
  assert.equal(lead("слово ".repeat(20).trim(), 30).endsWith("…"), true);
  assert.equal(firstSentence("Один. Два.", 50), "Один.");
  assert.equal(firstSentence("Без крапки", 50), "Без крапки");
});

test("the monthly review carries a button that opens the month's album in the Mini App", async () => {
  const { s } = november();
  const out: any[] = [];
  const send = async (t: string, k?: any) => (out.push({ t, k }), 100 + out.length);
  const was = process.env.MINIAPP_URL;
  try {
    delete process.env.MINIAPP_URL;
    await reviews(s, send, new Date("2026-12-01T10:00:00Z"));
    assert.ok(!JSON.stringify(out[0].k ?? {}).includes("web_app"));
    out.length = 0;
    s.setValue("review:month", "");
    process.env.MINIAPP_URL = "https://mac.tail.ts.net/";
    await reviews(s, send, new Date("2026-12-01T10:00:00Z"));
    const buttons = out[0].k.inline_keyboard.flat();
    const album = buttons.find((b: any) => b.web_app);
    assert.equal(album.text, "Мій альбом місяця");
    assert.equal(album.web_app.url, "https://mac.tail.ts.net/?go=media%2Falbum%2F2026-11");
    // Arrows keep the button.
    await handle(
      s,
      {
        update_id: 900,
        callback_query: {
          from: { id: 42 },
          data: "slide:1",
          message: { message_id: 101, chat: { id: 42, type: "private" } },
        },
      },
      42,
      send,
    );
    assert.ok(
      out
        .at(-1)
        .k.inline_keyboard.flat()
        .some((b: any) => b.web_app),
    );
  } finally {
    if (was === undefined) delete process.env.MINIAPP_URL;
    else process.env.MINIAPP_URL = was;
  }
});

test("albums API: the shelf and a month, with the diary read from the journal; bad periods are 404", async () => {
  const { s, journal } = november();
  const NOW = new Date("2026-11-09T12:00:00Z");
  const fields = {
    auth_date: String(Math.floor(NOW.getTime() / 1000) - 60),
    user: JSON.stringify({ id: 42 }),
  };
  const text = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const hash = createHmac("sha256", createHmac("sha256", "WebAppData").update("1:t").digest())
    .update(text)
    .digest("hex");
  const headers = { authorization: `tma ${new URLSearchParams({ ...fields, hash })}` };
  const server = await startMiniApp({ token: "1:t", owner: 42, store: s, journal, now: () => NOW }, 0);
  assert.ok(server);
  const base = `http://${MINIAPP_HOST}:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal((await fetch(`${base}/api/albums`)).status, 401);
    const shelf = (await (await fetch(`${base}/api/albums`, { headers })).json()) as any;
    assert.deepEqual(
      shelf.albums.map((a: any) => a.period),
      ["2026-11", "2026-10"],
    );
    const album = (await (await fetch(`${base}/api/albums/2026-11`, { headers })).json()) as any;
    assert.equal(album.counts.diary, 2);
    assert.equal(album.quotes.length, 4);
    for (const bad of ["2026-09", "2026", "2026-11-01", "abc"])
      assert.equal((await fetch(`${base}/api/albums/${bad}`, { headers })).status, 404, bad);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
