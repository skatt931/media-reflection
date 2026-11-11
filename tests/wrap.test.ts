import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import type { AddressInfo } from "node:net";
import { Store } from "../src/store.ts";
import type { JSONRequest } from "../src/groq.ts";
import { MINIAPP_HOST, startMiniApp, type MiniAppOptions } from "../src/miniapp/server.ts";
import { makeSpec, plural, saveSpec, wrapFacts, wrapOf, wrapPhotos } from "../src/miniapp/wrap.ts";

const at = (iso: string) => new Date(iso.length === 10 ? `${iso}T12:00:00Z` : iso);
const THOUGHT = "Бас тут такий, що його видно, а не лише чутно.";

// Twelve materials in November: a repeat, a five-day streak, a long wait in «На потім», a late save.
function november(count = 12) {
  const s = new Store(":memory:");
  let n = 0;
  const add = (date: string, title: string, patch: Record<string, unknown> = {}, url = `https://example.com/${n + 1}`) => {
    const id = s.capture(++n, url, at(date));
    s.patch(id, { title, ...patch });
    return id;
  };
  const ids: Record<string, string> = {};
  ids.waited = add("2026-09-20", "Перфект дейз", { status: "saved" });
  s.edit(ids.waited, { status: "consumed" }, at("2026-11-10"));
  ids.loved = add("2026-11-02", "Outer Wilds", { reaction: "loved", tags: ["ігри", "космос"], creator: "Mobius" });
  s.capture(++n, "https://example.com/2", at("2026-11-12"));
  s.capture(++n, "https://example.com/2", at("2026-11-21"));
  for (let i = 0; i < count - 1; i++)
    add(`2026-11-${String(3 + i).padStart(2, "0")}`, `Матеріал ${i}`, {
      tags: ["ігри"],
      creator: i < 2 ? "Mobius" : null,
      type: "video",
    });
  s.capture(++n, "https://example.com/late", at("2026-11-17T01:30:00Z"));
  s.addReflection(900, ids.loved, THOUGHT, at("2026-11-02"));
  s.addReflection(901, ids.waited, "Повернувся до нього з новою думкою.", at("2026-11-11"));
  return { s, ids };
}

test("plural: Ukrainian forms for one, few and many", () => {
  const unit: [string, string, string] = ["матеріал", "матеріали", "матеріалів"];
  assert.deepEqual(
    [1, 2, 5, 11, 21, 22, 25, 101].map((n) => plural(n, unit)),
    ["матеріал", "матеріали", "матеріалів", "матеріалів", "матеріал", "матеріали", "матеріалів", "матеріал"],
  );
});

test("wrap facts: counted from the library, fewer than ten materials make no wrap", () => {
  const { s, ids } = november();
  const facts = wrapFacts(s, "2026-11", "2026-11-30")!;
  assert.equal(facts.saved, 13);
  assert.deepEqual(facts.topics[0], ["ігри", 12]);
  assert.deepEqual(facts.authors, [["Mobius", 3]]);
  assert.deepEqual(
    facts.loved.map((t) => t.id),
    [ids.loved],
  );
  assert.equal(facts.late, "02:30 у вівторок");
  const byId = new Map(facts.facts.map((f) => [f.id.split(":")[0], f]));
  assert.equal(byId.get("repeat")!.n, 3);
  assert.equal(byId.get("repeat")!.rest, "ти зберіг «Outer Wilds»");
  assert.equal(byId.get("waited")!.n, 51);
  assert.equal(byId.get("waited")!.detail, "Збережений 20 вересня, переглянутий 10 листопада.");
  assert.ok(byId.get("streak")!.n >= 10);
  assert.equal(byId.get("revisited")!.n, 1);
  assert.equal(facts.rhythm.flat().reduce((a, b) => a + b, 0), 15);
  assert.equal(wrapFacts(s, "2026-10", "2026-11-30"), null);
  assert.equal(wrapFacts(november(8).s, "2026-11", "2026-11-30"), null);
});

