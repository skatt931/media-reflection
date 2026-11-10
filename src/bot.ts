import { Store, normalizeTags, needsMetadata, aiCurrent } from "./store.ts";
import { fields, types, statuses, reactions, localDate, localTime, validDate, addDays } from "./fields.ts";
import type { AI, Suggestion } from "./groq.ts";
import { createSearch, type Ask } from "./search.ts";
import { buildExport, type ExportPackage } from "./export-package.ts";
import type { Metadata } from "./metadata.ts";
import type { Transcribe } from "./voice.ts";
import { findUrl } from "./links.ts";
import { JournalStore, parseDiaryDate, type IdeaSource } from "./journal.ts";
import { breakdown, review, slideText, validPeriod, previousPeriod, type Review } from "./stats.ts";
import {
  MAX_NAME,
  addToCollection,
  collection,
  collectionRows,
  collectionsOf,
  createCollection,
  memberIds,
  namesOf,
  removeFromCollection,
} from "./collections.ts";

export type Out = {
  // Replace an existing message instead of sending a new one.
  edit?: { id: number; caption: boolean };
  // Together with edit: change only the inline keyboard.
  markupOnly?: boolean;
  // Send a file with the text as its caption. Unlike photos there is no fallback to a plain message.
  document?: { name: string; bytes: Buffer };
  photo?: { path: string; fileId?: string; onUpload?: (fileId: string) => void };
  // Deliver without a notification sound.
  silent?: boolean;
  // Instead of a message, react to this one of the owner's messages; `text` is the fallback when reactions fail.
  react?: number;
};
export type Send = (text: string, keyboard?: any, out?: Out) => Promise<number>;
export type Services = {
  ask?: Ask;
  export?: () => ExportPackage;
  metadata?: (url: string) => Promise<Metadata | null>;
  cover?: (id: string, imageUrl: string) => Promise<string | null>;
  transcribe?: Transcribe;
  journal?: JournalStore;
};

const TTL = 30 * 60000;
// A short message this soon after a bare link is treated as a comment on it.
const ATTACH_WINDOW = 10 * 60000;
// Quick capture (diary, idea) and «Довідка» are always at hand: with the Mini App on the menu button
// there is no other list of commands. Three per row so no label wraps on a phone.
const menuRows = [
  ["Щоденник", "Ідея", "Довідка"],
  ["Бібліотека", "Запитати", "Експорт"],
];
const menu = { keyboard: menuRows, resize_keyboard: true };
const dialogMenu = { keyboard: [["Скасувати"], ...menuRows], resize_keyboard: true };
// An unfinished diary entry is saved by itself after this long without a new message.
const DIARY_SILENCE = 60 * 60000;
// Reply-keyboard buttons keep working while the diary is being written; anything else is diary text.
const menuTexts = new Set(["Щоденник", "Ідея", "Бібліотека", "Запитати", "Експорт", "Скасувати", "Довідка"]);
const icons: Record<string, string> = { loved: "❤️", positive: "👍", mixed: "😐", negative: "👎" };
const button = (text: string, callback_data: string) => ({ text, callback_data });
const short = (text: string, max = 80) => (text.length > max ? text.slice(0, max - 1) + "…" : text);
const pairs = <T>(list: T[]) => {
  const rows: T[][] = [];
  for (let i = 0; i < list.length; i += 2) rows.push(list.slice(i, i + 2));
  return rows;
};
const backRow = (id: string) => [button("← Назад", `back:${id}`)];

function reactionRow(s: Store, id: string) {
  const current = s.item(id)?.reaction;
  return Object.entries(icons).map(([key, icon]) =>
    button(current === key ? `${icon} ✓` : icon, `reaction:${key}:${id}`),
  );
}
const actions = (s: Store, id: string) => ({
  inline_keyboard: [
    reactionRow(s, id),
    [
      button("Додати думку", `reflect:${id}`),
      button(s.item(id)?.status === "saved" ? "На потім ✓" : "На потім", `later:${id}`),
      button("Змінити", `details:${id}`),
    ],
  ],
});
// A comment that only says "later" sends the link to «На потім» instead of becoming a thought.
const laterWords = new Set(["потім", "на потім", "later", "🔖"]);
const isLater = (text: string) =>
  laterWords.has(
    text
      .trim()
      .toLocaleLowerCase("uk")
      .replace(/[.!…]+$/u, ""),
  );
const dateChoices = (id: string) => ({
  inline_keyboard: [
    [button("Сьогодні", `date:today:${id}`), button("Вчора", `date:yesterday:${id}`)],
    [button("Інша дата", `date:custom:${id}`), button("Не знаю", `date:unknown:${id}`)],
    backRow(id),
  ],
});
const detailButtons = (id: string) => ({
  inline_keyboard: [
    ...pairs(Object.entries(fields).map(([key, label]) => button(label, `edit:${key}:${id}`))),
    [button("Тип", `type:${id}`), button("Стан", `states:${id}`), button("В добірку", `colls:${id}`)],
    [button("Видалити", `delete:${id}`)],
    backRow(id),
  ],
});
// Every collection with a tick where the material already is, so one tap adds it and the next takes it out.
const collectionChoices = (s: Store, id: string) => {
  const mine = new Set(collectionsOf(s, id));
  return {
    inline_keyboard: [
      ...collectionRows(s)
        .slice(0, 20)
        .map((c) => [
          button(`${mine.has(c.id) ? "✓ " : ""}${short(c.name, 40)} · ${c.count}`, `coll:${c.id}:${id}`),
        ]),
      [button("+ Нова добірка", `collnew:${id}`)],
      backRow(id),
    ],
  };
};
const choices = (id: string, map: Record<string, string>, action: string) => ({
  inline_keyboard: [
    ...pairs(Object.entries(map).map(([key, label]) => button(label, `${action}:${key}:${id}`))),
    backRow(id),
  ],
});

function card(s: Store, id: string) {
  const i = s.item(id)!;
  const notes = s.reflections(id);
  const lines: string[] = [i.title];
  if (i.url && i.title !== i.url) lines.push(i.url);
  lines.push(
    [types[i.type] ?? i.type, statuses[i.status] ?? i.status, icons[i.reaction]].filter(Boolean).join(" · "),
  );
  if (i.creator) lines.push(`Автор: ${i.creator}`);
  if (i.type !== "resource" || i.consumed_on)
    lines.push(`Коли: ${i.consumed_on ?? "—"}${i.date_source === "capture" ? " (день надсилання)" : ""}`);
  if (i.tags.length) lines.push(`Теми: ${i.tags.join(", ")}`);
  const sets = namesOf(s, id);
  if (sets.length) lines.push(`Добірки: ${sets.join(", ")}`);
  if (i.description && i.description !== i.title) lines.push("", short(i.description, 300));
  if (notes.length) lines.push("", "Мої враження:", ...notes.slice(-3).map((n) => "• " + n.body));
  if (i.summary) lines.push("", `AI: ${i.summary}`);
  return lines.join("\n");
}

async function sendCard(
  s: Store,
  send: Send,
  id: string,
  keyboard: any,
  options: { edit?: Out["edit"]; prefix?: string; textOnly?: boolean } = {},
) {
  const item = s.item(id)!;
  // A pager message is edited from one item to the next, so it never carries a photo.
  const cover = options.edit || options.textOnly ? null : s.coverPath(item);
  const photo = cover
    ? {
        path: cover,
        fileId: item.photo_file_id,
        onUpload: (fileId: string) => s.patch(id, { photo_file_id: fileId }),
      }
    : undefined;
  const text = (options.prefix ?? "") + card(s, id);
  const mid = await send(text, keyboard, { edit: options.edit, photo });
  s.link(mid, id);
  return mid;
}

