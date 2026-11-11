import { addDays, localDate, localTime } from "../fields.ts";
import type { JSONRequest } from "../groq.ts";
import { previousPeriod, typeLabel } from "../stats.ts";
import type { Store } from "../store.ts";
import { albumOf, tileOf } from "./album.ts";
import type { Written } from "./write.ts";
import { bad } from "./write.ts";
import type { Wrap, WrapFact, WrapFacts, WrapSpec } from "./wrap-types.ts";

// Monthly wrap: the month told in a few cards. Every number is counted here, from the media library only
// (the diary is never read). The AI may pick one fact and write a mood and short lines around the numbers;
// it sees numbers, types, tags, authors and titles, never the text of thoughts.
type Row = Record<string, any>;

export const WRAP_MIN = 10;
const MOOD_MAX = 48;
const LINE_MAX = 140;
// Status changes are recorded from 2026-11-05; earlier months would show a partial picture.
const EVENTS_FROM = "2026-11";

const rules = new Intl.PluralRules("uk");
export const plural = (n: number, [one, few, many]: [string, string, string]) =>
  ({ one, few, many })[rules.select(n) as "one" | "few" | "many"] ?? many;

const genitive = [
  "січня",
  "лютого",
  "березня",
  "квітня",
  "травня",
  "червня",
  "липня",
  "серпня",
  "вересня",
  "жовтня",
  "листопада",
  "грудня",
];
const dayMonth = (date: string) => `${Number(date.slice(8))} ${genitive[Number(date.slice(5, 7)) - 1]}`;
// Monday first, as the grid on the card.
const dayNames = ["понеділок", "вівторок", "середа", "четвер", "п’ятниця", "субота", "неділя"];
const onDay = ["у понеділок", "у вівторок", "у середу", "у четвер", "у п’ятницю", "у суботу", "у неділю"];
const partNames = ["вранці", "вдень", "ввечері", "вночі"];

const day = (iso: string) => localDate(new Date(iso));
const monthOf = (iso: string) => day(iso).slice(0, 7);
const weekday = (date: string) => (new Date(`${date}T12:00:00Z`).getUTCDay() + 6) % 7;
// The same bounds as the habits slide of the monthly review.
const part = (hour: number) => (hour < 5 || hour >= 23 ? 3 : hour < 12 ? 0 : hour < 18 ? 1 : 2);
const between = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86400000);
const words = (text: string) => text.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

function count<T>(values: T[]) {
  const map = new Map<T, number>();
  for (const v of values) map.set(v, (map.get(v) ?? 0) + 1);
  return map;
}
const top = <T>(map: Map<T, number>, n: number, min = 1) =>
  [...map]
    .filter(([, v]) => v >= min)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);