test("wrap facts: no «На потім» wait before status changes were recorded", () => {
  const { s } = november();
  const id = s.capture(500, "https://example.com/old", at("2026-08-01"));
  s.patch(id, { status: "saved" });
  s.edit(id, { status: "consumed" }, at("2026-10-15"));
  for (let i = 0; i < 10; i++) s.capture(600 + i, `https://example.com/oct${i}`, at("2026-10-16"));
  const facts = wrapFacts(s, "2026-10", "2026-11-30")!;
  assert.ok(!facts.facts.some((f) => f.id.startsWith("waited:")));
});

test("wrap spec: AI lines are checked, titles are kept out, thoughts never reach the model", async () => {
  const { s } = november();
  const facts = wrapFacts(s, "2026-11", "2026-11-30")!;
  let sent = "";
  const reply = (answer: Record<string, unknown>): JSONRequest => async (_name, _instruction, input) => {
    sent = JSON.stringify(input);
    return answer;
  };
  const good = await makeSpec(
    facts,
    reply({
      mood: "Місяць ігор",
      moodLine: "Ігри й космос заповнили місяць.",
      numberLine: "Більшість ти зберіг удень.",
      factId: facts.facts[1].id,
      factLine: "Довге очікування «Перфект дейз» скінчилось.",
    }),
    () => 0.5,
  );
  assert.equal(good.mood, "Місяць ігор");
  assert.equal(good.factId, facts.facts[1].id);
  assert.equal(good.factLine, "Довге очікування «Перфект дейз» скінчилось.");
  assert.ok(!sent.includes(THOUGHT));
  assert.ok(sent.includes("Outer Wilds"));

  const wrong = await makeSpec(
    facts,
    reply({
      mood: "Місяць Outer Wilds",
      moodLine: "x".repeat(141),
      numberLine: "Більшість ти зберіг удень.",
      factId: "invented",
      factLine: "Будь-що.",
    }),
    () => 0,
  );
  assert.equal(wrong.mood, null, "a title in the mood");
  assert.equal(wrong.moodLine, null, "too long");
  assert.equal(wrong.numberLine, "Більшість ти зберіг удень.");
  assert.equal(wrong.factId, facts.facts[0].id, "an unknown fact falls back to the seed's pick");
  assert.equal(wrong.factLine, null);

  const plain = await makeSpec(facts, undefined, () => 0);
  assert.equal(plain.mood, null);
  assert.equal(plain.factId, facts.facts[0].id);
  const failed = await makeSpec(facts, async () => null, () => 0);
  assert.equal(failed.factId, facts.facts[0].id);
});

test("wrap: a deleted material takes its fact and the AI line about it along", () => {
  const { s, ids } = november();
  const facts = wrapFacts(s, "2026-11", "2026-11-30")!;
  const waited = facts.facts.find((f) => f.id.startsWith("waited:"))!;
  saveSpec(s, "2026-11", {
    seed: 1,
    createdAt: "2026-11-30T10:00:00.000Z",
    mood: "Місяць ігор",
    moodLine: null,
    numberLine: null,
    factId: waited.id,
    factLine: "Довге очікування.",
  });
  assert.equal(wrapOf(s, "2026-11", "2026-11-30")!.spec!.factLine, "Довге очікування.");
  s.deleteItem(ids.waited);
  const after = wrapOf(s, "2026-11", "2026-11-30")!;
  assert.notEqual(after.spec!.factId, waited.id);
  assert.equal(after.spec!.factLine, null);
  assert.equal(after.spec!.mood, "Місяць ігор");
});

const jpeg = (size = 100) => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(size)]);

