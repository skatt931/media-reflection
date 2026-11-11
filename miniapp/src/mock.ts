// Dev only (see api.ts): invented entries and ideas, answered by the same code as the server.
// ?mock shows them; ?mock=empty, ?mock=error and ?mock=slow show the other states.
import type { Album, Shelf } from "../../src/miniapp/album-types.ts";
import type { Wrap, WrapSpec } from "../../src/miniapp/wrap-types.ts";
import type { CollectionCard, CollectionView, Tile } from "../../src/miniapp/collection-types.ts";
import {
  diaryEntry,
  diaryList,
  ideaList,
  snippet,
  type DiaryRow,
  type IdeaRow,
} from "../../src/miniapp/data.ts";
import {
  DIARY_ID,
  DIARY_NAME,
  counterDetail,
  counterList,
  type CounterRow,
  type MarkRow,
} from "../../src/miniapp/counter-data.ts";
import type { LibraryCard, LibraryItem, LibraryList } from "../../src/miniapp/library-types.ts";
import { stems } from "../../src/words.ts";
import { NO_REACTION } from "../../src/miniapp/library-types.ts";
import { ApiError } from "./api.ts";
import { isoDate } from "./format.ts";

const mode = new URLSearchParams(location.search).get("mock");

const daysAgo = (n: number) => {
  const now = new Date();
  return isoDate(new Date(now.getFullYear(), now.getMonth(), now.getDate() - n));
};

const diary: DiaryRow[] = [
  [
    2,
    [
      "Прокинувся без будильника, і це вже щось. Вийшов, поки не розвиднілося, дійшов до річки й назад: сорок хвилин, без телефона в руках. Місто о такій годині схоже на чернетку, у якій ще нічого не вирішено і все можна почати заново.",
      "Після обіду розібрав стіл. Знайшов блокнот із літа, де половина сторінок — списки справ, які я давно зробив або вже не хочу робити. Виривати не став, просто закрив.",
    ],
  ],
  [
    8,
    [
      "Тиждень, який здавався порожнім, виявився насиченим. Коли сідаю писати, виходить, що я щодня робив щось невелике, але своє: у вівторок полагодив велосипед, у четвер нарешті подзвонив мамі й говорив майже годину, а в суботу пройшов той маршрут уздовж каналу, який відкладав ще з весни.",
      "Помітив, що найкращі дні в мене ті, де є одна річ, зроблена руками. Не проєкт і не лист, а щось, що можна потримати: ланцюг, змащений і натягнутий як слід, чашка, яку я нарешті склеїв. Робота, після якої видно результат, заспокоює сильніше за відпочинок.",
      "Читаю повільно книжку про те, як люди писали щоденники в тяжкі часи. Вражає не драма, а побут: хто що їв, де брав дрова, як лічив дні. Мабуть, колись і мої записи про каву й погоду комусь здадуться найціннішими.",
      "Хочу спробувати до кінця місяця одну просту звичку: записувати лише одне речення за день, навіть коли немає сил на більше. Не щоб було що перечитувати, а щоб день не зливався з наступним.",
      "Увечері довго дивився у вікно. Нічого не придумав, і це теж був хороший вечір.",
    ],
  ],
  [
    15,
    [
      "Зміна часу забрала годину сну й дала годину світла, якого мені чомусь не потрібно. Увесь день пройшов у дрібницях: розбирав пошту, переписував план на листопад, двічі ставив чайник і забував про нього.",
      "Увечері вийшов просто походити районом. Знайшов двір із липою, повз який проїздив сотню разів і ніколи не зупинявся.",
    ],
  ],
  [
    21,
    [
      "Довга розмова з Тарасом про те, чи треба щось доводити людям, яких давно не бачиш. Дійшли до того, що ні. Лишається просто телефонувати.",
    ],
  ],
  [
    29,
    [
      "Перший холодний ранок. Дістав шарф, який тримав із зими, і він ще пахне шафою. Купив яблук на ринку в бабусі біля входу, вона відважила із запасом і сказала берегти себе. Дрібниця, а ходив із цим цілий день.",
    ],
  ],
  [
    43,
    [
      "Дочитав збірку оповідань, яку мені радили ще навесні. Остання історія зайшла найсильніше, і я зрозумів, що почав її занадто пізно ввечері, тому нічого не пам’ятаю про початок. Перечитаю вранці.",
    ],
  ],
  [
    57,
    [
      "Три години в лісі без жодної мети. Грибів не знайшов, зате знайшов тишу, яка тримається ще й дві доби потому.",
    ],
  ],
  [
    72,
    [
      "Переглянув фото за літо. Їх усього сорок, і половина — небо. Мабуть, я справді тільки те й робив, що дивився вгору.",
    ],
  ],
  [
    120,
    [
      "Купив нове сідло для велосипеда й півдня підбирав висоту. Різниця в два міліметри, а їхати зовсім інакше. Так і з багатьма речами: усе вирішують дрібниці, яких не видно збоку.",
    ],
  ],
  [
    137,
    [
      "Їздив за місто, велосипед тримав добре, а от я до вечора втомився більше, ніж очікував. Спав, як після довгої дороги.",
    ],
  ],
].map(([ago, text], i) => ({
  id: 100 - i,
  entry_date: daysAgo(ago as number),
  body: (text as string[]).join("\n\n"),
}));