function candidates(s: Store, period: string, items: Row[], captures: Row[], notes: Row[]): WrapFact[] {
  const byId = new Map(s.items().map((i) => [i.id as string, i]));
  const facts: (WrapFact & { weight: number })[] = [];

  // Saved the same thing again and again.
  const again = top(count(captures.map((c) => c.item_id as string)), 1, 2)[0];
  if (again && byId.has(again[0])) {
    const own = captures.filter((c) => c.item_id === again[0]).map((c) => day(c.created_at));
    facts.push({
      id: `repeat:${again[0]}`,
      n: again[1],
      unit: ["раз", "рази", "разів"],
      rest: `ти зберіг «${byId.get(again[0])!.title}»`,
      detail: `Перший раз ${dayMonth(own[0])}, востаннє ${dayMonth(own.at(-1)!)}.`,
      weight: 2 + again[1],
    });
  }

  // The longest wait in «На потім» that ended this month.
  if (period >= EVENTS_FROM) {
    const waits = s
      .all("SELECT item_id, at FROM events WHERE field='status' AND old='saved' AND new<>'saved' ORDER BY at")
      .filter((e) => monthOf(e.at) === period && byId.has(e.item_id))
      .map((e) => {
        const item = byId.get(e.item_id)!;
        return { item, from: day(item.created_at), to: day(e.at) };
      })
      .map((w) => ({ ...w, days: between(w.from, w.to) }))
      .filter((w) => w.days >= 7)
      .sort((a, b) => b.days - a.days);
    const w = waits[0];
    if (w)
      facts.push({
        id: `waited:${w.item.id}`,
        n: w.days,
        unit: ["день", "дні", "днів"],
        rest: `чекав «${w.item.title}» у «На потім»`,
        detail: `Збережений ${dayMonth(w.from)}, переглянутий ${dayMonth(w.to)}.`,
        weight: 4,
      });
  }

  // Days in a row with something saved.
  const days = [...new Set(captures.map((c) => day(c.created_at)))].sort();
  let best = { n: 0, from: "", to: "" };
  let run = { n: 0, from: "", to: "" };
  for (const d of days) {
    run = run.n && addDays(run.to, 1) === d ? { ...run, n: run.n + 1, to: d } : { n: 1, from: d, to: d };
    if (run.n > best.n) best = run;
  }
  if (best.n >= 3)
    facts.push({
      id: "streak",
      n: best.n,
      unit: ["день", "дні", "днів"],
      rest: "поспіль ти щось зберігав",
      detail: `З ${dayMonth(best.from)} до ${dayMonth(best.to)}.`,
      weight: best.n >= 5 ? 3 : 1,
    });

  // Coming back to older things with a new thought.
  const older = [...new Set(notes.map((r) => r.item_id as string))].filter(
    (id) => byId.has(id) && monthOf(byId.get(id)!.created_at) < period,
  );
  if (older.length)
    facts.push({
      // Tied to the material it names, so deleting it takes the fact (and the AI line about it) along.
      id: `revisited:${older[0]}`,
      n: older.length,
      unit: ["старий матеріал", "старі матеріали", "старих матеріалів"],
      rest: older.length === 1 ? "отримав нову думку" : "отримали нову думку",
      detail: `Серед них «${byId.get(older[0])!.title}».`,
      weight: 2,
    });

  // How much was written.
  const written = notes.reduce((sum, r) => sum + words(r.body), 0);
  if (written >= 150) {
    const about = new Set(notes.map((r) => r.item_id)).size;
    facts.push({
      id: "words",
      n: written,
      unit: ["слово", "слова", "слів"],
      rest: "ти написав у думках",
      detail: `${notes.length} ${plural(notes.length, ["думка", "думки", "думок"])} про ${about} ${plural(about, ["матеріал", "матеріали", "матеріалів"])}.`,
      weight: 1,
    });
  }

  // The busiest single day.
  const busiest = top(count(captures.map((c) => day(c.created_at))), 1, 4)[0];
  if (busiest)
    facts.push({
      id: "day",
      n: busiest[1],
      unit: ["збереження", "збереження", "збережень"],
      rest: `за один день, ${dayMonth(busiest[0])}`,
      detail: `Більше, ніж будь-якого іншого дня місяця.`,
      weight: 1,
    });

  return facts.sort((a, b) => b.weight - a.weight).map(({ weight, ...fact }) => fact);
}

// Everything the cards show, counted from the library. Null for a month with fewer than WRAP_MIN materials.
export function wrapFacts(s: Store, period: string, today = localDate()): WrapFacts | null {
  const album = albumOf(s, undefined, period, today);
  if (!album || album.counts.saved < WRAP_MIN) return null;
  const all = s.items();
  const items = all.filter((i) => monthOf(i.created_at) === period);
  const before = all.filter((i) => monthOf(i.created_at) === previousPeriod(period)).length;
  const captures = s
    .all("SELECT item_id, created_at FROM captures ORDER BY created_at, update_id")
    .filter((c) => monthOf(c.created_at) === period);
  const notes = s
    .all("SELECT item_id, body, created_at FROM reflections ORDER BY created_at, update_id")
    .filter((r) => monthOf(r.created_at) === period);

  const [type] = top(count(items.filter((i) => i.type !== "unknown").map((i) => typeLabel(i.type))), 1);
  const topics = top(count(items.flatMap((i) => (i.tags ?? []) as string[])), 5);
  const authors = top(count(items.map((i) => i.creator as string).filter(Boolean)), 3, 2);

  const rhythm = Array.from({ length: 4 }, () => Array(7).fill(0) as number[]);
  let late: { key: number; label: string } | null = null;
  for (const c of captures) {
    const time = localTime(new Date(c.created_at));
    const hour = Number(time.slice(0, 2));
    const d = weekday(day(c.created_at));
    rhythm[part(hour)][d]++;
    // After midnight counts as later than the evening before.
    const key = ((hour + 19) % 24) * 60 + Number(time.slice(3, 5));
    if (!late || key > late.key) late = { key, label: `${time.slice(0, 5)} ${onDay[d]}` };
  }
  const cells = rhythm.flatMap((row, r) => row.map((n, d) => ({ n, r, d })));
  const most = Math.max(...cells.map((c) => c.n));
  const peaks = cells.filter((c) => c.n === most);
  const peak = most >= 2 && peaks.length === 1 ? `${dayNames[peaks[0].d]} ${partNames[peaks[0].r]}` : null;

  return {
    period,
    saved: items.length,
    previous: before || null,
    topType: type ? { label: type[0], n: type[1] } : null,
    loved: album.loved,
    latest: items.slice(0, 6).map((i) => tileOf(s, i)),
    topics,
    authors,
    rhythm,
    peak,
    late: late?.label ?? null,
    facts: candidates(s, period, items, captures, notes),
    quotes: album.quotes,
  };
}

