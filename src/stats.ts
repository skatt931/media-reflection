import { Store } from "./store.ts";
import { localDate, localTime, types, liked } from "./fields.ts";

// Month and year in review. Everything is computed locally from SQLite; nothing is sent anywhere.
// A period is "2026-11" (month) or "2026" (year), in the local TIMEZONE.

type Row = Record<string, any>;
export type Slide = { heading: string; lines: string[] };
export type Review = { period: string; title: string; slides: Slide[] };

const months = [
  "Січень",
  "Лютий",
  "Березень",
  "Квітень",
  "Травень",
  "Червень",
  "Липень",
  "Серпень",
  "Вересень",
  "Жовтень",
  "Листопад",
  "Грудень",
];
const weekdays = ["у неділю", "у понеділок", "у вівторок", "у середу", "у четвер", "у п'ятницю", "у суботу"];
const dayPart = (hour: number) =>
  hour < 5 || hour >= 23 ? "вночі" : hour < 12 ? "вранці" : hour < 18 ? "вдень" : "ввечері";

export const typeLabel = (type: string) => (types[type] && type !== "unknown" ? types[type] : types.other);

// "Відео 3 · Допис 2 · Інше 1": most frequent first, «Інше» last.
export function breakdown(items: Row[]) {
  const counts = new Map<string, number>();
  for (const i of items) counts.set(typeLabel(i.type), (counts.get(typeLabel(i.type)) ?? 0) + 1);
  return [...counts]
    .sort((a, b) => Number(a[0] === types.other) - Number(b[0] === types.other) || b[1] - a[1])
    .map(([type, n]) => `${type} ${n}`)
    .join(" · ");
}

export function periodTitle(period: string) {
  return period.length === 4
    ? `${period} рік`
    : `${months[Number(period.slice(5)) - 1]} ${period.slice(0, 4)}`;
}
export function previousPeriod(period: string) {
  if (period.length === 4) return String(Number(period) - 1);
  const [y, m] = period.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}
export const validPeriod = (period: string) => /^\d{4}(-(0[1-9]|1[0-2]))?$/.test(period);

const day = (iso: string) => localDate(new Date(iso));
const top = <T>(map: Map<T, number>, n: number, min = 1) =>
  [...map]
    .filter(([, v]) => v >= min)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
function count<T>(values: T[]) {
  const map = new Map<T, number>();
  for (const v of values) map.set(v, (map.get(v) ?? 0) + 1);
  return map;
}
const short = (text: string, max = 60) => (text.length > max ? text.slice(0, max - 1) + "…" : text);
function domain(url: string | null) {
  try {
    return new URL(url!).hostname.replace(/^(www|open|m|music|mobile)\./, "");
  } catch {
    return null;
  }
}
// Items whose page was never fetched still have the URL as title; show "Трек · spotify.com" instead.
export const displayTitle = (i: Row) =>
  i.url && i.title === i.url ? `${typeLabel(i.type)} · ${domain(i.url) ?? i.url}` : (i.title as string);