const ideas: IdeaRow[] = [
  [
    0,
    "08:12",
    "Тижневий огляд перенести з п’ятниці на неділю ввечері: п’ятниця вже зайнята думками про вихідні.",
  ],
  [0, "07:40", "Спитати Олю про книжку про шрифти, яку вона згадувала."],
  [1, "22:15", "Сфотографувати один і той самий двір у різні пори року."],
  [1, "13:02", "Чому влітку я пишу довше, ніж узимку? Порівняти довжину записів за місяцями."],
  [2, "09:30", "Купити змазку для ланцюга й суху тканину."],
  [4, "18:44", "Спробувати записати підсумок тижня голосовим замість тексту."],
  [5, "12:10", "Маршрут уздовж каналу до мосту. Взяти термос."],
  [7, "21:03", "Одного вечора нічого не планувати й не брати телефон."],
  [12, "19:20", "Зробити полицю для книжок над столом."],
].map(([ago, time, body], i): IdeaRow => ({
  id: 100 - i,
  idea_date: daysAgo(ago as number),
  idea_time: time as string,
  body: body as string,
  resolved_at: i === 8 ? new Date().toISOString() : null,
}));

const labels = {
  types: {
    article: "Стаття",
    podcast: "Подкаст",
    video: "Відео",
    resource: "Ресурс",
    game: "Гра",
    music_album: "Альбом",
  },
  statuses: { saved: "На потім", in_progress: "У процесі", consumed: "Ознайомився", finished: "Завершено" },
  reactions: {
    loved: "Улюблене",
    positive: "Сподобалось",
    mixed: "Змішані враження",
    negative: "Не сподобалось",
  },
};

const material = (
  ago: number,
  title: string,
  type: string,
  creator: string | null,
  source: string,
  status: string | null,
  reaction: string | null,
  tags: string[],
  notes: [number, string][],
): LibraryItem => ({
  id: `m${ago}`,
  title,
  type,
  creator,
  source,
  status,
  reaction,
  date: daysAgo(ago),
  tags,
  cover: false,
  unreviewed: status === "consumed" && notes.length === 0,
  noThought: status !== "saved" && notes.length === 0,
  url: `https://${source}/`,
  summary:
    "Есей про те, як короткі паузи й тиша в інтерфейсі знижують тривогу та роблять рішення усвідомленішими.",
  description: null,
  entities: [],
  impressions: notes.map(([n, body]) => ({ date: daysAgo(n), body })),
  collections: [],
  thought: notes.length ? { body: notes.at(-1)![1], date: daysAgo(notes.at(-1)![0]), hit: false } : null,
  labels,
});