const factText = (f: WrapFact) => `${f.n} ${plural(f.n, f.unit)} ${f.rest}`;

const instruction =
  "Ти пишеш підписи до особистого щомісячного підсумку медіатеки, як у Spotify Wrapped, але спокійніше. " +
  "input — уже пораховані дані за місяць: кількість збережених матеріалів, тип, якого найбільше, теми, автори, назви улюбленого, коли найчастіше зберігав і кандидати несподіваних фактів facts (id, текст, деталь). " +
  "Поверни: mood — назва місяця-настрою, 2–5 слів, до 48 символів, без назв матеріалів (наприклад «Місяць повільних речей»); " +
  "moodLine — одне-два речення, що пояснюють настрій через типи й теми; " +
  "numberLine — одне речення про кількість чи ритм збережень; " +
  "factId — id одного найнесподіванішого факту з facts; factLine — одне речення, яке тепло й без оцінок тлумачить саме цей факт. " +
  "Пиши на «ти», без емодзі, без вигуку й без порад. Не вигадуй чисел, яких немає в input, і не згадуй назв матеріалів у mood, moodLine і numberLine. Кожен рядок до 140 символів.";

// A fresh spec: a new seed and, with Groq, the AI lines. Without Groq the cards still work: the fact is picked
// by the seed and there are no AI lines.
export async function makeSpec(
  facts: WrapFacts,
  request?: JSONRequest,
  random = Math.random,
  now = new Date(),
): Promise<WrapSpec> {
  const seed = Math.floor(random() * 2 ** 31);
  const fallback = facts.facts[seed % Math.min(3, facts.facts.length || 1)]?.id ?? null;
  const spec: WrapSpec = {
    seed,
    createdAt: now.toISOString(),
    mood: null,
    moodLine: null,
    numberLine: null,
    factId: fallback,
    factLine: null,
  };
  if (!request) return spec;
  const ids = facts.facts.map((f) => f.id);
  const input = {
    month: facts.period,
    saved: facts.saved,
    previousMonth: facts.previous,
    topType: facts.topType,
    // Tags and authors come from pages: kept short, like the titles.
    topics: facts.topics.map(([t, n]) => [t.slice(0, 60), n]),
    authors: facts.authors.map(([a, n]) => [a.slice(0, 60), n]),
    loved: facts.loved.slice(0, 12).map((t) => t.title.slice(0, 120)),
    peak: facts.peak,
    late: facts.late,
    facts: facts.facts.map((f) => ({ id: f.id, text: factText(f).slice(0, 200), detail: f.detail.slice(0, 200) })),
  };
  const answer = await request(
    "monthly_wrap",
    instruction,
    input,
    {
      mood: { type: "string" },
      moodLine: { type: "string" },
      numberLine: { type: "string" },
      factId: ids.length ? { type: "string", enum: ids } : { type: "string" },
      factLine: { type: "string" },
    },
    { temperature: 0.8 },
  );
  if (!answer || typeof answer !== "object") return spec;
  // Titles may not slip into the lines that stay on every card: a deleted material would live on in them.
  // The line about the chosen fact may name only that fact's own material, which goes away with it.
  const named = (f: WrapFact) => [f.rest, f.detail].flatMap((s) => [...s.matchAll(/«([^»]+)»/g)].map((m) => m[1]));
  // Both the whole title and the start of it the model was shown.
  const forms = (t: string) => [t, t.slice(0, 120), t.slice(0, 30)].map((x) => x.toLocaleLowerCase("uk"));
  const titles = [
    ...new Set(
      [...facts.loved, ...facts.latest]
        .map((t) => t.title)
        .concat(facts.facts.flatMap(named))
        .flatMap(forms)
        .filter((t) => t.length >= 4),
    ),
  ];
  const line = (value: unknown, max: number, allowed: string[] = []) => {
    if (typeof value !== "string") return null;
    const text = value.replace(/\s+/g, " ").trim();
    if (!text || text.length > max) return null;
    const lower = text.toLocaleLowerCase("uk");
    // A title of the fact's own material is allowed, and so are the shorter titles it contains.
    const own = allowed.flatMap(forms);
    const outside = titles.filter((t) => !own.some((o) => o.includes(t)));
    if (outside.some((t) => lower.includes(t))) return null;
    return text;
  };
  const factId = typeof answer.factId === "string" && ids.includes(answer.factId) ? answer.factId : null;
  const chosen = facts.facts.find((f) => f.id === factId);
  return {
    ...spec,
    mood: line(answer.mood, MOOD_MAX),
    moodLine: line(answer.moodLine, LINE_MAX),
    numberLine: line(answer.numberLine, LINE_MAX),
    factId: factId ?? fallback,
    factLine: chosen ? line(answer.factLine, LINE_MAX, named(chosen)) : null,
  };
}