test("wrap photos: only base64 JPEGs, one to eight, each of bounded size", () => {
  const ok = wrapPhotos({ images: [jpeg().toString("base64"), jpeg(10).toString("base64")] });
  assert.ok(ok.ok && ok.value.length === 2);
  for (const bad of [
    null,
    {},
    { images: [] },
    { images: Array(9).fill(jpeg().toString("base64")) },
    { images: [Buffer.from("<svg/>").toString("base64")] },
    { images: ["not base64!"] },
    { images: [jpeg(1.6 * 1024 * 1024).toString("base64")] },
    { images: [42] },
  ])
    assert.equal(wrapPhotos(bad).ok, false, JSON.stringify(bad)?.slice(0, 60));
});

function signed(now: Date) {
  const fields = { auth_date: String(Math.floor(now.getTime() / 1000) - 60), user: JSON.stringify({ id: 42 }) };
  const text = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const hash = createHmac("sha256", createHmac("sha256", "WebAppData").update("1:t").digest())
    .update(text)
    .digest("hex");
  return `tma ${new URLSearchParams({ ...fields, hash })}`;
}

async function serve(options: Partial<MiniAppOptions>, run: (base: string, auth: string) => Promise<void>) {
  const NOW = new Date("2026-11-30T12:00:00Z");
  const server = await startMiniApp({ token: "1:t", owner: 42, now: () => NOW, ...options }, 0);
  assert.ok(server);
  try {
    await run(`http://${MINIAPP_HOST}:${(server.address() as AddressInfo).port}`, signed(NOW));
  } finally {
    server.closeAllConnections();
    server.close();
  }
}

test("wraps API: read, generate and keep the spec; unknown months are 404", async () => {
  const { s } = november();
  const request: JSONRequest = async () => ({
    mood: "Місяць ігор",
    moodLine: "Ігри заповнили місяць.",
    numberLine: "Найбільше вдень.",
    factId: "streak",
    factLine: "Щодня щось нове.",
  });
  await serve({ store: s, request }, async (base, auth) => {
    const headers = { authorization: auth };
    assert.equal((await fetch(`${base}/api/wraps/2026-11`)).status, 401);
    const before = (await (await fetch(`${base}/api/wraps/2026-11`, { headers })).json()) as any;
    assert.equal(before.spec, null);
    assert.equal(before.facts.saved, 13);
    const made = (await (await fetch(`${base}/api/wraps/2026-11`, { method: "POST", headers })).json()) as any;
    assert.equal(made.spec.mood, "Місяць ігор");
    const again = (await (await fetch(`${base}/api/wraps/2026-11`, { headers })).json()) as any;
    assert.deepEqual(again.spec, made.spec);
    for (const bad of ["2026-10", "2026-13", "2026", "abc"])
      assert.equal((await fetch(`${base}/api/wraps/${bad}`, { headers })).status, 404, bad);
    assert.equal((await fetch(`${base}/api/wraps/2026-11`, { method: "PATCH", headers })).status, 405);
  });
});

test("wraps API: the cards go to the chat only as checked JPEGs, with their own body limit", async () => {
  const { s } = november();
  const sent: Buffer[][] = [];
  const body = (images: string[]) => JSON.stringify({ images });
  await serve({ store: s, sendPhotos: async (photos) => void sent.push(photos) }, async (base, auth) => {
    const post = (path: string, payload: string, authorization = auth) =>
      fetch(`${base}${path}`, {
        method: "POST",
        headers: { authorization, "content-type": "application/json" },
        body: payload,
      });
    const cards = [jpeg(), jpeg(20)].map((b) => b.toString("base64"));
    assert.equal((await post("/api/wraps/2026-11/photos", body(cards), "tma bad")).status, 401);
    assert.equal((await post("/api/wraps/2026-11/photos", body(["AAAA"]))).status, 400);
    assert.equal((await post("/api/wraps/2026-10/photos", body(cards))).status, 404);
    assert.equal(sent.length, 0);
    const ok = await post("/api/wraps/2026-11/photos", body(cards));
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { sent: 2 });
    assert.deepEqual(sent[0], [jpeg(), jpeg(20)]);
    // Bigger than the rest of the API allows, still fine here; past six megabytes it is refused.
    const large = Array(4).fill(jpeg(900 * 1024).toString("base64"));
    assert.equal((await post("/api/wraps/2026-11/photos", body(large))).status, 200);
    assert.equal((await post("/api/collections", body(large))).status, 413);
    const huge = Array(8).fill(jpeg(1024 * 1024).toString("base64"));
    assert.equal((await post("/api/wraps/2026-11/photos", body(huge))).status, 413);
  });
  await serve({ store: s }, async (base, auth) => {
    const res = await fetch(`${base}/api/wraps/2026-11/photos`, {
      method: "POST",
      headers: { authorization: auth, "content-type": "application/json" },
      body: body([jpeg().toString("base64")]),
    });
    assert.equal(res.status, 503);
  });
  await serve(
    {
      store: s,
      sendPhotos: async () => {
        throw new Error("Telegram down");
      },
    },
    async (base, auth) => {
      const res = await fetch(`${base}/api/wraps/2026-11/photos`, {
        method: "POST",
        headers: { authorization: auth, "content-type": "application/json" },
        body: body([jpeg().toString("base64")]),
      });
      assert.equal(res.status, 502);
    },
  );
});