const library: LibraryItem[] = [
  material(
    2,
    "Yol",
    "music_album",
    "Altin Gün",
    "music.example",
    "consumed",
    "loved",
    ["psychedelic", "турецька музика"],
    [
      [
        2,
        "Слухав усю дорогу додому й вперше за місяць нікуди не поспішав. Бас тут такий, що його видно, а не лише чутно.",
      ],
    ],
  ),
  material(
    4,
    "Lullaby: осінь у кімнаті",
    "music_album",
    "Нічний двір",
    "music.example",
    "consumed",
    "loved",
    ["осінь", "ambient"],
    [[4, "Це про осінню атмосферу: вікно, чайник і дощ, який нічого від тебе не вимагає."]],
  ),
  material(
    6,
    "Як анімації оживляють інтерфейс",
    "video",
    "Motion Notes",
    "video.example",
    "consumed",
    "loved",
    ["анімації", "дизайн"],
    [[6, "Я одразу спробував використати те що побачив в своєму боті."]],
  ),
  material(
    1,
    "Повільний дизайн: навіщо інтерфейсам пауза",
    "article",
    "Марта Кравець",
    "longreads.example",
    "consumed",
    "positive",
    ["дизайн", "інтерфейси"],
    [[1, "Найкраща думка: пауза — частина інтерфейсу, а не вада."]],
  ),
  material(
    3,
    "Епізод 42. Як ми пам’ятаємо",
    "podcast",
    "Довга пам’ять",
    "pod.example",
    "consumed",
    "loved",
    ["пам’ять"],
    [[3, "Слухав у дорозі."]],
  ),
  material(
    5,
    "Галерея мобільних екранів",
    "resource",
    null,
    "gallery.example",
    null,
    null,
    ["натхнення", "мобільні інтерфейси"],
    [],
  ),
  material(
    9,
    "Чому нам потрібні нудні вихідні",
    "article",
    "Андрій Лозинський",
    "weekend.example",
    "consumed",
    null,
    ["відпочинок"],
    [],
  ),
  material(40, "Тиха гавань", "game", "Студія «Берег»", "harbour.example", "in_progress", null, [], []),
  material(
    75,
    "Прочитати пізніше: історія шрифтів",
    "article",
    null,
    "fonts.example",
    "saved",
    null,
    ["шрифти"],
    [],
  ),
];
const card = ({
  impressions: _i,
  summary: _s,
  description: _d,
  entities: _e,
  url: _u,
  labels: _l,
  ...rest
}: LibraryItem): LibraryCard => rest;

function mockLibrary(url: URL): LibraryList {
  const list = (key: string) => (url.searchParams.get(key) ?? "").split(",").filter(Boolean);
  const [types, statuses, reactions] = [list("type"), list("status"), list("reaction")];
  const q = (url.searchParams.get("q") ?? "").toLowerCase();
  const terms = q ? stems(q) : [];
  const rows = mode === "empty" ? [] : library;
  const items = rows
    .filter(
      (m) =>
        (!q ||
          [m.title, m.creator, ...m.tags, ...m.impressions.map((n) => n.body)]
            .join(" ")
            .toLowerCase()
            .includes(q)) &&
        (!types.length || types.includes(m.type)) &&
        (!statuses.length || statuses.includes(m.status ?? "")) &&
        (!reactions.length || reactions.includes(m.reaction ?? NO_REACTION)) &&
        (url.searchParams.get("unreviewed") !== "1" || m.unreviewed) &&
        (url.searchParams.get("nothought") !== "1" || m.noThought),
    )
    .map(card)
    .map((c) => {
      const hit = terms.length && c.thought ? snippet(c.thought.body, terms) : null;
      return hit && c.thought && fold(c.thought.body).includes(terms[0])
        ? { ...c, thought: { ...c.thought, body: hit, hit: true } }
        : c;
    });
  const counts: LibraryList["counts"] = { saved: 0, unreviewed: 0, noThought: 0, types: {} };
  for (const m of rows) {
    if (m.status === "saved") counts.saved++;
    if (m.unreviewed) counts.unreviewed++;
    if (m.noThought) counts.noThought++;
    counts.types[m.type] = (counts.types[m.type] ?? 0) + 1;
  }
  return { items, terms, total: rows.length, counts, labels };
}

// Collections, the album and the shelf, answered from the invented library (dev only).
const sets: { id: string; name: string; members: string[] }[] = [
  { id: "design", name: "Дизайн мого застосунку", members: ["m1", "m5", "m6"] },
  { id: "talk", name: "Для виступу про AI slop", members: ["m9"] },
];
const fold = (text: string) => text.toLowerCase();
const tileOf = (m: LibraryItem): Tile => ({ id: m.id, title: m.title, cover: m.cover });
const inSets = () => {
  for (const m of library) m.collections = sets.filter((c) => c.members.includes(m.id)).map((c) => c.id);
};
inSets();
const setCard = (c: (typeof sets)[number]): CollectionCard => {
  const rows = c.members.flatMap((id) => library.find((m) => m.id === id) ?? []);
  return { id: c.id, name: c.name, count: rows.length, tiles: rows.slice(0, 4).map(tileOf) };
};
const setView = (c: (typeof sets)[number]): CollectionView => ({
  ...setCard(c),
  items: c.members.flatMap((id) => library.find((m) => m.id === id) ?? []).map(card),
  labels,
});

