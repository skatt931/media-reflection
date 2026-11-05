import { Store, normalizeTags, needsMetadata } from "./store.ts";
import { fields, types, statuses, reactions, localDate, localTime, validDate, addDays } from "./fields.ts";
import type { AI, Suggestion } from "./groq.ts";
import { createSearch, type Ask } from "./search.ts";
import { exportVault, type ExportReport } from "./vault.ts";
import type { Metadata } from "./metadata.ts";
import type { Transcribe } from "./voice.ts";
import { findUrl } from "./links.ts";
import { breakdown, review, slideText, validPeriod, previousPeriod, type Review } from "./stats.ts";

export type Out = {
  // Replace an existing message instead of sending a new one.
  edit?: { id: number; caption: boolean };
  // Together with edit: change only the inline keyboard.
  markupOnly?: boolean;
  photo?: { path: string; fileId?: string; onUpload?: (fileId: string) => void };
  // Deliver without a notification sound.
  silent?: boolean;
};
export type Send = (text: string, keyboard?: any, out?: Out) => Promise<number>;
export type Services = {
  ask?: Ask;
  export?: () => ExportReport;
  metadata?: (url: string) => Promise<Metadata | null>;
  cover?: (id: string, imageUrl: string) => Promise<string | null>;
  transcribe?: Transcribe;
};

const TTL = 30 * 60000;
// A short message this soon after a bare link is treated as a comment on it.
const ATTACH_WINDOW = 10 * 60000;
const menu = { keyboard: [["Бібліотека", "Запитати", "Експорт"]], resize_keyboard: true };
const dialogMenu = {
  keyboard: [["Скасувати"], ["Бібліотека", "Запитати", "Експорт"]],
  resize_keyboard: true,
};
const icons: Record<string, string> = { positive: "👍", mixed: "😐", negative: "👎" };
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
    [button("Додати думку", `reflect:${id}`), button("Змінити", `details:${id}`)],
  ],
});
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
    [button("Тип", `type:${id}`), button("Стан", `states:${id}`)],
    [button("Видалити", `delete:${id}`)],
    backRow(id),
  ],
});
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
  lines.push(`Коли: ${i.consumed_on ?? "—"}${i.date_source === "capture" ? " (день надсилання)" : ""}`);
  if (i.tags.length) lines.push(`Теми: ${i.tags.join(", ")}`);
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