// Ten plain materials in November, one per day, and nothing else: no repeats, thoughts or waits.
function plain(extra: (s: Store, next: () => number) => void = () => {}) {
  const s = new Store(":memory:");
  let n = 0;
  const next = () => ++n;
  for (let i = 0; i < 10; i++) {
    const id = s.capture(next(), `https://example.com/p${i}`, at(`2026-11-${String(10 + i * 2).padStart(2, "0")}`));
    s.patch(id, { title: `Звичайний ${i}`, type: "video" });
  }
  extra(s, next);
  return s;
}

test("wrap facts: «words» needs 150 written words, «day» needs four saves in one day", () => {
  const few = plain((s) => {
    const [first] = s.items();
    s.addReflection(800, first.id, Array(149).fill("слово").join(" "), at("2026-11-05"));
  });
  assert.ok(!wrapFacts(few, "2026-11", "2026-11-30")!.facts.some((f) => f.id === "words"));

  const many = plain((s) => {
    const [first, second] = s.items();
    s.addReflection(800, first.id, Array(100).fill("слово").join(" ") + " — 5 !!!", at("2026-11-05"));
    s.addReflection(801, second.id, Array(49).fill("ще").join(" "), at("2026-11-06"));
  });
  const words = wrapFacts(many, "2026-11", "2026-11-30")!.facts.find((f) => f.id === "words")!;
  assert.equal(words.n, 150, "a dash and punctuation are not words, a number is");
  assert.equal(words.detail, "2 думки про 2 матеріали.");

  const three = plain((s, next) => {
    const [first] = s.items();
    for (let i = 0; i < 2; i++) s.capture(next(), "https://example.com/p0", at("2026-11-03"));
    s.capture(next(), "https://example.com/p0", at("2026-11-03T15:00:00Z"));
  });
  assert.ok(!wrapFacts(three, "2026-11", "2026-11-30")!.facts.some((f) => f.id === "day"));
  const four = plain((s, next) => {
    for (let i = 0; i < 4; i++) s.capture(next(), `https://example.com/d${i}`, at(`2026-11-03T${10 + i}:00:00Z`));
  });
  const day = wrapFacts(four, "2026-11", "2026-11-30")!.facts.find((f) => f.id === "day")!;
  assert.equal(day.n, 4);
  assert.equal(day.rest, "за один день, 3 листопада");
});

test("wrap facts: previous month, quiet rhythm and a thin month without a peak", () => {
  const { s } = november();
  assert.equal(wrapFacts(s, "2026-11", "2026-11-30")!.previous, null, "nothing saved in October");
  const withOctober = plain((store, next) => {
    for (let i = 0; i < 3; i++) store.capture(next(), `https://example.com/o${i}`, at("2026-10-05"));
  });
  assert.equal(wrapFacts(withOctober, "2026-11", "2026-11-30")!.previous, 3);

  const calm = wrapFacts(plain(), "2026-11", "2026-11-30")!;
  assert.equal(calm.peak, null, "ten saves on ten different days have no cell with two");
  assert.equal(calm.facts.length, 0, "no repeat, streak, thought or busy day: no facts");
});