const flatText = (text: string) => text.replace(/\s+/g, " ").trim();
function mockAlbum(period: string): Album | null {
  const items = library.filter((m) => m.date.startsWith(period));
  if (!items.length) return null;
  const loved = items.filter((m) => m.reaction === "loved");
  const notes = items.flatMap((m) => m.impressions.map((n) => ({ m, n })));
  const entries = diary.filter((d) => d.entry_date.startsWith(period));
  const months = [...new Set(library.map((m) => m.date.slice(0, 7)))].sort().reverse();
  const at = months.indexOf(period);
  const done = period < isoDate(new Date()).slice(0, 7);
  return {
    period,
    done,
    counts: { saved: items.length, loved: loved.length, thoughts: notes.length, diary: entries.length },
    loved: loved.map(tileOf),
    slots: done ? loved.length : Math.max(6, Math.ceil((loved.length + 1) / 3) * 3),
    quotes: notes
      .filter(({ n }) => n.body.length >= 25)
      .map(({ m, n }) => ({ id: m.id, title: m.title, body: n.body, date: n.date })),
    diary: entries.map((d) => ({
      id: d.id,
      date: d.entry_date,
      excerpt: flatText(d.body)
        .split(/(?<=[.!?…])\s/)[0]
        .slice(0, 140),
    })),
    older: months[at + 1] ?? null,
    newer: months[at - 1] ?? null,
  };
}
const mockFaces = (period: string) =>
  library
    .filter((m) => m.date.startsWith(period))
    .slice(0, 4)
    .map(tileOf);
function mockShelf(): Shelf {
  const months = [...new Set(library.map((m) => m.date.slice(0, 7)))].sort().reverse();
  return {
    albums: months.flatMap((period) => {
      const a = mockAlbum(period)!;
      return {
        period,
        done: a.done,
        saved: a.counts.saved,
        loved: a.counts.loved,
        thoughts: a.counts.thoughts,
        tiles: a.loved.length || !a.done ? a.loved.slice(0, 4) : mockFaces(period),
      };
    }),
  };
}

// The month's wrap on invented numbers around the invented library; open it at #/media/wrap/<YYYY-MM>.
const wraps = new Map<string, WrapSpec>();
function mockWrap(period: string): Wrap | null {
  const album = mockAlbum(period);
  if (!album) return null;
  const items = library.filter((m) => m.date.startsWith(period));
  const tags = new Map<string, number>();
  for (const m of items) for (const t of m.tags) tags.set(t, (tags.get(t) ?? 0) + 1);
  const topics = [...tags].sort((a, b) => b[1] - a[1]).slice(0, 5);
  const named = items[0]?.title ?? "Yol";
  return {
    facts: {
      period,
      saved: 34,
      previous: 27,
      topType: { label: "Відео", n: 12 },
      loved: album.loved,
      latest: items.slice(0, 6).map(tileOf),
      topics:
        topics.length >= 2
          ? topics
          : [
              ["музика", 6],
              ["дизайн", 4],
              ["осінь", 3],
            ],
      authors: [
        ["Altin Gün", 3],
        ["Нічний двір", 2],
      ],
      rhythm: [
        [1, 0, 1, 0, 2, 3, 2],
        [2, 1, 1, 2, 1, 4, 3],
        [3, 2, 4, 2, 3, 5, 8],
        [0, 2, 0, 1, 0, 1, 1],
      ],
      peak: "неділя ввечері",
      late: "01:12 у суботу",
      facts: [
        {
          id: "repeat:m2",
          n: 3,
          unit: ["раз", "рази", "разів"],
          rest: `ти зберіг «${named}»`,
          detail: "Перший раз на початку місяця, востаннє позавчора.",
        },
        {
          id: "streak",
          n: 9,
          unit: ["день", "дні", "днів"],
          rest: "поспіль ти щось зберігав",
          detail: "Найдовша серія цього року.",
        },
      ],
      quotes: album.quotes.slice(0, 5),
    },
    spec: wraps.get(period) ?? null,
  };
}

