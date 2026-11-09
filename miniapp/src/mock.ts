// Dev only (see api.ts): invented entries and ideas, answered by the same code as the server.
// ?mock shows them; ?mock=empty, ?mock=error and ?mock=slow show the other states.
import { diaryEntry, diaryList, ideaList, type DiaryRow, type IdeaRow } from "../../src/miniapp/data.ts";
import type { LibraryCard, LibraryItem, LibraryList } from "../../src/miniapp/library-types.ts";
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
].map(([ago, time, body], i) => ({
  id: 100 - i,
  idea_date: daysAgo(ago as number),
  idea_time: time as string,
  body: body as string,
}));

const labels = {
  types: { article: "Стаття", podcast: "Подкаст", video: "Відео", resource: "Ресурс", game: "Гра" },
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
  url: `https://${source}/`,
  summary:
    "Есей про те, як короткі паузи й тиша в інтерфейсі знижують тривогу та роблять рішення усвідомленішими.",
  description: null,
  entities: [],
  impressions: notes.map(([n, body]) => ({ date: daysAgo(n), body })),
  labels,
});

const library: LibraryItem[] = [
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
        (url.searchParams.get("unreviewed") !== "1" || m.unreviewed),
    )
    .map(card);
  const counts: LibraryList["counts"] = { saved: 0, unreviewed: 0, types: {} };
  for (const m of rows) {
    if (m.status === "saved") counts.saved++;
    if (m.unreviewed) counts.unreviewed++;
    counts.types[m.type] = (counts.types[m.type] ?? 0) + 1;
  }
  return { items, total: rows.length, counts, labels };
}

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
  else if (url.pathname === "/api/library") body = mockLibrary(url);
  else if (url.pathname.startsWith("/api/library/"))
    body = library.find((m) => m.id === decodeURIComponent(url.pathname.slice(13)));
  if (!body) throw new ApiError(404);
  return body as T;
}