export const commands = [
  { command: "list", description: "Останні записи" },
  { command: "later", description: "На потім" },
  { command: "reflect", description: "Без вражень" },
  { command: "ask", description: "Пошук по збереженому" },
  { command: "export", description: "Оновити Медіатеку в Obsidian" },
  { command: "review", description: "Підсумок місяця (/review 2026 — року)" },
  { command: "enrich", description: "Дозаповнити старі записи" },
  { command: "cancel", description: "Вийти з діалогу" },
];

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
    const mid = await send(
      `${head} ${saved.length}: ${mix}.` + (open ? `\nБез вражень: ${open}.` : ""),
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
const slideButtons = (r: Review, index: number) => {
  const n = r.slides.length;
  return n > 1
    ? {
        inline_keyboard: [
          [button("←", `slide:${(index - 1 + n) % n}`), button("→", `slide:${(index + 1) % n}`)],
        ],
      }
    : undefined;
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
          notes: s
            .reflections(id)
            .slice(-3)
            .map((r) => r.body),
          raw,
          allowQuestion: options.question,
          evidence: options.evidence,
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
    const id = await loadMetadata(s.capture(update, text, capturedAt, note));
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
      .filter((i) => (services.metadata && needsMetadata(i)) || (ai && !i.ai_done))
      .slice(0, 20);
    if (!todo.length) {
      await send("Оновлювати нічого.", menu);
      return;
    }
    let done = 0;
    for (const start of todo) {
      const id = await loadMetadata(start.id);
      const item = s.item(id)!;
      if (ai && !item.ai_done) {
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
        }).catch(() => null);
        s.applyAI(id, suggestion);
      }
      const after = s.item(id)!;
      if (!needsMetadata(after) || after.ai_done) done++;
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

  // The item a short comment belongs to: the last capture, if it was a bare link sent moments ago.
  function attachTarget(text: string) {
    if (text.includes("\n") || text.length > 80) return null;
    const last = s.lastCapture();
    if (!last) return null;
    const age = at.getTime() - Date.parse(last.created_at);
    const item = s.item(last.item_id);
    if (!item?.url || age < 0 || age > ATTACH_WINDOW || s.reflections(item.id).length) return null;
    return item;
  }

  async function onText(text: string) {
    const replyTo = m.reply_to_message?.message_id;
    const paged = pagerOf(replyTo);
    const reply = paged ? { item_id: paged.ids[paged.index] } : replyTo ? s.prompt(replyTo) : null;
    const target = attachTarget(text);
    if (reply) await remember(reply.item_id, text, s.value(`followup:${replyTo}`) !== undefined);
    else if (replyTo) await send("Не знаю, до якого запису це. Натисни «Додати думку» під карткою.", menu);
    else if (active?.mode === "edit") await applyEdit(text);
    else if (findUrl(text)) await capture(text);
    else if (active?.mode === "reflection") await remember(active.id, text, active.followup);
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
      s.setContext(null);
      await send("Скасовано.", menu);
    } else if (["/start", "/help"].includes(cmd)) {
      s.setContext(null);
      await send(
        "Надішли посилання, текст або голосове — збережу й додам теги. Нові записи позначаю «Ознайомився».\n\n" +
          "Бібліотека — останні, на потім, без вражень\n" +
          "Запитати — пошук по збереженому\n" +
          "Експорт — оновити Медіатеку в Obsidian\n" +
          "У п'ятницю ввечері — короткий підсумок тижня, 1-го числа — підсумок місяця.\n\n" +
          "Решта команд — у меню «/».",
        menu,
      );
    } else if (text === "Бібліотека") {
      s.setContext(null);
      await send("Що показати?", {
        inline_keyboard: [
          [button("Останні", "library:recent"), button("На потім", "library:later")],
          [button("Без вражень", "library:unreviewed"), button("Підсумок місяця", "library:review")],
        ],
      });
    } else if (cmd === "/list" || text === "Останні" || text === "покажи останнє")
      await list("Останні", s.items());
    else if (cmd === "/later" || text === "На потім") await list("На потім", later());
    else if (cmd === "/reflect" || text === "Без вражень") await list("Без вражень", s.unreflected());
    else if (cmd === "/review") {
      const period = text.split(/\s+/)[1] ?? localDate().slice(0, 7);
      if (!validPeriod(period)) await send("Формат: /review, /review 2026-10 або /review 2026.", menu);
      else await showReview(period);
    } else if (cmd === "/enrich") await enrich();
    else if (text === "Експорт" || cmd === "/export") {
      s.setContext(null);
      try {
        const r = (services.export ?? (() => exportVault(s, process.env.OBSIDIAN_VAULT_PATH ?? "")))();
        await send(
          `Експорт: нових ${r.created}, оновлених ${r.updated}, без змін ${r.unchanged}` +
            (r.removed ? `, видалених ${r.removed}` : "") +
            "." +
            (r.conflicts.length
              ? "\nПропущено, бо змінено вручну: " + r.conflicts.slice(0, 5).join(", ")
              : "") +
            (r.kept?.length
              ? "\nЗапис видалено, але нотатку з ручними правками залишено: " + r.kept.slice(0, 5).join(", ")
              : "") +
            (r.overviewConflict ? "\nМедіатека.md змінено вручну — не перезаписано." : ""),
          menu,
        );
      } catch (e) {
        await send(`Експорт не вдався: ${e instanceof Error ? e.message : "невідома помилка"}`, menu);
      }
    } else if (text === "Запитати" || text === "Пошук" || cmd === "/ask" || cmd === "/search") {
      const query = text.startsWith("/") ? text.slice(text.indexOf(" ") + 1).trim() : "";
      if (!query || text === cmd) {
        s.setContext({ mode: "ask", history: [], expires: until() });
        await send("Що шукаєш? Напр. «щось про Відьмака», далі можна «а тільки відео?».", dialogMenu);
      } else await ask(query, active);
    } else if (text.startsWith("/"))
      await send(`Невідома команда. Є ${commands.map((c) => "/" + c.command).join(", ")}.`, menu);
    else await onText(text);
  }

  async function onCallback() {
    const parts = String(c.data ?? "").split(":");
    const action = parts[0];
    const id = parts.at(-1)!;
    if (action === "library") {
      if (parts[1] === "later") await list("На потім", later(), here);
      else if (parts[1] === "unreviewed") await list("Без вражень", s.unreflected(), here);
      else if (parts[1] === "review") await showReview(localDate().slice(0, 7), here);
      else await list("Останні", s.items(), here);
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