// Counters: two of the first kind, one of the second, and the diary counted from the newest entry above.
let counterRows: CounterRow[] = [
  { id: 1, name: "Подзвонити мамі", kind: "done", started_on: daysAgo(40) },
  { id: 2, name: "Поприбирати вдома", kind: "done", started_on: daysAgo(30) },
  { id: 3, name: "Не курю", kind: "keep", started_on: daysAgo(80) },
];
let counterMarks: MarkRow[] = [
  { counter_id: 1, mark_date: daysAgo(12) },
  { counter_id: 1, mark_date: daysAgo(26) },
  { counter_id: 2, mark_date: daysAgo(5) },
  { counter_id: 3, mark_date: daysAgo(34) },
];
let diaryHidden = false;
const counterToday = () => daysAgo(0);
const diaryState = () => ({
  last: diary.length
    ? diary
        .map((d) => d.entry_date)
        .sort()
        .at(-1)!
    : null,
  hidden: diaryHidden,
});
const counterView = (id: string) =>
  counterDetail(
    mode === "empty" ? [] : counterRows,
    counterMarks,
    mode === "empty" ? { last: null, hidden: false } : diaryState(),
    id,
    counterToday(),
  );

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

export async function mockGet<T>(path: string): Promise<T> {
  await wait(mode === "slow" ? 2500 : 250);
  if (mode === "error" && path !== "/api/me") throw new ApiError(503);
  const url = new URL(path, location.origin);
  const q = url.searchParams.get("q") ?? undefined;
  const entry = /^\/api\/diary\/(\d+)$/.exec(url.pathname);
  const rows = mode === "empty" ? [] : diary;
  const quick = mode === "empty" ? [] : ideas;
  let body: unknown;
  if (url.pathname === "/api/me") body = { userId: 0 };
  else if (url.pathname === "/api/diary") body = diaryList(rows, q);
  else if (entry) body = diaryEntry(rows, Number(entry[1]));
  else if (url.pathname === "/api/ideas") body = ideaList(quick, q);
  else if (url.pathname === "/api/counters")
    body = counterList(
      mode === "empty" ? [] : counterRows,
      counterMarks,
      mode === "empty" ? { last: null, hidden: false } : diaryState(),
      counterToday(),
    );
  else if (url.pathname.startsWith("/api/counters/"))
    body = counterView(decodeURIComponent(url.pathname.slice(14)));
  else if (url.pathname === "/api/library") body = mockLibrary(url);
  else if (url.pathname === "/api/collections")
    body = { collections: (mode === "empty" ? [] : sets).map(setCard) };
  else if (url.pathname.startsWith("/api/collections/")) {
    const found = sets.find((c) => c.id === decodeURIComponent(url.pathname.slice(17)));
    body = found && setView(found);
  } else if (url.pathname === "/api/albums") body = mockShelf();
  else if (url.pathname.startsWith("/api/albums/")) body = mockAlbum(url.pathname.slice(12));
  else if (url.pathname.startsWith("/api/wraps/")) body = mockWrap(url.pathname.slice(11));
  else if (url.pathname.startsWith("/api/library/"))
    body = library.find((m) => m.id === decodeURIComponent(url.pathname.slice(13)));
  if (!body) throw new ApiError(404);
  return body as T;
}