test("wrap facts: the peak is one cell, a tie between two cells gives none", () => {
  // 2026-11-03 is a Tuesday; plain() already has two Tuesday afternoons (10th, 24th) and one Wednesday (18th): 4 vs 4 in the tie. 12:00Z is 13:00 in Prague: the afternoon.
  const peaked = plain((s, next) => {
    for (let i = 0; i < 2; i++) s.capture(next(), `https://example.com/t${i}`, at("2026-11-03T12:00:00Z"));
  });
  assert.equal(wrapFacts(peaked, "2026-11", "2026-11-30")!.peak, "вівторок вдень");
  const tied = plain((s, next) => {
    for (let i = 0; i < 2; i++) s.capture(next(), `https://example.com/t${i}`, at("2026-11-03T12:00:00Z"));
    for (let i = 0; i < 3; i++) s.capture(next(), `https://example.com/w${i}`, at("2026-11-04T12:00:00Z"));
  });
  assert.equal(wrapFacts(tied, "2026-11", "2026-11-30")!.peak, null);
});

test("wrap facts: after midnight is later than the evening before", () => {
  // Prague is UTC+1 in November (the default TIMEZONE).
  const night = plain((s, next) => {
    s.capture(next(), "https://example.com/n1", at("2026-11-04T22:30:00Z")); // 23:30 on Wednesday
    s.capture(next(), "https://example.com/n2", at("2026-11-04T23:40:00Z")); // 00:40 on Thursday
    s.capture(next(), "https://example.com/n3", at("2026-11-05T08:00:00Z")); // 09:00
  });
  assert.equal(wrapFacts(night, "2026-11", "2026-11-30")!.late, "00:40 у четвер");
  const evening = plain((s, next) => {
    s.capture(next(), "https://example.com/n1", at("2026-11-04T22:30:00Z"));
    s.capture(next(), "https://example.com/n3", at("2026-11-05T08:00:00Z"));
  });
  assert.equal(wrapFacts(evening, "2026-11", "2026-11-30")!.late, "23:30 у середу");
});

test("wrap: a damaged spec in the table reads as no spec, a save overwrites it", () => {
  const { s } = november();
  s.run("INSERT INTO wraps(period, created_at, spec) VALUES (?,?,?)", "2026-11", "2026-11-30T10:00:00.000Z", "{not json");
  const wrap = wrapOf(s, "2026-11", "2026-11-30")!;
  assert.equal(wrap.spec, null);
  assert.equal(wrap.facts.saved, 13);
  saveSpec(s, "2026-11", { seed: 7, createdAt: "2026-11-30T11:00:00.000Z", mood: "Ок", moodLine: null, numberLine: null, factId: null, factLine: null });
  assert.equal(wrapOf(s, "2026-11", "2026-11-30")!.spec!.mood, "Ок");
  assert.equal(s.all("SELECT period FROM wraps").length, 1);
});