// 2026-11-05 → 05.11.26, like the diary note names.
const diaryDay = (date: string) => {
  const [year, month, day] = date.split("-");
  return `${day}.${month}.${year.slice(2)}`;
};
const diaryContext = (extra: object = {}) => ({
  mode: "diary",
  expires: Date.now() + DIARY_SILENCE + 5 * 60000,
  ...extra,
});
const diaryLine = (draft: Record<string, any>, today: string) =>
  `Щоденник · ${diaryDay(draft.entry_date)}${draft.entry_date === today ? " (сьогодні)" : ""}\n` +
  (draft.parts
    ? `Повідомлень: ${draft.parts}, символів: ${draft.body.length}. Пиши далі або натисни «Готово».`
    : "Пиши текст або надсилай голосові — усе склеїться в один запис. Закінчиш — «Готово».");
const diaryButtons = {
  inline_keyboard: [
    [button("Готово", "diary:done")],
    [button("Дата", "diary:date"), button("Скасувати", "diary:cancel")],
  ],
};
const diaryBack = { inline_keyboard: [[button("← Назад", "diary:back")]] };
const diaryDates = {
  inline_keyboard: [
    [button("Сьогодні", "diary:setdate:today"), button("Вчора", "diary:setdate:yesterday")],
    [button("Інша дата", "diary:customdate")],
    [button("← Назад", "diary:back")],
  ],
};
const diarySaved = (entry: { date: string; length: number }) =>
  `Збережено запис за ${diaryDay(entry.date)} (символів: ${entry.length}).`;
const diaryUndo = (id: number) => ({ inline_keyboard: [[button("Скасувати запис", `diary:undo:${id}`)]] });

// Saves an entry nobody finished once the silence has lasted an hour. Nothing is lost: the text was in the draft.
export async function diaryAutosave(s: Store, journal: JournalStore, send: Send, now = new Date()) {
  const draft = journal.draft();
  if (!draft || now.getTime() - Date.parse(draft.updated_at) < DIARY_SILENCE) return;
  if (s.context()?.mode === "diary") s.setContext(null);
  const entry = journal.finishDraft();
  if (!entry) return;
  if (draft.status_message)
    await send("", undefined, { edit: { id: draft.status_message, caption: false }, markupOnly: true }).catch(
      () => {},
    );
  await send(`Година без нових повідомлень. ${diarySaved(entry)}`, diaryUndo(entry.id), { silent: true });
}

const ideaContext = () => ({ mode: "idea", expires: Date.now() + TTL });
function ideaCard(journal: JournalStore, idea: Record<string, any>) {
  const resolved = Boolean(idea.resolved_at);
  const ids = journal.ideaIds(resolved);
  const at = ids.indexOf(idea.id);
  const keyboard: any[][] = [];
  if (ids.length > 1)
    keyboard.push([
      button("←", `idea:open:${ids[(at - 1 + ids.length) % ids.length]}`),
      button("→", `idea:open:${ids[(at + 1) % ids.length]}`),
    ]);
  // An idea is resolved first and can be brought back; only a resolved one can be deleted, as in the Mini App.
  keyboard.push([
    resolved
      ? button("Повернути до ідей", `idea:undo:${idea.id}`)
      : button("Вирішено", `idea:done:${idea.id}`),
  ]);
  if (resolved) keyboard.push([button("Видалити", `idea:rm:${idea.id}`)]);
  if (resolved) keyboard.push([button("← До ідей", "idea:list:open")]);
  else if (journal.ideaIds(true).length)
    keyboard.push([button(`Вирішені (${journal.ideaIds(true).length})`, "idea:list:resolved")]);
  return {
    text:
      `${resolved ? "Вирішені" : "Ідеї"} · ${at + 1}/${ids.length}\n` +
      `${diaryDay(idea.idea_date)} ${idea.idea_time}${idea.source === "voice" ? " 🎤" : ""}\n\n` +
      short(idea.body, 3800),
    keyboard: { inline_keyboard: keyboard },
  };
}

const ago = (days: number) => {
  if (days <= 0) return "сьогодні";
  if (days === 1) return "вчора";
  const word =
    days % 10 === 1 && days % 100 !== 11
      ? "день"
      : days % 10 >= 2 && days % 10 <= 4 && (days % 100 < 12 || days % 100 > 14)
        ? "дні"
        : "днів";
  return `${days} ${word} тому`;
};

export const commands = [
  { command: "help", description: "Як користуватися" },
  { command: "list", description: "Останні записи" },
  { command: "diary", description: "Записати щоденник" },
  { command: "idea", description: "Записати ідею (/idea текст)" },
  { command: "ideas", description: "Список ідей" },
  { command: "later", description: "На потім" },
  { command: "reflect", description: "Без вражень" },
  { command: "ask", description: "Пошук по збереженому" },
  { command: "export", description: "Нові записи Медіатеки архівом для Obsidian" },
  { command: "review", description: "Підсумок місяця (/review 2026 — року)" },
  { command: "enrich", description: "Дозаповнити старі записи" },
  { command: "cancel", description: "Вийти з діалогу" },
];

const libraryMenu = {
  inline_keyboard: [
    [button("Останні", "library:recent"), button("На потім", "library:later")],
    [button("Без вражень", "library:unreviewed"), button("Без думки", "library:nothought")],
    [button("За типом", "library:types"), button("Підсумок місяця", "library:review")],
    [button("Добірки", "library:collections")],
  ],
};
// Only the types that have items, most common first.
function typeMenu(s: Store) {
  const count = new Map<string, number>();
  for (const i of s.items()) count.set(i.type, (count.get(i.type) ?? 0) + 1);
  const rows = [...count]
    .sort((a, b) => b[1] - a[1])
    .map(([type, n]) => button(`${types[type] ?? type} ${n}`, `bytype:${type}`));
  return { inline_keyboard: [...pairs(rows), [button("← Назад", "library:menu")]] };
}