export function review(
  s: Store,
  period: string,
  name: (item: Row) => string = (i) => `«${short(displayTitle(i))}»`,
): Review | null {
  const inside = (iso: string) => day(iso).startsWith(period);
  const before = (iso: string) => day(iso) < period;
  const all = s.items();
  // Oldest first, so ties and name spellings follow the order things were saved in.
  const items = all.filter((i) => inside(i.created_at)).reverse();
  if (!items.length) return null;
  const year = period.length === 4;
  const previous = all.filter((i) => day(i.created_at).startsWith(previousPeriod(period)));
  const reflections = s.all("SELECT * FROM reflections ORDER BY created_at");
  const captures = s.all("SELECT * FROM captures ORDER BY created_at");
  const events = s.all("SELECT * FROM events ORDER BY at").filter((e) => inside(e.at));
  const byId = new Map(all.map((i) => [i.id, i]));
  const notesIn = reflections.filter((r) => inside(r.created_at));
  const notesPer = count(notesIn.map((r) => r.item_id as string));
  const slides: Slide[] = [];

  // 1. What was saved, and how the mix changed.
  {
    const lines = [
      `Збережено: ${items.length}` +
        (previous.length ? ` (${year ? "минулого року" : "минулого місяця"} — ${previous.length})` : ""),
      `Типи: ${breakdown(items)}`,
    ];
    const sources = top(count(items.map((i) => domain(i.url)).filter((x): x is string => Boolean(x))), 3);
    if (sources.length) lines.push(`Джерела: ${sources.map(([k, v]) => `${k} ${v}`).join(" · ")}`);
    if (previous.length >= 5) {
      const now = count(items.map((i) => typeLabel(i.type)));
      const then = count(previous.map((i) => typeLabel(i.type)));
      const [grew] = [...now]
        .map(([k, v]) => [k, v - (then.get(k) ?? 0)] as const)
        .sort((a, b) => b[1] - a[1]);
      if (grew && grew[1] >= 2) lines.push(`Більше, ніж зазвичай: ${grew[0]} (+${grew[1]})`);
    }
    slides.push({ heading: "Що зберіг", lines });
  }

  // Favourites: everything marked ❤️ in the period.
  const loved = items.filter((i) => i.reaction === "loved");
  if (loved.length)
    slides.push({ heading: "Улюблене ❤️", lines: loved.slice(0, 10).map((i) => `• ${name(i)}`) });

  // 2. What you liked, and which types tend to work for you.
  {
    const reacted = items.filter((i) => i.reaction);
    const lines: string[] = [];
    if (reacted.length) {
      const r = count(reacted.map((i) => i.reaction));
      lines.push(
        (loved.length ? `❤️ ${loved.length} · ` : "") +
          `👍 ${r.get("positive") ?? 0} · 😐 ${r.get("mixed") ?? 0} · 👎 ${r.get("negative") ?? 0}`,
      );
      const best = items
        .filter((i) => i.reaction === "positive")
        .sort((a, b) => (notesPer.get(b.id) ?? 0) - (notesPer.get(a.id) ?? 0))
        .slice(0, year ? 5 : 3);
      if (best.length) lines.push("Найкраще:", ...best.map((i) => `• ${name(i)}`));
    }
    // Taste is measured over everything up to the end of the period, so small months still say something.
    const history = all.filter((i) => i.reaction && day(i.created_at).slice(0, period.length) <= period);
    const taste = [...count(history.map((i) => typeLabel(i.type)))]
      .filter(([, n]) => n >= 3)
      .map(([type, n]) => {
        const likes = history.filter((i) => typeLabel(i.type) === type && liked(i.reaction)).length;
        return { type, n, liked: likes, share: likes / n };
      })
      .sort((a, b) => b.share - a.share);
    if (taste.length >= 2) {
      const [hi, lo] = [taste[0], taste.at(-1)!];
      if (hi.share > lo.share)
        lines.push(
          `Найчастіше подобається: ${hi.type} (${hi.liked} з ${hi.n})`,
          `Найрідше: ${lo.type} (${lo.liked} з ${lo.n})`,
        );
    }
    if (lines.length) slides.push({ heading: "Що сподобалось", lines });
  }

  // 3. Topics, new interests, names that show up across types, authors.
  {
    const lines: string[] = [];
    const tags = count(items.flatMap((i) => (i.tags ?? []) as string[]));
    const topics = top(tags, year ? 8 : 5);
    if (topics.length) lines.push(`Теми: ${topics.map(([t]) => t).join(", ")}`);
    const earlier = new Set(all.filter((i) => before(i.created_at)).flatMap((i) => i.tags ?? []));
    const fresh = top(tags, 3, 2).filter(([t]) => !earlier.has(t));
    if (fresh.length && all.some((i) => before(i.created_at)))
      lines.push(`Нове: ${fresh.map(([t]) => t).join(", ")}`);
    const names = new Map<string, { label: string; types: Set<string>; n: number }>();
    for (const i of items)
      for (const e of new Set<string>(i.entities ?? [])) {
        const key = e.toLocaleLowerCase("uk");
        const entry = names.get(key) ?? { label: e, types: new Set(), n: 0 };
        entry.types.add(typeLabel(i.type).toLocaleLowerCase("uk"));
        entry.n++;
        names.set(key, entry);
      }
    const across = [...names.values()]
      .filter((x) => x.types.size >= 2)
      .sort((a, b) => b.n - a.n)
      .slice(0, 3);
    for (const x of across) lines.push(`${x.label}: ${[...x.types].join(", ")}`);
    const authors = top(count(items.map((i) => i.creator as string).filter(Boolean)), 3, 2);
    if (authors.length) lines.push(`Автори: ${authors.map(([a, n]) => `${a} (${n})`).join(", ")}`);
    if (lines.length) slides.push({ heading: "Теми й імена", lines });
  }

  // 4. Habits: when you save, what you came back to, how much you wrote.
  {
    const lines: string[] = [];
    const saves = captures.filter((c) => inside(c.created_at));
    if (saves.length >= 5) {
      const days = top(count(saves.map((c) => new Date(day(c.created_at) + "T12:00:00Z").getUTCDay())), 1);
      const parts = top(
        count(saves.map((c) => dayPart(Number(localTime(new Date(c.created_at)).slice(0, 2))))),
        1,
      );
      lines.push(`Найчастіше зберігаєш ${weekdays[days[0][0]]}, ${parts[0][0]}`);
    }
    const seen = items.filter((i) => i.type !== "resource" && i.status !== "saved");
    const withNote = seen.filter((i) => notesPer.has(i.id) || i.reaction).length;
    lines.push(`Думок: ${notesIn.length} · з враженням ${withNote} з ${seen.length}`);
    const [most] = top(notesPer, 1, 2);
    if (most && byId.has(most[0])) lines.push(`Найбільше написав про ${name(byId.get(most[0])!)}`);
    const repeats = top(count(captures.map((c) => c.item_id as string)), 3, 2).filter(([id]) =>
      saves.some((c) => c.item_id === id),
    );
    for (const [id, n] of repeats) if (byId.has(id)) lines.push(`Зберіг ${n}×: ${name(byId.get(id)!)}`);
    const revisited = [...new Set(notesIn.map((r) => r.item_id as string))]
      .map((id) => byId.get(id))
      .filter((i) => i && before(i.created_at))
      .slice(0, 3);
    for (const i of revisited) lines.push(`Згадав старе: ${name(i!)}`);
    slides.push({ heading: "Звички", lines });
  }

  // 5. The «На потім» backlog.
  {
    const lines: string[] = [];
    const added = new Set([
      ...items.filter((i) => i.status === "saved").map((i) => i.id),
      ...events.filter((e) => e.field === "status" && e.new === "saved").map((e) => e.item_id),
    ]).size;
    const done = events.filter((e) => e.field === "status" && e.old === "saved" && e.new !== "saved").length;
    if (added || done) lines.push(`Додано: ${added} · переглянуто: ${done}`);
    const backlog = all.filter((i) => i.status === "saved");
    if (backlog.length) {
      const oldest = backlog.at(-1)!;
      lines.push(`Зараз у списку: ${backlog.length}`);
      lines.push(
        `Найдовше чекає: ${name(oldest)} (з ${day(oldest.created_at).split("-").reverse().join(".")})`,
      );
      const stale = backlog.filter((i) => Date.now() - Date.parse(i.created_at) > 90 * 86400000).length;
      if (stale) lines.push(`Довше 3 місяців: ${stale}. Може, час видалити?`);
    }
    if (lines.length) slides.push({ heading: "На потім", lines });
  }

  // Year only: month by month, first and last.
  if (year) {
    const perMonth = count(items.map((i) => Number(day(i.created_at).slice(5, 7))));
    const [busiest] = top(perMonth, 1);
    const ordered = [...items].sort((a, b) => a.created_at.localeCompare(b.created_at));
    slides.push({
      heading: "Місяць за місяцем",
      lines: [
        [...perMonth]
          .sort((a, b) => a[0] - b[0])
          .map(([m, n]) => `${months[m - 1].slice(0, 3).toLocaleLowerCase("uk")} ${n}`)
          .join(" · "),
        `Найактивніший: ${months[busiest[0] - 1].toLocaleLowerCase("uk")} (${busiest[1]})`,
        `Перший запис: ${name(ordered[0])}`,
        `Останній: ${name(ordered.at(-1)!)}`,
      ],
    });
  }

  return { period, title: periodTitle(period), slides };
}

export const slideText = (r: Review, index: number) =>
  `${r.title} · ${index + 1}/${r.slides.length}\n\n${r.slides[index].heading}\n\n${r.slides[index].lines.join("\n")}`;

export const reviewMarkdown = (r: Review) =>
  `# ${r.title}\n\n[[Медіатека/Медіатека|← Медіатека]]\n\n` +
  r.slides
    .map(
      (x) =>
        `## ${x.heading}\n\n${x.lines.map((l) => (l.startsWith("• ") ? `  - ${l.slice(2)}` : `- ${l}`)).join("\n")}`,
    )
    .join("\n\n")
    .replace(/</g, "&lt;") +
  "\n\n";

// Periods that have at least one item, newest first.
export function periods(s: Store) {
  const months = new Set(s.items().map((i) => day(i.created_at).slice(0, 7)));
  const years = new Set([...months].map((m) => m.slice(0, 4)));
  return { months: [...months].sort().reverse(), years: [...years].sort().reverse() };
}
