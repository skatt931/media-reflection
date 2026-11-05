import { Store } from "./store.ts";
import { types, statuses, reactions, validDate, localDate } from "./fields.ts";
import type { JSONRequest } from "./groq.ts";
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
export function retrieve(s: Store, plan: SearchPlan) {
  const notes = new Map<string, string[]>();
  for (const r of s.all("SELECT item_id,body FROM reflections"))
    notes.set(r.item_id, [...(notes.get(r.item_id) ?? []), r.body]);
  return s
    .items()
    .map((item) => {
      const text = [
        item.title,
        item.creator,
        item.summary,
        item.description,
        item.source,
        types[item.type],
        ...(item.tags ?? []),
        ...(item.entities ?? []),
        ...(notes.get(item.id) ?? []),
      ]
        .join(" ")
        .toLocaleLowerCase();
      const score = plan.terms.reduce((n, t) => n + (text.includes(t.toLocaleLowerCase()) ? 1 : 0), 0);
      const date = item.consumed_on ?? localDate(new Date(item.created_at));
      const match =
        (!plan.terms.length || score > 0) &&
        (!plan.types.length || plan.types.includes(item.type)) &&
        (!plan.reaction || item.reaction === plan.reaction) &&
        (!plan.status || item.status === plan.status) &&
        (!plan.from || date >= plan.from) &&
        (!plan.to || date <= plan.to);
      const preference = plan.best
        ? item.reaction === "positive"
          ? 2
          : item.reaction === "negative"
            ? -1
            : 0
        : 0;
      return { item, match, score: score + preference * 100 };
    })
    .filter((r) => r.match)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)
    .map((r) => r.item);
}
export function createSearch(s: Store, request?: JSONRequest): Ask {
  return async (query, history, previous) => {
    const bounded = query.slice(0, 1000);
    const recent = history.slice(-3).map((q) => q.slice(0, 600));
    let value: any = null;
    try {
      value = await request?.(
        "library_query",
        "Перетвори запит до ОСОБИСТОЇ збереженої медіатеки на фільтри. Не шукай в інтернеті. Врахуй попередні запитання й previous для фраз «а тільки відео», «які з них сподобалися». terms — до 8 альтернативних слів/фраз/синонімів/назв (напр. Відьмак і Witcher), між ними OR. Не включай загальні слова «контент», «інформація», «найкращий», «відео», якщо вони вже виражені фільтром. Якщо лише метадані — terms порожні. КРИТИЧНО: «чи зберігав», «збережене» стосуються всієї бібліотеки, НЕ status=saved. saved означає лише явно «на потім». Не вгадуй тип зі знання про назву: Witcher може бути відео, статтею чи грою. Коли тип не обмежено, types=[] (НЕ unknown). from/to — дати YYYY-MM-DD або null. best=true тільки для запиту кращих; не вигадуй оцінку. limit від 1 до 10.",
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
    const typeEvidence: Record<string, RegExp> = {
      video: /відео|ролик|video/,
      film: /фільм|кіно|movie|film/,
      series: /серіал|series/,
      music_track: /трек|пісн|track|song/,
      music_album: /альбом|album/,
      podcast: /подкаст|podcast/,
      game: /ігр|гри|гру|гра[ .?!]|game/,
      article: /статт|статей|article/,
      book: /книг|книж|book/,
      social_post: /допис|пост|post/,
      other: /інше|інші|other/,
      unknown: /невідом|без категор|unknown/,
    };
    plan.types = plan.types.filter((t) => previous?.types.includes(t) || typeEvidence[t]?.test(evidence));
    if (
      plan.status === "saved" &&
      previous?.status !== "saved" &&
      !/на потім|хочу (подив|перегл|проч|послух|погра)|to.watch|to.read/.test(evidence)
    )
      plan.status = null;
    const candidates = retrieve(s, plan);
    if (!candidates.length)
      return {
        text: "Нічого не знайшов.",
        ids: [],
        plan,
      };
    let ids = candidates.slice(0, plan.limit).map((i) => i.id as string);
    let text = valid ? "Знайшов:" : "AI недоступний, результати простого пошуку:";
    if (request && valid) {
      try {
        const answer = await request(
          "library_answer",
          "Відповідай коротко на запит за наданими записами особистої бібліотеки. Не додавай зовнішніх фактів. Врахуй історію уточнень. Поверни ids лише релевантних записів із candidates, максимум limit. Якщо даних замало — скажи про це; не роби висновок, що тема відсутня в усій бібліотеці. Не вигадуй уподобання, оцінки чи об’єктивний рейтинг. text — максимум 3 речення, без URL і Markdown-посилань; картки з джерелами додасть застосунок.",
          {
            query: bounded,
            history: recent,
            limit: plan.limit,
            candidates: candidates.map((i) => ({
              id: i.id,
              title: i.title.slice(0, 200),
              type: i.type,
              reaction: i.reaction,
              summary: i.summary?.slice(0, 400) ?? null,
              tags: i.tags,
              notes: s
                .reflections(i.id)
                .slice(-2)
                .map((n) => n.body.slice(0, 400)),
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
        }
      } catch {
        /* Retain local results when generation is unavailable. */
      }
    }
    return { text, ids, plan };
  };
}