// Help is one message; topic buttons swap its text.
const help: Record<string, { title: string; text: string }> = {
  save: {
    title: "Зберегти",
    text:
      "Поділись посиланням із YouTube, Spotify, Threads чи браузера в бота — він сам підтягне назву, обкладинку й теги.\n\n" +
      "• Коментар у тому ж повідомленні стане першою думкою: «посилання + дуже глибоко про вигорання».\n" +
      "• «потім» поруч із посиланням (або одразу після) — у «На потім», а не в переглянуте.\n" +
      "• Без посилання теж можна: «Книга «Атомні звички», порадив друг» або голосове.\n" +
      "• Переслане з каналу зберігається як матеріал.",
  },
  reflect: {
    title: "Враження",
    text:
      "Під карткою: ❤️ улюблене · 👍 сподобалось · 😐 так собі · 👎 ні.\n\n" +
      "• «Додати думку» або відповідь (reply) на картку — і текст стане думкою до неї.\n" +
      "• Коротке повідомлення одразу після посилання теж прикріпиться до нього.\n" +
      "• «Змінити» — тип, дата, теги, назва або видалити запис.\n" +
      "• «На потім» на картці — відкласти; ще раз — позначити переглянутим сьогодні.",
  },
  find: {
    title: "Пошук",
    text:
      "«Запитати» — пиши звичайною мовою, AI шукає лише у твоїй бібліотеці.\n\n" +
      "• «подкасти про AI, які сподобались»\n" +
      "• «що я зберігав про дизайн у жовтні»\n" +
      "• «ресурси для натхнення»\n" +
      "• «музика, яку я лайкнув»\n\n" +
      "Далі можна уточнювати: «а тільки ❤️», «а за минулий місяць».",
  },
  lists: {
    title: "Списки",
    text:
      "«Бібліотека» — Останні, На потім, Без вражень, Без думки, За типом.\n\n" +
      "• Список — одне повідомлення, гортай ← →.\n" +
      "• На будь-якій картці в списку можна реагувати чи відповісти думкою.\n" +
      "• «Без вражень» — переглянуте, де ще немає ні реакції, ні думки.\n" +
      "• «Без думки» — усе переглянуте, де ще немає твоєї думки, навіть якщо реакцію вже поставлено; ресурси й відео теж тут.",
  },
  diary: {
    title: "Щоденник",
    text:
      "/diary — режим запису: кілька повідомлень чи голосових склеюються в один запис. Закінчиш — «Готово».\n\n" +
      "• Забув натиснути — запис збережеться сам після години тиші.\n" +
      "• «Дата» — записати за вчора чи будь-який інший день.\n" +
      "• Голосові: бот питає, чи розпізнавати, бо аудіо піде в Groq (сторонній сервіс).\n" +
      "• Після збереження «Скасувати запис» видаляє його.\n" +
      "• Це окремо від медіатеки: не потрапляє в підсумки й пошук.",
  },
  ideas: {
    title: "Ідеї",
    text:
      "/idea текст — записати ідею одним рядком, бот відповість реакцією 👌. Без діалогу й підтверджень.\n\n" +
      "• /idea без тексту — наступне повідомлення (текст або голосове) стане ідеєю.\n" +
      "• Голосове розпізнається Groq (аудіо йде в сторонній сервіс).\n" +
      "• /ideas — список від нових до старих, гортай ← →. «Вирішено» прибирає ідею зі списку: внизу «Вирішені», звідти її можна повернути або видалити назавжди (з підтвердженням; живу ідею видалити не можна). Так само в Mini App.\n" +
      "• Раз на тиждень npm run journal:pull на Mac кладе кожну ідею окремим файлом у Journal/Ideas/Inbox в Obsidian.\n" +
      "• Це окремо від медіатеки й щоденника: не потрапляє в підсумки, «Без вражень» і пошук.",
  },
  reviews: {
    title: "Підсумки",
    text:
      "• П'ятниця, 18:00 — тихе повідомлення: скільки збережено за тиждень.\n" +
      "• 1-го числа — підсумок місяця, у січні ще й року. Слайди гортаються ← →.\n" +
      "• /review 2026-10 — будь-який місяць, /review 2026 — рік.\n" +
      "• «Експорт» — надіслати архів із новими нотатками й обкладинками для Obsidian.\n" +
      "• /enrich — дозаповнити старі записи (назви, обкладинки, теги).",
  },
};
// Built from `commands`, so a new command shows up in the help without anyone remembering to add it.
const helpIntro = () =>
  "Сюди можна кидати все, що дивишся, слухаєш і читаєш, — а потім знайти й згадати, що думав.\n\n" +
  `Команди:\n${commands.map((c) => `/${c.command} — ${c.description}`).join("\n")}\n\n` +
  (process.env.MINIAPP_URL?.trim() ? "Mini App — кнопка «Відкрити» ліворуч від поля вводу.\n\n" : "") +
  "Докладніше — за темою:";
function helpButtons(current?: string) {
  const topics = Object.entries(help).map(([key, t]) =>
    button(key === current ? `· ${t.title} ·` : t.title, `help:${key}`),
  );
  return { inline_keyboard: [...pairs(topics), ...(current ? [[button("← Зміст", "help:index")]] : [])] };
}
const helpText = (topic?: string) =>
  topic && help[topic] ? `${help[topic].title}\n\n${help[topic].text}` : helpIntro();

type Pager = { title: string; ids: string[]; index: number };
const heading = (p: Pager) => `${p.title} · ${p.index + 1}/${p.ids.length}\n\n`;
const weekdays = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];

// Weekly digest: one silent message with counts and a button that opens «Без вражень».
// If last week's message was never opened, it is updated instead of sending another one.
export async function weekly(
  s: Store,
  send: Send,
  now = new Date(),
  when = process.env.WEEKLY_DIGEST ?? "fri 18:00",
  journal?: JournalStore,
) {
  const match = /^(sun|mon|tue|wed|thu|fri|sat) (\d{2}:\d{2})$/.exec(when.trim().toLowerCase());
  if (!match) return;
  const today = localDate(now);
  const weekday = weekdays[new Date(today + "T12:00:00Z").getUTCDay()];
  if (weekday !== match[1] || localTime(now) < match[2] || s.value("digest:day") === today) return;
  const previous = Number(s.value("digest:message")) || 0;
  const reuse = previous > 0 && !s.value("digest:opened");
  const from =
    (reuse ? s.value("digest:from") : s.value("digest:sent")) ??
    new Date(now.getTime() - 7 * 86400000).toISOString();
  const saved = s.items().filter((i) => i.created_at > from && i.created_at <= now.toISOString());
  if (saved.length) {
    const mix = breakdown(saved);
    const since = localDate(new Date(from)).split("-").reverse().slice(0, 2).join(".");
    const open = s.unreflected(today).length;
    const head =
      now.getTime() - Date.parse(from) > 8 * 86400000 ? `З ${since} збережено` : "За тиждень збережено";
    const last = journal?.lastEntryDate();
    const mid = await send(
      `${head} ${saved.length}: ${mix}.` +
        (open ? `\nБез вражень: ${open}.` : "") +
        (last
          ? `\nОстанній запис щоденника — ${ago(Math.round((Date.parse(today) - Date.parse(last)) / 86400000))}.`
          : ""),
      open ? { inline_keyboard: [[button("Переглянути", "weekly:open")]] } : undefined,
      { edit: reuse ? { id: previous, caption: false } : undefined, silent: true },
    );
    s.setValue("digest:message", String(mid));
    s.setValue("digest:from", from);
    s.run("DELETE FROM context WHERE key='digest:opened'");
  }
  s.setValue("digest:sent", now.toISOString());
  s.setValue("digest:day", today);
}

// A review is one message; ← → switch slides. The slides are stored with the message.
// A month's review also opens that month's album in the Mini App, when there is one (MINIAPP_URL).
const albumButton = (r: Review) => {
  const url = (process.env.MINIAPP_URL ?? "").trim();
  if (r.period.length !== 7 || !/^https:\/\/[^\s/]+/.test(url)) return [];
  const link = new URL(url);
  link.searchParams.set("go", `media/album/${r.period}`);
  return [[{ text: "Мій альбом місяця", web_app: { url: link.toString() } }]];
};
const slideButtons = (r: Review, index: number) => {
  const n = r.slides.length;
  const rows = [
    ...(n > 1
      ? [[button("←", `slide:${(index - 1 + n) % n}`), button("→", `slide:${(index + 1) % n}`)]]
      : []),
    ...albumButton(r),
  ];
  return rows.length ? { inline_keyboard: rows } : undefined;
};
async function sendReview(s: Store, send: Send, r: Review, out: Out = {}) {
  const mid = await send(slideText(r, 0), slideButtons(r, 0), out);
  s.setValue(`slides:${mid}`, JSON.stringify(r));
}

