import { Store } from "./store.ts";
import { types, statuses, reactions, liked, validDate, localDate } from "./fields.ts";
import type { JSONRequest } from "./groq.ts";
import { fold, matches } from "./words.ts";
export type SearchPlan = {
  terms: string[];
  types: string[];
  reaction: string | null;
  status: string | null;
  from: string | null;
  to: string | null;
  best: boolean;
  limit: number;
};
export type SearchResult = { text: string; ids: string[]; plan: SearchPlan };
export type Ask = (query: string, history: string[], previous?: SearchPlan) => Promise<SearchResult>;
const words = (text: string) =>
  text
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(
      (w) =>
        w.length > 2 &&
        ![
          "які",
          "мене",
          "мені",
          "про",
          "щось",
          "інформацію",
          "зберігав",
          "тільки",
          "покажи",
          "будь",
          "ласка",
          "what",
          "the",
          "have",
          "you",
          "some",
        ].includes(w),
    );
// Items that pass the filters, best matches first. With fill, items without a word match
// follow, so the AI can still find them by meaning (e.g. tags in another language).
export function retrieve(s: Store, plan: SearchPlan, max = 10, fill = false) {
  const notes = new Map<string, string[]>();
  for (const r of s.all("SELECT item_id,body FROM reflections"))
    notes.set(r.item_id, [...(notes.get(r.item_id) ?? []), r.body]);
  return s
    .items()
    .map((item) => {
      const text = fold(
        [
          item.title,
          item.creator,
          item.summary,
          item.description,
          item.source,
          types[item.type],
          ...(item.tags ?? []),
          ...(item.entities ?? []),
          ...(notes.get(item.id) ?? []),
        ].join(" "),
      );
      const score = plan.terms.reduce((n, t) => n + (matches(text, t) ? 1 : 0), 0);
      const date = item.consumed_on ?? localDate(new Date(item.created_at));
      const found = !plan.terms.length || score > 0;
      const match =
        (found || fill) &&
        (!plan.types.length || plan.types.includes(item.type)) &&
        (!plan.reaction ||
          item.reaction === plan.reaction ||
          (plan.reaction === "positive" && liked(item.reaction))) &&
        (!plan.status || item.status === plan.status) &&
        (!plan.from || date >= plan.from) &&
        (!plan.to || date <= plan.to);
      const preference = plan.best
        ? item.reaction === "loved"
          ? 3
          : item.reaction === "positive"
            ? 2
            : item.reaction === "negative"
              ? -1
              : 0
        : 0;
      return { item, match, found, score: (found ? 1000 : 0) + score + preference * 100 };
    })
    .filter((r) => r.match)
    .sort((a, b) => b.score - a.score)
    .slice(0, max)
    .map((r) => Object.assign(r.item, { found: r.found }));
}
export function createSearch(s: Store, request?: JSONRequest): Ask {
  return async (query, history, previous) => {
    const bounded = query.slice(0, 1000);
    const recent = history.slice(-3).map((q) => q.slice(0, 600));
    let value: any = null;
    try {
      value = await request?.(
        "library_query",
        "Перетвори запит до ОСОБИСТОЇ збереженої медіатеки на фільтри. Не шукай в інтернеті. Врахуй попередні запитання й previous для фраз «а тільки відео», «які з них сподобалися». terms — до 8 альтернативних слів/фраз/синонімів/назв (напр. «штучний інтелект», «AI», «ШІ» або Відьмак і Witcher), між ними OR. Не включай загальні слова «контент», «інформація», «найкращий», «відео», якщо вони вже виражені фільтром. Якщо лише метадані — terms порожні. КРИТИЧНО: «чи зберігав», «збережене» стосуються всієї бібліотеки, НЕ status=saved. saved означає лише явно «на потім». Не вгадуй тип зі знання про назву: Witcher може бути відео, статтею чи грою. Коли тип не обмежено, types=[] (НЕ unknown). from/to — дати YYYY-MM-DD або null. best=true тільки для запиту кращих; не вигадуй оцінку. reaction: positive — «сподобалось» (включає улюблене), loved — лише «улюблене», «❤️». limit від 1 до 10.",
        {
          query: bounded,
          history: recent,
          previous: previous ?? null,
          today: localDate(),
        },
        {
          terms: { type: "array", items: { type: "string" } },
          types: {
            type: "array",
            items: { type: "string", enum: Object.keys(types) },
          },
          reaction: {
            type: ["string", "null"],
            enum: [...Object.keys(reactions), null],
          },
          status: {
            type: ["string", "null"],
            enum: [...Object.keys(statuses), null],
          },
          from: { type: ["string", "null"] },
          to: { type: ["string", "null"] },
          best: { type: "boolean" },
          limit: { type: "integer" },
        },
      );
    } catch {
      value = null;
    }
    const valid =
      value &&
      Array.isArray(value.terms) &&
      value.terms.every((x: unknown) => typeof x === "string") &&
      Array.isArray(value.types) &&
      value.types.every((x: string) => Object.hasOwn(types, x)) &&
      (value.reaction === null || Object.hasOwn(reactions, value.reaction)) &&
      (value.status === null || Object.hasOwn(statuses, value.status));
    const plan: SearchPlan = valid
      ? {
          terms: value.terms
            .map((x: string) => x.trim().slice(0, 100))
            .filter(Boolean)
            .slice(0, 8),
          types: value.types,
          reaction: value.reaction,
          status: value.status,
          from: validDate(value.from ?? "") ? value.from : null,
          to: validDate(value.to ?? "") ? value.to : null,
          best: value.best === true,
          limit: Math.min(10, Math.max(1, Number(value.limit) || 5)),
        }
      : {
          terms: words(bounded),
          types: [],
          reaction: null,
          status: null,
          from: null,
          to: null,
          best: false,
          limit: 5,
        };
    const evidence = [...recent, bounded].join(" ").toLocaleLowerCase();
    // The AI may guess a type from what it knows about a title («Witcher» is a game), so a type
    // filter is kept only when the query itself names the kind of media.
    const music = /музи[кц]|слухав|послухат|music|listen/;
    const typeEvidence: Record<string, RegExp> = {
      video: /відео|ролик|ютуб|youtube|video|reels|рілс/,
      film: /фільм|кіно|movie|film/,
      series: /серіал|series|show/,
      music_track: new RegExp(`трек|пісн|track|song|${music.source}`),
      music_album: new RegExp(`альбом|album|${music.source}`),
      podcast: /подкаст|podcast/,
      game: /ігр|гри|гру|гра[ .?!]|game/,
      article: /статт|статей|article|читав|почитат/,
      book: /книг|книж|book/,
      social_post: /допис|пост|тред|post|threads|instagram|інстаграм|соцмереж/,
      resource: /ресурс|сайт|інструмент|сервіс|галере|довідник|натхнен|resource|site|tool|website/,
      other: /інше|інші|other/,
      unknown: /невідом|без категор|unknown/,
    };
    plan.types = plan.types.filter((t) => previous?.types.includes(t) || typeEvidence[t]?.test(evidence));
    // «Музика» covers both tracks and albums.
    if (plan.types.some((t) => t.startsWith("music_")) && music.test(evidence))
      plan.types = [...new Set([...plan.types, "music_track", "music_album"])];
    if (
      plan.status === "saved" &&
      previous?.status !== "saved" &&
      !/на потім|хочу (подив|перегл|проч|послух|погра)|to.watch|to.read/.test(evidence)
    )
      plan.status = null;
    // With the AI, it also sees items that pass the filters without a word match and picks by meaning.
    const candidates = retrieve(s, plan, valid && request ? 30 : 10, Boolean(valid && request));
    const local = candidates.filter((i) => i.found);
    if (!candidates.length)
      return {
        text: "Нічого не знайшов.",
        ids: [],
        plan,
      };
    let ids = local.slice(0, plan.limit).map((i) => i.id as string);
    let text = valid ? "Знайшов:" : "AI недоступний, результати простого пошуку:";
    let answered = false;
    if (request && valid) {
      try {
        const answer = await request(
          "library_answer",
          "Відповідай коротко на запит за наданими записами особистої бібліотеки. Не додавай зовнішніх фактів. Врахуй історію уточнень. Поверни ids лише релевантних записів із candidates, максимум limit. wordMatch=false — запис пройшов фільтри, але без збігу слів: бери його, лише якщо він за змістом (теги, summary, назви, notes) справді про те, що питають, зокрема іншою мовою чи синонімом. Якщо даних замало — скажи про це; не роби висновок, що тема відсутня в усій бібліотеці. Не вигадуй уподобання, оцінки чи об’єктивний рейтинг. text — максимум 3 речення, без URL і Markdown-посилань; картки з джерелами додасть застосунок.",
          {
            query: bounded,
            history: recent,
            limit: plan.limit,
            // Kept short: up to 30 of these must fit Groq's free per-minute token limit.
            candidates: candidates.map((i) => ({
              id: i.id,
              title: i.title.slice(0, 120),
              type: i.type,
              creator: i.creator?.slice(0, 60) ?? null,
              reaction: i.reaction,
              wordMatch: i.found,
              summary: i.summary?.slice(0, 200) ?? null,
              tags: i.tags,
              names: (i.entities ?? []).slice(0, 5),
              notes: s
                .reflections(i.id)
                .slice(-2)
                .map((n) => n.body.slice(0, 200)),
            })),
          },
          {
            text: { type: "string" },
            ids: {
              type: "array",
              items: { type: "string", enum: candidates.map((i) => i.id) },
            },
          },
        );
        if (
          answer &&
          typeof answer.text === "string" &&
          Array.isArray(answer.ids) &&
          answer.ids.every((id: unknown) => typeof id === "string" && candidates.some((i) => i.id === id))
        ) {
          ids = [...new Set<string>(answer.ids)].slice(0, plan.limit);
          text = answer.text.replace(/https?:\/\/\S+/g, "").slice(0, 1000);
          answered = true;
        }
      } catch {
        /* Retain local results when generation is unavailable. */
      }
    }
    // Without the AI's judgement, unmatched items are not results.
    if (!answered && !local.length) return { text: "Нічого не знайшов.", ids: [], plan };
    return { text, ids, plan };
  };
}
