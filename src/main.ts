import { readFileSync } from "node:fs";
import { Store } from "./store.ts";
import { handle, weekly, reviews, diaryAutosave, commands, type Send } from "./bot.ts";
import { JournalStore } from "./journal.ts";
import { createRuntime } from "./runtime.ts";
import { setTimeout as sleep } from "node:timers/promises";
import type { Server } from "node:http";
import { miniAppPort, startMiniApp } from "./miniapp/server.ts";

const token = process.env.TELEGRAM_BOT_TOKEN;
const owner = Number(process.env.TELEGRAM_USER_ID);
if (!token || !Number.isSafeInteger(owner) || owner <= 0) {
  console.error("Спочатку виконай npm run setup: потрібні TELEGRAM_BOT_TOKEN та TELEGRAM_USER_ID.");
  process.exit(1);
}
process.umask(0o077);
let running = true;
const abort = new AbortController();
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.on(signal, () => {
    running = false;
    abort.abort();
  });

type TelegramError = Error & { code?: number; retry?: number; description?: string; method?: string };
async function api(method: string, body: object | FormData = {}) {
  const form = body instanceof FormData;
  let data: any;
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      ...(form ? {} : { headers: { "content-type": "application/json" } }),
      body: form ? body : JSON.stringify(body),
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(40000)]),
    });
    data = await response.json();
    data.error_code ??= data.ok ? undefined : response.status;
  } catch (e) {
    if (e instanceof Error) (e as TelegramError).method = method;
    throw e;
  }
  if (!data.ok) {
    const e = new Error(`Telegram ${method}: code ${data.error_code}`) as TelegramError;
    e.code = data.error_code;
    e.retry = data.parameters?.retry_after ?? 0;
    e.description = data.description;
    throw e;
  }
  return data.result;
}

const clip = (text: string, max: number) => (text.length > max ? text.slice(0, max - 1) + "…" : text);
const markup = (keyboard: unknown) => (keyboard ? { reply_markup: keyboard } : {});

async function sendPhoto(text: string, keyboard: unknown, out: NonNullable<Parameters<Send>[2]>) {
  const photo = out.photo!;
  const caption = clip(text, 1024);
  const quiet = out.silent ? { disable_notification: true } : {};
  if (photo.fileId) {
    try {
      return await api("sendPhoto", {
        chat_id: owner,
        photo: photo.fileId,
        caption,
        ...markup(keyboard),
        ...quiet,
      });
    } catch (e) {
      if ((e as TelegramError).code !== 400) throw e;
    }
  }
  const form = new FormData();
  form.append("chat_id", String(owner));
  form.append("caption", caption);
  if (out.silent) form.append("disable_notification", "true");
  if (keyboard) form.append("reply_markup", JSON.stringify(keyboard));
  form.append("photo", new Blob([readFileSync(photo.path)]), "cover");
  const sent = await api("sendPhoto", form);
  const fileId = sent.photo?.at(-1)?.file_id;
  if (fileId) photo.onUpload?.(fileId);
  return sent;
}

async function sendDocument(text: string, keyboard: unknown, out: NonNullable<Parameters<Send>[2]>) {
  const document = out.document!;
  const form = new FormData();
  form.append("chat_id", String(owner));
  form.append("caption", clip(text, 1024));
  if (keyboard) form.append("reply_markup", JSON.stringify(keyboard));
  form.append("document", new Blob([new Uint8Array(document.bytes)]), document.name);
  return api("sendDocument", form);
}

const send: Send = async (text, keyboard, out = {}) => {
  if (out.react) {
    try {
      await api("setMessageReaction", {
        chat_id: owner,
        message_id: out.react,
        reaction: [{ type: "emoji", emoji: "👌" }],
      });
      return out.react;
    } catch (e) {
      if ((e as TelegramError).code !== 400) throw e;
      // Reactions are unavailable for this message: a plain "✓" says the same.
    }
  }
  if (out.edit) {
    const target = { chat_id: owner, message_id: out.edit.id };
    try {
      if (out.markupOnly)
        await api("editMessageReplyMarkup", { ...target, reply_markup: keyboard ?? { inline_keyboard: [] } });
      else if (out.edit.caption)
        await api("editMessageCaption", { ...target, caption: clip(text, 1024), ...markup(keyboard) });
      else await api("editMessageText", { ...target, text: clip(text, 4096), ...markup(keyboard) });
      return out.edit.id;
    } catch (e) {
      const err = e as TelegramError;
      if (err.code === 400 && err.description?.includes("not modified")) return out.edit.id;
      if (err.code !== 400) throw e;
      // The message can no longer be edited: send the same content as a new one.
    }
  }
  if (out.document) return (await sendDocument(text, keyboard, out)).message_id;
  if (out.photo) {
    try {
      return (await sendPhoto(text, keyboard, out)).message_id;
    } catch (e) {
      if ((e as TelegramError).code !== 400) throw e;
    }
  }
  const sent = await api("sendMessage", {
    chat_id: owner,
    text: clip(text, 4096),
    ...markup(keyboard),
    ...(out.silent ? { disable_notification: true } : {}),
  });
  return sent.message_id;
};