// Month in review on the 1st (MONTHLY_REVIEW, default 10:00), year in review in January.
// Sent once per period, silently; a month without items sends nothing.
export async function reviews(
  s: Store,
  send: Send,
  now = new Date(),
  time = process.env.MONTHLY_REVIEW ?? "10:00",
) {
  if (!/^\d{2}:\d{2}$/.test(time)) return;
  const today = localDate(now);
  if (today.endsWith("-01") && localTime(now) < time) return;
  for (const period of [previousPeriod(today.slice(0, 7)), previousPeriod(today.slice(0, 4))]) {
    const key = `review:${period.length === 4 ? "year" : "month"}`;
    if ((s.value(key) ?? "") >= period) continue;
    const r = review(s, period);
    if (r) await sendReview(s, send, r, { silent: true });
    s.setValue(key, period);
  }
}

export async function handle(
  s: Store,
  u: any,
  owner: number,
  send: Send,
  ai?: AI,
  services: Services = {},
): Promise<string | undefined> {
  if (s.seen(u.update_id)) return;
  const m = u.message;
  const c = u.callback_query;
  const from = m?.from ?? c?.from;
  const chat = m?.chat ?? c?.message?.chat;
  if (from?.id !== owner || chat?.id !== owner || chat?.type !== "private") {
    s.done(u.update_id);
    return;
  }
  const active = s.requestContext(u.update_id);
  const at = m?.date ? new Date(m.date * 1000) : new Date();
  const here = c?.message
    ? { id: c.message.message_id as number, caption: Boolean(c.message.photo) }
    : undefined;
  const until = () => Date.now() + TTL;
  let notice: string | undefined;

  // Lists are a single message that pages through items; its state is keyed by message id.
  const pagerOf = (mid?: number): Pager | undefined => {
    const value = mid ? s.value(`pager:${mid}`) : undefined;
    return value ? JSON.parse(value) : undefined;
  };
  const page = pagerOf(here?.id);
  const savePage = (mid: number, p: Pager) => s.setValue(`pager:${mid}`, JSON.stringify(p));
  const nav = (p: Pager) => {
    const n = p.ids.length;
    return n > 1
      ? [[button("←", `page:${(p.index - 1 + n) % n}`), button("→", `page:${(p.index + 1) % n}`)]]
      : [];
  };
  const main = (id: string, paged = Boolean(page)) => {
    const keyboard = actions(s, id);
    return paged && page ? { inline_keyboard: [...keyboard.inline_keyboard, ...nav(page)] } : keyboard;
  };
  const show = (id: string, keyboard?: any, edit?: Out["edit"]) => {
    const paged = Boolean(edit && page);
    return sendCard(s, send, id, keyboard ?? main(id, paged), {
      edit,
      prefix: paged ? heading(page!) : undefined,
    });
  };
  const keyboardOnly = (id: string, keyboard: any) =>
    send(card(s, id), keyboard, { edit: here, markupOnly: true });
  async function showPage(p: Pager, edit?: Out["edit"]) {
    p.ids = p.ids.filter((id) => s.item(id));
    if (!p.ids.length) {
      await send(`${p.title}: порожньо.`, edit ? undefined : menu, { edit });
      return;
    }
    p.index = Math.max(0, Math.min(p.index, p.ids.length - 1));
    const id = p.ids[p.index];
    const keyboard = { inline_keyboard: [...actions(s, id).inline_keyboard, ...nav(p)] };
    const mid = await sendCard(s, send, id, keyboard, { edit, prefix: heading(p), textOnly: true });
    savePage(mid, p);
  }
  async function showReview(period: string, edit?: Out["edit"]) {
    s.setContext(null);
    const r = review(s, period);
    if (r) await sendReview(s, send, r, { edit });
    else await send("За цей період записів немає.", edit ? undefined : menu, { edit });
  }
  const later = () => s.items().filter((i) => i.status === "saved");
  const list = async (title: string, items: any[], edit?: Out["edit"]) => {
    s.setContext(null);
    await showPage({ title, ids: items.slice(0, 100).map((i) => i.id), index: 0 }, edit);
  };

  const analyze = async (id: string, raw: string, options: { question: boolean; evidence?: string }) => {
    if (!ai) return null;
    let suggestion: Suggestion | null | undefined = s.ai(u.update_id);
    if (suggestion === undefined) {
      const item = s.item(id)!;
      try {
        suggestion = await ai({
          title: item.title,
          type: item.type,
          source: item.site ?? item.source,
          description: item.description ?? null,
          creator: item.creator,
          summary: item.summary,
          notes: s
            .reflections(id)
            .slice(-3)
            .map((r) => r.body),
          raw,
          allowQuestion: options.question,
          evidence: options.evidence,
          knownTags: s.tagVocabulary(),
        });
      } catch {
        suggestion = null;
      }
      s.saveAI(u.update_id, id, suggestion);
    }
    const facts = options.evidence !== undefined;
    s.applyAI(id, suggestion && !facts ? { ...suggestion, title: null, creator: null } : suggestion);
    return suggestion;
  };

  const remember = async (
    id: string,
    text: string,
    followup: boolean,
    reply?: { text: string; keyboard: any },
  ) => {
    s.addReflection(u.update_id, id, text, at);
    // A reflection is the user's own text, so it is never evidence for title/creator.
    const suggestion = await analyze(id, text, { question: !followup });
    const question = !followup ? suggestion?.question : null;
    s.setContext(question ? { mode: "reflection", id, followup: true, expires: until() } : null);
    const lines = [reply?.text ?? "Збережено."];
    if (question) lines.push("", question);
    if (ai && !suggestion) lines.push("AI недоступний, теги не оновлено.");
    const mid = await send(lines.join("\n"), reply?.keyboard ?? (question ? dialogMenu : menu));
    s.link(mid, id);
    s.setValue(`followup:${mid}`, "true");
  };

  const ask = async (query: string, context: any) => {
    const history = context?.mode === "ask" ? (context.history ?? []) : [];
    const cached = s.value(`answer:${u.update_id}`);
    const result = cached
      ? JSON.parse(cached)
      : await (services.ask ?? createSearch(s))(query, history, context?.plan);
    s.setValue(`answer:${u.update_id}`, JSON.stringify(result));
    s.setContext({
      mode: "ask",
      history: [...history, query].slice(-3),
      plan: result.plan,
      expires: until(),
    });
    await send(result.text, dialogMenu);
    const found = result.ids.filter((id: string) => s.item(id));
    if (found.length) await showPage({ title: "Знайдено", ids: found, index: 0 });
  };

  // Fetches page metadata and cover once per item. Returns the id that now holds the item.
  const loadMetadata = async (id: string) => {
    const item = s.item(id)!;
    if (!services.metadata || !needsMetadata(item)) return id;
    const meta = await services.metadata(item.url).catch(() => null);
    const target = s.applyMetadata(id, meta);
    if (meta?.image && services.cover && !s.item(target)!.cover) {
      const cover = await services.cover(target, meta.image).catch(() => null);
      if (cover) s.patch(target, { cover });
    }
    return target;
  };
  // Title/creator may only be quoted from the fetched page, or from the text itself
  // when there is no link.
  const evidenceFor = (id: string, text: string) => {
    const item = s.item(id)!;
    return item.url ? [item.description, item.site].filter(Boolean).join("\n") : text;
  };

  async function capture(text: string, update = u.update_id, capturedAt = at, note = true) {
    s.setContext(null);
    const found = findUrl(text);
    const later = Boolean(found) && isLater(text.replace(found!, ""));
    const first = s.capture(update, text, capturedAt, note && !later);
    if (later) s.edit(first, { status: "saved", consumed_on: null });
    const id = await loadMetadata(first);
    const hasNote = s.reflections(id).some((r) => r.update_id === update);
    const suggestion = await analyze(id, text, { question: hasNote, evidence: evidenceFor(id, text) });
    await show(id);
    if (hasNote && suggestion?.question) {
      s.setContext({ mode: "reflection", id, followup: true, expires: until() });
      const mid = await send(suggestion.question, dialogMenu);
      s.link(mid, id);
      s.setValue(`followup:${mid}`, "true");
    }
  }

  async function enrich() {
    s.setContext(null);
    const todo = s
      .items()
      .filter((i) => (services.metadata && needsMetadata(i)) || (ai && !aiCurrent(i)))
      .slice(0, 20);
    if (!todo.length) {
      await send("Оновлювати нічого.", menu);
      return;
    }
    let done = 0;
    for (const start of todo) {
      const id = await loadMetadata(start.id);
      const item = s.item(id)!;
      if (ai && !aiCurrent(item)) {
        const suggestion = await ai({
          title: item.title,
          type: item.type,
          source: item.site ?? item.source,
          description: item.description ?? null,
          notes: s
            .reflections(id)
            .slice(-3)
            .map((r) => r.body),
          raw: s.captures(id)[0]?.raw ?? item.title,
          allowQuestion: false,
          evidence: evidenceFor(id, item.title),
          knownTags: s.tagVocabulary(),
        }).catch(() => null);
        s.applyAI(id, suggestion);
      }
      const after = s.item(id)!;
      if (!needsMetadata(after) || aiCurrent(after)) done++;
    }
    await send(`Оновлено ${done} з ${todo.length}. Подивитися: Бібліотека → Останні.`, menu);
  }

  async function applyEdit(text: string) {
    if (active.field === "consumed_on" && text !== "—" && !validDate(text))
      await send("Не схоже на дату. Формат 2026-11-04 або «—».", dialogMenu);
    else if (active.field === "title" && (text === "—" || text.length > 300))
      await send("Назва — від 1 до 300 символів.", dialogMenu);
    else {
      const list = (max: number) =>
        text === "—"
          ? []
          : text
              .split(",")
              .map((t) => t.trim())
              .filter(Boolean)
              .slice(0, max);
      const value =
        active.field === "tags"
          ? normalizeTags(list(20))
          : active.field === "entities"
            ? list(8)
            : text === "—"
              ? null
              : text.slice(0, 600);
      s.edit(active.id, { [active.field]: value });
      s.setContext(null);
      await show(active.id);
    }
  }

  // The link saved moments ago, if any.
  function recentLink() {
    const last = s.lastCapture();
    if (!last) return null;
    const age = at.getTime() - Date.parse(last.created_at);
    const item = s.item(last.item_id);
    return item?.url && age >= 0 && age <= ATTACH_WINDOW ? item : null;
  }
  // The item a short comment belongs to: the last capture, if it was a bare link sent moments ago.
  function attachTarget(text: string) {
    if (text.includes("\n") || text.length > 80) return null;
    const item = recentLink();
    return item && !s.reflections(item.id).length ? item : null;
  }

  const journal = services.journal;
  const diaryStrip = (id: unknown) =>
    id
      ? send("", undefined, { edit: { id: id as number, caption: false }, markupOnly: true }).catch(() => {})
      : null;
  // The status message carries the buttons. A new part gets a fresh one at the bottom of the chat
  // and the previous one loses its buttons; with `edit` the given message is rewritten in place.
  async function diaryStatus(edit?: Out["edit"]) {
    const draft = journal!.draft()!;
    if (!edit) await diaryStrip(draft.status_message);
    const mid = await send(diaryLine(draft, localDate(at)), diaryButtons, { edit, silent: true });
    journal!.setDraftMessage(mid);
  }
  async function diaryOpen(rest: string) {
    if (!journal) {
      await send("Щоденник не підключено.", menu);
      return;
    }
    journal.startDraft(localDate(at), u.update_id);
    s.setContext(diaryContext());
    if (rest) journal.appendDraft(u.update_id, rest);
    await diaryStatus();
  }
  async function diaryText(text: string) {
    const j = journal!;
    if (!text) return;
    if (!j.draft()) j.startDraft(localDate(at), u.update_id);
    if (active?.awaiting === "date") {
      const date = parseDiaryDate(text);
      if (!date) await send("Не схоже на дату. Формат: 05.11.26 або 2026-11-05.");
      else if (date > localDate(at)) await send("Ця дата ще не настала.");
      else {
        j.setDraftDate(date);
        s.setContext(diaryContext());
        const old = j.draft()!.status_message;
        await diaryStatus(old ? { id: old as number, caption: false } : undefined);
      }
      return;
    }
    if (j.appendDraft(u.update_id, text)) {
      s.setContext(diaryContext());
      await diaryStatus();
    }
  }
  // Audio goes to a third party (Groq), so a voice note is transcribed only after the button.
  async function diaryVoice(voice: any) {
    if (!services.transcribe) {
      await send("Для голосових потрібен Groq: npm run setup:groq. Голосове не додано.", menu);
      return;
    }
    if (voice.file_size > 20_000_000) {
      await send("Запис завеликий, максимум 20 МБ.", menu);
      return;
    }
    const mid = await send("🎤 Розпізнати голосове? Аудіо піде в Groq, сторонній сервіс.", {
      inline_keyboard: [[button("Розпізнати", "diary:voice:yes"), button("Пропустити", "diary:voice:no")]],
    });
    s.setValue(`diaryvoice:${mid}`, voice.file_id);
  }
  async function diaryVoiceChoice(accept: boolean) {
    const key = `diaryvoice:${here!.id}`;
    const fileId = s.value(key);
    if (!fileId) {
      await send("Голосове застаріло, надішли його ще раз.", undefined, { edit: here });
      return;
    }
    if (!accept) {
      s.run("DELETE FROM context WHERE key=?", key);
      await send("Голосове пропущено й не збережено.", undefined, { edit: here });
      return;
    }
    const cache = `voice:${u.update_id}`;
    const text = s.value(cache) ?? (await services.transcribe?.(fileId));
    if (!text) {
      notice = "Не вдалося розпізнати, спробуй ще раз";
      return;
    }
    s.setValue(cache, text);
    if (!journal!.draft()) journal!.startDraft(localDate(at), u.update_id);
    const added = journal!.appendDraft(u.update_id, text);
    s.run("DELETE FROM context WHERE key=?", key);
    s.setContext(diaryContext());
    await send(`🎤 ${short(text, 1000)}`, undefined, { edit: here });
    if (added) await diaryStatus();
  }
  async function diaryFinish(edit?: Out["edit"]) {
    const previous = journal!.draft()?.status_message;
    s.setContext(null);
    const entry = journal!.finishDraft();
    if (!edit) await diaryStrip(previous);
    if (entry) await send(diarySaved(entry), diaryUndo(entry.id), { edit });
    else await send("Порожньо, зберігати нічого.", edit ? undefined : menu, { edit });
  }
  async function diaryCallback(parts: string[]) {
    const j = journal;
    if (!j || !here) return;
    const step = parts[1];
    if (step === "voice") return diaryVoiceChoice(parts[2] === "yes");
    if (["undo", "keep", "remove"].includes(step)) {
      const entry = j.entry(Number(parts[2]));
      if (!entry || entry.source !== "bot") {
        await send("Цього запису вже немає.", undefined, { edit: here });
        return;
      }
      const info = { date: entry.entry_date as string, length: (entry.body as string).length };
      if (step === "undo")
        await send(
          `Видалити запис за ${diaryDay(info.date)} (символів: ${info.length})? Повернути його не вийде.`,
          {
            inline_keyboard: [
              [button("Так, видалити", `diary:remove:${entry.id}`)],
              [button("Залишити", `diary:keep:${entry.id}`)],
            ],
          },
          { edit: here },
        );
      else if (step === "keep") await send(diarySaved(info), diaryUndo(entry.id), { edit: here });
      else {
        j.removeBotEntry(entry.id);
        await send(`Запис за ${diaryDay(info.date)} видалено.`, undefined, { edit: here });
        notice = "Видалено";
      }
      return;
    }
    const draft = j.draft();
    if (!draft) {
      await send("Цей запис уже закрито.", undefined, { edit: here });
      return;
    }
    switch (step) {
      case "done":
        await diaryFinish(here);
        return;
      case "date":
        await send(diaryLine(draft, localDate(at)), diaryDates, { edit: here, markupOnly: true });
        return;
      case "back":
        s.setContext(diaryContext());
        await diaryStatus(here);
        return;
      case "setdate": {
        if (!["today", "yesterday"].includes(parts[2])) return;
        j.setDraftDate(parts[2] === "today" ? localDate(at) : addDays(localDate(at), -1));
        s.setContext(diaryContext());
        await diaryStatus(here);
        return;
      }
      case "customdate":
        s.setContext(diaryContext({ awaiting: "date" }));
        await send("Введи дату: 05.11.26 або 2026-11-05.", diaryBack, { edit: here });
        return;
      case "cancel":
        await send(
          `Видалити текст, що зібрався (символів: ${draft.body.length})? Повернути його не вийде.`,
          {
            inline_keyboard: [[button("Так, видалити", "diary:discard")], [button("← Назад", "diary:back")]],
          },
          { edit: here },
        );
        return;
      case "discard":
        j.discardDraft();
        s.setContext(null);
        await send("Чернетку видалено.", undefined, { edit: here });
        return;
    }
  }

  // An idea is one line without a dialogue: saved at once, answered with a reaction on the message itself.
  async function ideaSave(text: string, source: IdeaSource) {
    journal!.addIdea({ body: text, source, date: localDate(at), time: localTime(at), update: u.update_id });
    s.setContext(null);
    await send("✓", undefined, { react: m.message_id, silent: true });
  }
  async function ideaVoice(voice: any) {
    if (!services.transcribe) {
      await send("Для голосових потрібен Groq: npm run setup:groq. Ідею не збережено.", menu);
      return;
    }
    if (voice.file_size > 20_000_000) {
      await send("Запис завеликий, максимум 20 МБ.", menu);
      return;
    }
    const key = `voice:${u.update_id}`;
    const text = s.value(key) ?? (await services.transcribe(voice.file_id));
    if (!text) {
      await send("Не вдалося розпізнати голос. Надішли ще раз або «Скасувати».", dialogMenu);
      return;
    }
    s.setValue(key, text);
    await send(`🎤 ${short(text, 1000)}`);
    await ideaSave(text, "voice");
  }
  async function ideaOpen(rest: string) {
    if (!journal) {
      await send("Ідеї не підключено.", menu);
      return;
    }
    if (rest) {
      await ideaSave(rest, "text");
      return;
    }
    s.setContext(ideaContext());
    await send("Надішли ідею наступним повідомленням: текстом або голосовим.", dialogMenu);
  }
  async function ideaShow(idea: Record<string, any> | undefined, edit?: Out["edit"]) {
    if (!idea) {
      const resolved = journal!.ideaIds(true).length;
      await send(
        resolved ? "Усі ідеї вирішені." : "Ідей поки немає. /idea текст — записати.",
        resolved
          ? { inline_keyboard: [[button(`Вирішені (${resolved})`, "idea:list:resolved")]] }
          : edit
            ? undefined
            : menu,
        { edit },
      );
      return;
    }
    const card = ideaCard(journal!, idea);
    await send(card.text, card.keyboard, { edit });
  }
  const newestIdea = (resolved = false) => {
    const id = journal!.ideaIds(resolved)[0];
    return id === undefined ? undefined : journal!.idea(id);
  };
  async function ideaCallback(parts: string[]) {
    const j = journal;
    if (!j || !here) return;
    if (parts[1] === "list") {
      await ideaShow(newestIdea(parts[2] === "resolved"), here);
      return;
    }
    const idea = j.idea(Number(parts[2]));
    if (parts[1] === "open") {
      await ideaShow(idea ?? newestIdea(), here);
      return;
    }
    if (!idea) {
      await send("Цієї ідеї вже немає.", undefined, { edit: here });
      return;
    }
    if (parts[1] === "done") {
      const ids = j.ideaIds();
      const next = ids.length > 1 ? ids[(ids.indexOf(idea.id) + 1) % ids.length] : undefined;
      j.setIdeaResolved(idea.id, at);
      await ideaShow(next === undefined ? undefined : j.idea(next), here);
      notice = "Вирішено";
    } else if (parts[1] === "undo") {
      j.setIdeaResolved(idea.id, null);
      await ideaShow(j.idea(idea.id), here);
      notice = "Повернено";
    } else if (parts[1] === "rm") {
      if (!idea.resolved_at) {
        await ideaShow(idea, here);
        return;
      }
      await send(
        `Видалити назавжди?\n\n${short(idea.body, 600)}`,
        {
          inline_keyboard: [
            [button("Так, видалити", `idea:rmyes:${idea.id}`), button("Ні", `idea:open:${idea.id}`)],
          ],
        },
        { edit: here },
      );
    } else if (parts[1] === "rmyes") {
      const ids = j.ideaIds(true);
      const next = ids.length > 1 ? ids[(ids.indexOf(idea.id) + 1) % ids.length] : undefined;
      if (!j.deleteResolvedIdea(idea.id)) {
        await ideaShow(idea, here);
        return;
      }
      await ideaShow(next === undefined ? newestIdea() : j.idea(next), here);
      notice = "Видалено";
    }
  }

  // A new collection, named in the next message, with the material it was started from.
  async function newCollection(id: string, text: string) {
    const made = createCollection(s, text, at);
    if (!made.ok) {
      await send(
        made.error === "exists"
          ? "Така добірка вже є. Іншу назву? «Скасувати» — вийти."
          : made.error === "limit"
            ? "Добірок уже забагато."
            : `Назва до ${MAX_NAME} символів. Спробуй ще раз.`,
        dialogMenu,
      );
      return;
    }
    addToCollection(s, made.id, id, at);
    s.setContext(null);
    await send(`Створено «${collection(s, made.id)!.name}»: ${short(s.item(id)!.title)}`, menu);
  }

  async function onText(text: string) {
    const replyTo = m.reply_to_message?.message_id;
    const paged = pagerOf(replyTo);
    const reply = paged ? { item_id: paged.ids[paged.index] } : replyTo ? s.prompt(replyTo) : null;
    const target = attachTarget(text);
    if (reply) await remember(reply.item_id, text, s.value(`followup:${replyTo}`) !== undefined);
    else if (replyTo) await send("Не знаю, до якого запису це. Натисни «Додати думку» під карткою.", menu);
    else if (active?.mode === "edit") await applyEdit(text);
    else if (active?.mode === "collection") await newCollection(active.id, text);
    else if (findUrl(text)) await capture(text);
    else if (isLater(text)) {
      const item = recentLink();
      s.setContext(null);
      if (!item)
        await send("«Потім» працює разом із посиланням: у тому ж повідомленні або одразу після нього.", menu);
      else {
        s.edit(item.id, { status: "saved", consumed_on: null });
        await send(`На потім: ${short(item.title)}`, menu);
      }
    } else if (active?.mode === "reflection") await remember(active.id, text, active.followup);
    else if (active?.mode === "ask") await ask(text, active);
    else if (/^(чи |які |що (я |мені|з |про)|знайди |покажи |а тільки )/iu.test(text))
      await ask(text, active);
    else if (target)
      await remember(target.id, text, false, {
        text: `Додав як думку до «${short(target.title)}».`,
        keyboard: { inline_keyboard: [[button("Це окремий запис", `detach:${u.update_id}:${target.id}`)]] },
      });
    else if (text) await capture(text);
  }

  async function onMessage() {
    let text: string | null =
      typeof m.text === "string" ? m.text : typeof m.caption === "string" ? m.caption : null;
    const voice = m.voice ?? m.audio;
    // While the diary is open, texts and voice notes belong to the entry, not to the library.
    if (active?.mode === "diary" && journal) {
      if (text === null && voice) {
        await diaryVoice(voice);
        return;
      }
      if (text !== null && !text.startsWith("/") && !menuTexts.has(text.trim())) {
        await diaryText(text.trim());
        return;
      }
    }
    // The next message after a bare /idea is the idea itself.
    if (active?.mode === "idea" && journal) {
      if (text === null && voice) {
        await ideaVoice(voice);
        return;
      }
      if (text !== null && text.trim() && !text.startsWith("/") && !menuTexts.has(text.trim())) {
        await ideaSave(text.trim(), "text");
        return;
      }
    }
    if (text === null && voice) {
      if (!services.transcribe) {
        await send("Для голосових потрібен Groq: npm run setup:groq.", menu);
        return;
      }
      if (voice.file_size > 20_000_000) {
        await send("Запис завеликий, максимум 20 МБ.", menu);
        return;
      }
      const key = `voice:${u.update_id}`;
      text = s.value(key) ?? (await services.transcribe(voice.file_id));
      if (!text) {
        await send("Не вдалося розпізнати голос.", menu);
        return;
      }
      s.setValue(key, text);
      await send(`🎤 ${short(text, 1000)}`);
    }
    if (text === null) {
      await send("Приймаю текст, посилання і голосові.", menu);
      return;
    }
    text = text.trim();
    // A link hidden behind text ("читати тут") is only in the message entities.
    const hidden = (m.entities ?? m.caption_entities ?? []).find(
      (e: any) => e.type === "text_link" && typeof e.url === "string",
    )?.url;
    if (hidden && !findUrl(text)) text = `${hidden}\n${text}`.trim();
    // A forwarded post is saved as a material; its text is not the user's impression.
    if (m.forward_origin || m.forward_date) {
      if (text) await capture(text, u.update_id, at, false);
      return;
    }
    const cmd = text.split(/\s/)[0].split("@")[0];
    if (["/cancel", "/done"].includes(cmd) || text === "Скасувати") {
      if (active?.mode === "diary" && journal && cmd === "/done") await diaryFinish();
      else {
        s.setContext(null);
        await send(
          active?.mode === "diary" && journal?.draft()
            ? "Вийшов зі щоденника. Текст не загублено: він збережеться сам після години тиші, /diary — продовжити."
            : "Скасовано.",
          menu,
        );
      }
    } else if (["/start", "/help", "/довідка"].includes(cmd) || text === "Довідка") {
      s.setContext(null);
      // The reply keyboard is set by a plain message; inline buttons need their own.
      if (cmd === "/start") await send("Привіт! Меню — внизу.", menu);
      await send(helpText(), helpButtons());
    } else if (text === "Бібліотека") {
      s.setContext(null);
      await send("Що показати?", libraryMenu);
    } else if (cmd === "/list" || text === "Останні" || text === "покажи останнє")
      await list("Останні", s.items());
    else if (cmd === "/later" || text === "На потім") await list("На потім", later());
    else if (cmd === "/reflect" || text === "Без вражень") await list("Без вражень", s.unreflected());
    else if (cmd === "/review") {
      const period = text.split(/\s+/)[1] ?? localDate().slice(0, 7);
      if (!validPeriod(period)) await send("Формат: /review, /review 2026-10 або /review 2026.", menu);
      else await showReview(period);
    } else if (cmd === "/diary" || text === "Щоденник") await diaryOpen(text.replace(/^\S+/, "").trim());
    else if (cmd === "/idea" || text === "Ідея") await ideaOpen(text.replace(/^\S+/, "").trim());
    else if (cmd === "/ideas") {
      s.setContext(null);
      if (!journal) await send("Ідеї не підключено.", menu);
      else await ideaShow(newestIdea());
    } else if (cmd === "/enrich") await enrich();
    else if (text === "Експорт" || cmd === "/export") {
      s.setContext(null);
      try {
        const pkg = (services.export ?? (() => buildExport(s)))();
        const shown = (titles: string[]) => titles.slice(0, 5).join(", ") + (titles.length > 5 ? "…" : "");
        const changes =
          (pkg.changed.length
            ? `Змінено після експорту (повторно не надсилаю, записано в базі): ${pkg.changed.length} — ${shown(pkg.changed)}.`
            : "") +
          (pkg.deleted.length
            ? `${pkg.changed.length ? "\n" : ""}Видалено в боті після експорту: ${pkg.deleted.length} — ${shown(pkg.deleted)}.`
            : "");
        if (pkg.zip) {
          const caption =
            `Експорт: нових нотаток ${pkg.notes}, обкладинок ${pkg.covers}. Розпакуй у vault.` +
            (pkg.left ? `\nЛишилось ще ${pkg.left} — натисни «Експорт» знову.` : "");
          await send(caption, menu, { document: { name: pkg.name, bytes: pkg.zip } });
          // Only a file Telegram has accepted counts as exported.
          pkg.commit();
          if (changes) await send(changes, menu);
        } else await send("Нових записів для експорту немає." + (changes ? "\n" + changes : ""), menu);
      } catch (e) {
        await send(`Експорт не вдався: ${e instanceof Error ? e.message : "невідома помилка"}`, menu);
      }
    } else if (text === "Запитати" || text === "Пошук" || cmd === "/ask" || cmd === "/search") {
      const query = text.startsWith("/") ? text.slice(text.indexOf(" ") + 1).trim() : "";
      if (!query || text === cmd) {
        s.setContext({ mode: "ask", history: [], expires: until() });
        await send(
          "Що шукаєш? Напр. «подкасти про AI, які сподобались» або «ресурси для натхнення». Далі можна уточнити: «а тільки за жовтень».",
          dialogMenu,
        );
      } else await ask(query, active);
    } else if (text.startsWith("/"))
      await send(`Невідома команда. Є ${commands.map((c) => "/" + c.command).join(", ")}.`, menu);
    else await onText(text);
  }

  async function onCallback() {
    const parts = String(c.data ?? "").split(":");
    const action = parts[0];
    const id = parts.at(-1)!;
    if (action === "help") {
      const topic = parts[1] === "index" ? undefined : parts[1];
      await send(helpText(topic), helpButtons(topic), { edit: here });
      return;
    }
    if (action === "diary") {
      await diaryCallback(parts);
      return;
    }
    if (action === "idea") {
      await ideaCallback(parts);
      return;
    }
    if (action === "bytype") {
      if (Object.hasOwn(types, parts[1]))
        await list(
          types[parts[1]],
          s.items().filter((i) => i.type === parts[1]),
          here,
        );
      return;
    }
    if (action === "library") {
      if (parts[1] === "menu") await send("Що показати?", libraryMenu, { edit: here });
      else if (parts[1] === "types") await send("Який тип?", typeMenu(s), { edit: here });
      else if (parts[1] === "later") await list("На потім", later(), here);
      else if (parts[1] === "unreviewed") await list("Без вражень", s.unreflected(), here);
      else if (parts[1] === "nothought") await list("Без думки", s.unthought(), here);
      else if (parts[1] === "review") await showReview(localDate().slice(0, 7), here);
      else if (parts[1] === "collections") {
        const rows = collectionRows(s).slice(0, 30);
        await send(
          rows.length ? "Добірки:" : "Добірок ще немає. Створи першу: «Змінити» під карткою → «В добірку».",
          {
            inline_keyboard: [
              ...rows.map((c) => [button(`${short(c.name, 40)} · ${c.count}`, `collview:${c.id}`)]),
              [button("← Назад", "library:menu")],
            ],
          },
          { edit: here },
        );
      } else await list("Останні", s.items(), here);
      return;
    }
    if (action === "collview") {
      const found = collection(s, parts[1]);
      if (!found) notice = "Добірки вже немає.";
      else
        await list(
          found.name,
          memberIds(s, found.id).map((id) => ({ id })),
          here,
        );
      return;
    }
    if (action === "weekly") {
      if (here && String(here.id) === s.value("digest:message")) s.setValue("digest:opened", "1");
      await list("Без вражень", s.unreflected());
      return;
    }
    if (action === "slide") {
      const stored = here ? s.value(`slides:${here.id}`) : undefined;
      if (!stored) notice = "Підсумок застарів, відкрий його знову.";
      else {
        const r: Review = JSON.parse(stored);
        const index = Math.max(0, Math.min(Number(parts[1]) || 0, r.slides.length - 1));
        await send(slideText(r, index), slideButtons(r, index), { edit: here });
      }
      return;
    }
    if (action === "page") {
      if (!page) notice = "Список застарів, відкрий його знову.";
      else await showPage({ ...page, index: Number(parts[1]) || 0 }, here);
      return;
    }
    if (!s.item(id)) return;
    switch (action) {
      case "reflect":
        s.setContext({ mode: "reflection", id, followup: false, expires: until() });
        s.link(
          await send(
            `Що думаєш про «${short(s.item(id)!.title)}»? Напиши наступним повідомленням.`,
            dialogMenu,
          ),
          id,
        );
        return;
      case "details":
        await keyboardOnly(id, detailButtons(id));
        return;
      case "later": {
        const item = s.item(id)!;
        if (item.status !== "saved") s.edit(id, { status: "saved", consumed_on: null });
        else
          s.edit(
            id,
            item.type === "resource" ? { status: null } : { status: "consumed", consumed_on: localDate() },
          );
        await show(id, undefined, here);
        return;
      }
      case "back":
        await keyboardOnly(id, main(id));
        return;
      case "delete":
        await keyboardOnly(id, {
          inline_keyboard: [[button("Так, видалити", `remove:${id}`)], backRow(id)],
        });
        return;
      case "remove": {
        const title = s.item(id)!.title;
        s.deleteItem(id);
        if (s.context()?.id === id) s.setContext(null);
        if (page) await showPage({ ...page, ids: page.ids.filter((x) => x !== id) }, here);
        else await send(`Видалено: ${short(title)}`, undefined, { edit: here });
        notice = "Видалено";
        return;
      }
      case "states":
        await keyboardOnly(id, choices(id, statuses, "status"));
        return;
      case "colls":
        await keyboardOnly(id, collectionChoices(s, id));
        return;
      case "coll": {
        const found = collection(s, parts[1]);
        if (!found) notice = "Добірки вже немає.";
        else if (collectionsOf(s, id).includes(found.id)) {
          removeFromCollection(s, found.id, id);
          notice = `Прибрано з «${short(found.name, 30)}»`;
        } else
          notice = addToCollection(s, found.id, id)
            ? `Додано в «${short(found.name, 30)}»`
            : "Добірка заповнена";
        await keyboardOnly(id, collectionChoices(s, id));
        return;
      }
      case "collnew":
        s.setContext({ mode: "collection", id, expires: until() });
        await send("Як назвати добірку? Напр. «Дизайн мого застосунку».", dialogMenu);
        return;
      case "type":
        await keyboardOnly(id, choices(id, types, "settype"));
        return;
      case "status": {
        if (!Object.hasOwn(statuses, parts[1])) return;
        const patch: Record<string, unknown> = { status: parts[1] };
        if (parts[1] === "saved") {
          patch.consumed_on = null;
          patch.date_source = null;
        }
        s.edit(id, patch);
        s.setContext(null);
        await show(id, ["consumed", "finished"].includes(parts[1]) ? dateChoices(id) : undefined, here);
        return;
      }
      case "reaction": {
        if (!Object.hasOwn(reactions, parts[1]) && parts[1] !== "clear") return;
        const value = parts[1] === "clear" || s.item(id)!.reaction === parts[1] ? null : parts[1];
        s.edit(id, { reaction: value });
        // A reaction answers the reflection prompt, so the item leaves «Без вражень».
        if (value) s.run("UPDATE prompts SET state='answered' WHERE item_id=? AND state='pending'", id);
        await show(id, undefined, here);
        return;
      }
      case "settype":
        if (!Object.hasOwn(types, parts[1])) return;
        s.edit(id, { type: parts[1] });
        await show(id, undefined, here);
        return;
      case "edit": {
        const field = parts[1];
        if (!Object.hasOwn(fields, field)) return;
        s.setContext({ mode: "edit", id, field, expires: until() });
        if (field === "consumed_on")
          await send("Коли? Обери або введи дату, напр. 2026-11-04.", dateChoices(id));
        else
          await send(
            `Нове значення «${fields[field]}»${["tags", "entities"].includes(field) ? " (через кому)" : ""}. «—» — очистити.`,
            dialogMenu,
          );
        return;
      }
      case "date": {
        const value = parts[1];
        s.setContext(null);
        if (value === "custom") {
          s.setContext({ mode: "edit", id, field: "consumed_on", expires: until() });
          await send("Дата, напр. 2026-11-04:", dialogMenu);
        } else if (["today", "yesterday", "unknown"].includes(value)) {
          const today = localDate();
          s.edit(id, {
            consumed_on: value === "unknown" ? null : value === "today" ? today : addDays(today, -1),
          });
          await show(id, undefined, here);
        }
        return;
      }
      case "detach": {
        const update = Number(parts[1]);
        const reflection = s.all("SELECT * FROM reflections WHERE update_id=?", update)[0];
        if (!reflection) return;
        // Capture first: a retry after a failed send must not lose the text.
        s.capture(update, reflection.body, new Date(reflection.created_at));
        s.removeReflection(update);
        await send(`Окремий запис: ${short(reflection.body)}`, undefined, { edit: here });
        await capture(reflection.body, update, new Date(reflection.created_at));
        return;
      }
    }
  }

  if (c) await onCallback();
  else await onMessage();
  s.done(u.update_id);
  return notice;
}