// Writes change the invented data in memory, so a reload starts over. ?mock=fail makes every write fail.
export async function mockSend<T>(method: string, path: string, body: unknown): Promise<T> {
  await wait(mode === "slow" ? 2500 : 300);
  if (mode === "fail") throw new ApiError(503);
  const input = (body ?? {}) as Record<string, any>;
  const url = new URL(path, location.origin);
  const now = new Date();
  if (url.pathname === "/api/diary") {
    const id = Math.max(0, ...diary.map((d) => d.id)) + 1;
    diary.push({ id, entry_date: input.date, body: input.body.trim() });
    return { id } as T;
  }
  if (url.pathname === "/api/counters") {
    const name = String(input.name ?? "").trim();
    if (!name || !["done", "keep"].includes(input.kind) || name.toLowerCase() === DIARY_NAME.toLowerCase())
      throw new ApiError(400);
    if (counterRows.some((c) => c.name.toLowerCase() === name.toLowerCase())) throw new ApiError(400);
    const id = Math.max(0, ...counterRows.map((c) => c.id)) + 1;
    counterRows.push({ id, name, kind: input.kind, started_on: input.since ?? counterToday() });
    return { id } as T;
  }
  const counter = /^\/api\/counters\/(\d+|diary)(?:\/(mark|unmark|delete|hidden))?$/.exec(url.pathname);
  if (counter) {
    const [, id, action] = counter;
    if (id === DIARY_ID) {
      diaryHidden = Boolean(input.hidden);
      return counterView(DIARY_ID) as T;
    }
    const row = counterRows.find((c) => String(c.id) === id);
    if (!row) throw new ApiError(404);
    if (action === "delete") {
      counterRows = counterRows.filter((c) => c !== row);
      counterMarks = counterMarks.filter((m) => m.counter_id !== row.id);
      return true as T;
    }
    if (!action) {
      const name = String(input.name ?? "").trim();
      if (!name || counterRows.some((c) => c !== row && c.name.toLowerCase() === name.toLowerCase()))
        throw new ApiError(400);
      row.name = name;
    } else if (action === "mark") {
      const today = counterToday();
      const yesterday = daysAgo(1);
      const allowed = row.kind === "done" ? [today, yesterday] : [today];
      if (!allowed.includes(input.date)) throw new ApiError(400);
      if (!counterMarks.some((m) => m.counter_id === row.id && m.mark_date === input.date))
        counterMarks.push({ counter_id: row.id, mark_date: input.date });
    } else {
      const before = counterMarks.length;
      counterMarks = counterMarks.filter((m) => !(m.counter_id === row.id && m.mark_date === input.date));
      if (counterMarks.length === before) throw new ApiError(404);
    }
    return counterView(id) as T;
  }
  if (url.pathname === "/api/ideas") {
    const id = Math.max(0, ...ideas.map((d) => d.id)) + 1;
    const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    ideas.push({ id, idea_date: isoDate(now), idea_time: time, body: input.body.trim(), resolved_at: null });
    return { id } as T;
  }
  const idea = /^\/api\/ideas\/(\d+)\/(resolve|restore|delete)$/.exec(url.pathname);
  if (idea) {
    const row = ideas.find((i) => i.id === Number(idea[1]));
    if (!row) throw new ApiError(404);
    if (idea[2] === "delete") {
      if (!row.resolved_at) throw new ApiError(400);
      ideas.splice(ideas.indexOf(row), 1);
      return true as T;
    }
    row.resolved_at = idea[2] === "resolve" ? now.toISOString() : null;
    return true as T;
  }
  if (url.pathname === "/api/collections" && method === "POST") {
    if (sets.some((c) => c.name.toLowerCase() === String(input.name).trim().toLowerCase()))
      throw new ApiError(400);
    const id = `c${sets.length + 1}`;
    sets.unshift({ id, name: String(input.name).trim(), members: [] });
    return { id } as T;
  }
  const coll = /^\/api\/collections\/([^/]+)(?:\/(delete|items|remove))?$/.exec(url.pathname);
  if (coll) {
    const found = sets.find((c) => c.id === decodeURIComponent(coll[1]));
    if (!found) throw new ApiError(404);
    if (coll[2] === "delete") {
      sets.splice(sets.indexOf(found), 1);
      inSets();
      return true as T;
    }
    if (coll[2] === "items" && !found.members.includes(input.itemId)) found.members.unshift(input.itemId);
    if (coll[2] === "remove") found.members = found.members.filter((id) => id !== input.itemId);
    if (!coll[2]) found.name = String(input.name).trim();
    inSets();
    return setView(found) as T;
  }
  const wrap = /^\/api\/wraps\/(\d{4}-\d{2})(\/photos)?$/.exec(url.pathname);
  if (wrap) {
    if (wrap[2]) return { sent: (input.images as unknown[]).length } as T;
    const seed = Math.floor(Math.random() * 2 ** 31);
    wraps.set(wrap[1], {
      seed,
      createdAt: now.toISOString(),
      mood: "Місяць повільних речей",
      moodLine: "Довгі відео й тиха музика витіснили статті. Ти частіше дивився, ніж читав.",
      numberLine: "Другий тиждень вийшов найщільнішим: 18 збережень за сім днів.",
      factId: seed % 2 ? "streak" : "repeat:m2",
      factLine: "Схоже, до цього ти повертаєшся, коли хочеш подумати.",
    });
    return mockWrap(wrap[1]) as T;
  }
  const item = /^\/api\/library\/([^/]+?)(\/impressions)?$/.exec(url.pathname);
  const material = item && library.find((m) => m.id === decodeURIComponent(item[1]));
  if (!material) throw new ApiError(404);
  if (item[2]) {
    material.impressions.push({ date: isoDate(now), body: input.body.trim() });
    material.unreviewed = false;
    material.noThought = false;
  } else {
    for (const key of ["type", "status", "reaction", "tags"] as const)
      if (key in input) (material as Record<string, unknown>)[key] = input[key];
    if (input.reaction) material.unreviewed = false;
  }
  return structuredClone(material) as T;
}