test("wraps API: HEAD reads, POST works without Groq, «Ще раз» replaces the spec", async () => {
  const { s } = november();
  let n = 0;
  const request: JSONRequest = async () => ({
    mood: `Місяць ${++n}`,
    moodLine: "Ігри заповнили місяць.",
    numberLine: "Найбільше вдень.",
    factId: "streak",
    factLine: "Щодня щось нове.",
  });
  await serve({ store: s }, async (base, auth) => {
    const headers = { authorization: auth };
    const head = await fetch(`${base}/api/wraps/2026-11`, { method: "HEAD", headers });
    assert.equal(head.status, 200);
    assert.equal(await head.text(), "");
    const made = (await (await fetch(`${base}/api/wraps/2026-11`, { method: "POST", headers })).json()) as any;
    assert.equal(made.spec.mood, null);
    assert.equal(made.spec.moodLine, null);
    assert.equal(made.spec.factLine, null);
    assert.ok(made.facts.facts.some((f: any) => f.id === made.spec.factId), "the fact is picked by the seed");
    assert.equal(made.spec.createdAt, "2026-11-30T12:00:00.000Z");
    assert.equal((await fetch(`${base}/api/wraps/2026-10`, { method: "POST", headers })).status, 404);
  });
  await serve({ store: s, request }, async (base, auth) => {
    const headers = { authorization: auth };
    const post = async () => (await (await fetch(`${base}/api/wraps/2026-11`, { method: "POST", headers })).json()) as any;
    const first = await post();
    const second = await post();
    assert.equal(first.spec.mood, "Місяць 1");
    assert.equal(second.spec.mood, "Місяць 2");
    const read = (await (await fetch(`${base}/api/wraps/2026-11`, { headers })).json()) as any;
    assert.equal(read.spec.mood, "Місяць 2", "the stored spec is the latest one");
    assert.equal(s.all("SELECT period FROM wraps").length, 1);
  });
});

test("wraps API: initData is checked before the large body is read", async () => {
  const { s } = november();
  let sent = 0;
  await serve({ store: s, sendPhotos: async () => void sent++ }, async (base) => {
    const huge = JSON.stringify({ images: Array(8).fill(jpeg(900 * 1024).toString("base64")) });
    for (const authorization of ["", "tma bad"]) {
      const res = await fetch(`${base}/api/wraps/2026-11/photos`, {
        method: "POST",
        headers: { authorization, "content-type": "application/json" },
        body: huge,
      });
      assert.equal(res.status, 401);
    }
    assert.equal(sent, 0);
  });
});

test("wrap: a title named only in a fact's detail stays out of the lines, and its fact goes with the material", async () => {
  const { s, ids } = november();
  const facts = wrapFacts(s, "2026-11", "2026-11-30")!;
  const revisited = facts.facts.find((f) => f.id.startsWith("revisited:"))!;
  assert.equal(revisited.id, `revisited:${ids.waited}`);
  assert.match(revisited.detail, /«Перфект дейз»/);
  const spec = await makeSpec(
    facts,
    async () => ({
      mood: "Перфект дейз і ігри",
      moodLine: "Тихий місяць.",
      numberLine: "Знову Перфект дейз.",
      factId: revisited.id,
      factLine: "Повернувся до «Перфект дейз».",
    }),
    () => 0,
  );
  assert.equal(spec.mood, null);
  assert.equal(spec.numberLine, null);
  assert.equal(spec.moodLine, "Тихий місяць.");
  saveSpec(s, "2026-11", spec);
  s.deleteItem(ids.waited);
  const after = wrapOf(s, "2026-11", "2026-11-30")!;
  assert.ok(!after.facts.facts.some((f) => f.id === revisited.id));
  assert.equal(after.spec!.factLine, null);
});

test("wrap spec: the fact's line may name only its own material", async () => {
  const { s } = november();
  const facts = wrapFacts(s, "2026-11", "2026-11-30")!;
  const streak = facts.facts.find((f) => f.id === "streak")!;
  const repeat = facts.facts.find((f) => f.id.startsWith("repeat:"))!;
  const ask = (factId: string, factLine: string) =>
    makeSpec(facts, async () => ({ mood: "Місяць ігор", moodLine: "", numberLine: "", factId, factLine }), () => 0);
  assert.equal((await ask(streak.id, "Серед них була «Outer Wilds».")).factLine, null);
  assert.equal((await ask(streak.id, "Щодня щось нове.")).factLine, "Щодня щось нове.");
  assert.equal((await ask(repeat.id, "До «Outer Wilds» ти повертався.")).factLine, "До «Outer Wilds» ти повертався.");
  assert.equal((await ask(repeat.id, "Як і «Перфект дейз».")).factLine, null);
});