// The menu button opens the Mini App; the HTTP server inside the bot serves it (exposed by `tailscale serve`).
async function openMiniApp() {
  try {
    const port = miniAppPort(process.env.MINIAPP_PORT);
    if (port) miniApp = await startMiniApp({ token: token!, owner, store, journal }, port);
  } catch (e) {
    console.error(e instanceof Error ? e.message : "Mini App не запущено.");
  }
  const url = (process.env.MINIAPP_URL ?? "").trim();
  if (!url) return;
  if (!/^https:\/\/[^\s/]+/.test(url)) return console.error("MINIAPP_URL: потрібна HTTPS-адреса.");
  await api("setChatMenuButton", {
    chat_id: owner,
    menu_button: { type: "web_app", text: "Відкрити", web_app: { url } },
  }).catch(() => console.error("Не вдалося налаштувати кнопку меню."));
}

let store: Store | undefined;
let journal: JournalStore | undefined;
let miniApp = null as Server | null;
try {
  const me = await api("getMe");
  const hook = await api("getWebhookInfo");
  if (hook.url)
    throw new Error("У бота активний webhook, long polling не працюватиме. Вимкни його через deleteWebhook.");
  store = new Store(process.env.DB_PATH ?? "./data/media.sqlite");
  store.prune();
  await api("setMyCommands", { commands }).catch(() => console.error("Не вдалося оновити меню команд."));
  journal = new JournalStore(process.env.JOURNAL_DB_PATH ?? "./data/journal.sqlite");
  await openMiniApp();
  const runtime = createRuntime(store);
  const services = { ...runtime.services, journal };
  console.log(`Бот @${me.username} запущено. Ctrl+C — зупинити.`);
  let failures = 0;
  while (running) {
    try {
      await weekly(store, send, new Date(), undefined, journal);
      await diaryAutosave(store, journal, send);
      await reviews(store, send);
      const updates = await api("getUpdates", {
        offset: store.offset(),
        timeout: 25,
        allowed_updates: ["message", "callback_query"],
      });
      for (const u of updates) {
        if (!running) break;
        const notice = await handle(store, u, owner, send, runtime.ai, services);
        if (u.callback_query)
          await api("answerCallbackQuery", {
            callback_query_id: u.callback_query.id,
            ...(notice ? { text: notice } : {}),
          }).catch(() => {});
      }
      failures = 0;
    } catch (e) {
      if (!running) break;
      const err = e as TelegramError;
      if (err.code === 401 || err.code === 409) throw err;
      // A long poll on a connection that died (Mac sleep, Wi-Fi change) only ends by timeout.
      // The update is still waiting on Telegram's side, so reconnect at once.
      if (err.name === "TimeoutError" && err.method === "getUpdates") {
        console.error("Зв'язок із Telegram обірвався, перепідключаюсь.");
        continue;
      }
      const delay = Math.max(err.retry ?? 0, Math.min(30, 2 ** Math.min(++failures, 5)));
      const reason =
        err.name === "TimeoutError"
          ? `Telegram не відповів на ${err.method ?? "запит"} за 40 с`
          : `Помилка${err.code ? " " + err.code : ""}${err.method ? " (" + err.method + ")" : ""}`;
      console.error(`${reason}, повтор через ${delay} с.`);
      await sleep(delay * 1000, undefined, { signal: abort.signal }).catch(() => {});
    }
  }
} catch (e) {
  if (running) {
    console.error(
      e instanceof Error && !e.message.includes(token)
        ? e.message
        : "Помилка запуску. Перевір налаштування та мережу.",
    );
    process.exitCode = 1;
  }
} finally {
  miniApp?.closeAllConnections();
  miniApp?.close();
  store?.close();
  journal?.close();
}