export function storedSpec(s: Store, period: string): WrapSpec | null {
  const row = s.all("SELECT spec FROM wraps WHERE period=?", period)[0];
  if (!row) return null;
  try {
    return JSON.parse(row.spec) as WrapSpec;
  } catch {
    return null;
  }
}

export function saveSpec(s: Store, period: string, spec: WrapSpec) {
  s.run(
    "INSERT INTO wraps(period, created_at, spec) VALUES (?,?,?) ON CONFLICT(period) DO UPDATE SET created_at=excluded.created_at, spec=excluded.spec",
    period,
    spec.createdAt,
    JSON.stringify(spec),
  );
}

// The facts as they are now and the stored spec. A fact that no longer exists (its material was deleted,
// or the month moved on) takes its AI line with it.
export function wrapOf(s: Store, period: string, today = localDate()): Wrap | null {
  const facts = wrapFacts(s, period, today);
  if (!facts) return null;
  const spec = storedSpec(s, period);
  if (spec && spec.factId && !facts.facts.some((f) => f.id === spec.factId))
    return { facts, spec: { ...spec, factId: facts.facts[0]?.id ?? null, factLine: null } };
  return { facts, spec };
}

export async function generateWrap(
  s: Store,
  period: string,
  request?: JSONRequest,
  today = localDate(),
  now = new Date(),
): Promise<Wrap | null> {
  const facts = wrapFacts(s, period, today);
  if (!facts) return null;
  const spec = await makeSpec(facts, request, Math.random, now);
  saveSpec(s, period, spec);
  return { facts, spec };
}

export const WRAP_PHOTOS_MAX = 8;
const PHOTO_MAX = 1.5 * 1024 * 1024;
// The body of the photos route: base64 of up to eight JPEGs. Larger than the rest of the API on purpose.
export const WRAP_BODY_MAX = 6 * 1024 * 1024;

// JPEGs the app made from the cards, checked before anything is sent anywhere.
export function wrapPhotos(input: unknown): Written<Buffer[]> {
  const images = (input as { images?: unknown } | null)?.images;
  if (!Array.isArray(images) || !images.length || images.length > WRAP_PHOTOS_MAX) return bad("images");
  const out: Buffer[] = [];
  for (const image of images) {
    if (typeof image !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(image)) return bad("images");
    const bytes = Buffer.from(image, "base64");
    if (bytes.length > PHOTO_MAX || bytes.length < 4) return bad("images");
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) return bad("images");
    out.push(bytes);
  }
  return { ok: true, value: out };
}
