import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { extname, resolve, sep } from "node:path";
import type { JournalStore } from "../journal.ts";
import type { Store } from "../store.ts";
import { checkInitData } from "./auth.ts";
import { diaryEntry, diaryList, ideaList, type DiaryRow, type IdeaRow } from "./data.ts";
import { libraryCover, libraryFilter, libraryItem, libraryList } from "./library.ts";
import {
  addDiaryEntry,
  addIdea,
  addImpression,
  editItem,
  deleteIdea,
  resolveIdea,
  type Written,
} from "./write.ts";

// Listens on loopback only: the outside world reaches it through `tailscale serve <port>`.
export const MINIAPP_HOST = "127.0.0.1";
export const MINIAPP_DEFAULT_PORT = 8787;
export const MINIAPP_DIST = resolve(import.meta.dirname, "../../miniapp-dist");

export type MiniAppOptions = {
  token: string;
  owner: number;
  // Diary and ideas; without it those routes answer 503 and the rest of the app still works.
  journal?: JournalStore;
  // The media library the screens read and edit (type, state, reaction, tags, impressions). Without it: 503.
  store?: Store;
  staticDir?: string;
  now?: () => Date;
};

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
};

// Telegram's own script is the only third-party origin. Framing stays allowed: Telegram Web embeds the app.
const SECURITY = {
  "content-security-policy":
    "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; base-uri 'none'; form-action 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

function send(
  res: ServerResponse,
  status: number,
  body: string | Buffer,
  headers: Record<string, string> = {},
) {
  res.writeHead(status, { ...SECURITY, ...headers });
  res.end(body);
}

function json(res: ServerResponse, status: number, value: unknown) {
  send(res, status, JSON.stringify(value), {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
}

const diaryRows = (journal: JournalStore) =>
  journal.all("SELECT id, entry_date, body FROM journal_entries") as DiaryRow[];
const ideaRows = (journal: JournalStore) =>
  journal.all("SELECT id, idea_date, idea_time, body, resolved_at FROM ideas") as IdeaRow[];

const MAX_BODY = 512 * 1024;
const WRITE_METHODS = ["POST", "PATCH"];

class Refused extends Error {
  status: number;
  constructor(status: number) {
    super(`refused ${status}`);
    this.status = status;
  }
}

// A JSON body of bounded size. Runs only after initData was verified, so only the owner can make the server read.
// An oversized body is still read to the end (and dropped), so the client gets its 413 instead of a broken connection.
async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size <= MAX_BODY) chunks.push(chunk as Buffer);
  }
  if (size > MAX_BODY) throw new Refused(413);
  if (!/^application\/json\b/i.test(req.headers["content-type"] ?? "")) throw new Refused(415);
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Refused(400);
  }
}

const answer = <T>(res: ServerResponse, result: Written<T>, ok = 200) =>
  result.ok ? json(res, ok, result.value) : json(res, result.status, { error: result.error });

const LIBRARY_ID = /^\/api\/library\/([^/]+?)(\/cover|\/impressions)?$/;
const notFound = (res: ServerResponse) => json(res, 404, { error: "not_found" });
const unavailable = (res: ServerResponse) => json(res, 503, { error: "unavailable" });

async function library(req: IncomingMessage, url: URL, res: ServerResponse, store: Store | undefined) {
  if (!store) return unavailable(res);
  const write = WRITE_METHODS.includes(req.method ?? "");
  if (url.pathname === "/api/library") {
    if (write) return json(res, 405, { error: "method_not_allowed" });
    return json(res, 200, libraryList(store, libraryFilter(url.searchParams)));
  }
  const match = LIBRARY_ID.exec(url.pathname);
  if (!match) return notFound(res);
  let id: string;
  try {
    id = decodeURIComponent(match[1]);
  } catch {
    return notFound(res);
  }
  if (write) {
    const impressions = match[2] === "/impressions";
    if (req.method !== (impressions ? "POST" : "PATCH") || (match[2] && !impressions))
      return json(res, 405, { error: "method_not_allowed" });
    const input = await readBody(req);
    const result = impressions ? addImpression(store, id, input) : editItem(store, id, input);
    if (!result.ok) return answer(res, result);
    // The screen shows the item as it is now, so it needs no second request.
    return json(res, 200, libraryItem(store, id));
  }
  if (match[2]) {
    const cover = libraryCover(store, id);
    if (!cover) return notFound(res);
    return send(res, 200, await readFile(cover.path), {
      "content-type": cover.type,
      "cache-control": "private, max-age=3600",
    });
  }
  const item = libraryItem(store, id);
  return item ? json(res, 200, item) : notFound(res);
}

// Every route gets here only after initData was verified.
async function route(
  req: IncomingMessage,
  url: URL,
  userId: number,
  res: ServerResponse,
  options: MiniAppOptions,
) {
  const path = url.pathname;
  if (path === "/api/me")
    return req.method === "GET"
      ? json(res, 200, { userId })
      : json(res, 405, { error: "method_not_allowed" });
  if (path === "/api/library" || path.startsWith("/api/library/"))
    return library(req, url, res, options.store);
  const diary = /^\/api\/diary\/(\d{1,15})$/.exec(path);
  const idea = /^\/api\/ideas\/(\d{1,15})\/(resolve|restore|delete)$/.exec(path);
  if (path !== "/api/diary" && path !== "/api/ideas" && !diary && !idea) return notFound(res);
  const journal = options.journal;
  if (!journal) return unavailable(res);
  const method = req.method ?? "GET";
  if (method === "POST") {
    if (path === "/api/diary")
      return answer(res, addDiaryEntry(journal, await readBody(req), options.now?.()), 201);
    if (path === "/api/ideas")
      return answer(res, addIdea(journal, await readBody(req), options.now?.()), 201);
    if (idea?.[2] === "delete") return answer(res, deleteIdea(journal, Number(idea[1])));
    if (idea)
      return answer(res, resolveIdea(journal, Number(idea[1]), idea[2] === "resolve", options.now?.()));
  }
  if (method !== "GET" && method !== "HEAD") return json(res, 405, { error: "method_not_allowed" });
  if (idea) return json(res, 405, { error: "method_not_allowed" });
  const q = url.searchParams.get("q") ?? undefined;
  if (path === "/api/diary") return json(res, 200, diaryList(diaryRows(journal), q));
  if (diary) {
    const entry = diaryEntry(diaryRows(journal), Number(diary[1]));
    return entry ? json(res, 200, entry) : notFound(res);
  }
  return json(res, 200, ideaList(ideaRows(journal), q));
}

async function api(req: IncomingMessage, res: ServerResponse, url: URL, options: MiniAppOptions) {
  const header = req.headers.authorization ?? "";
  const checked = header.startsWith("tma ")
    ? checkInitData(header.slice(4), options.token, options.owner, options.now?.())
    : ({ ok: false } as const);
  // One answer for every refusal, so nothing reveals which check failed.
  if (!checked.ok) return json(res, 401, { error: "unauthorized" });
  return route(req, url, checked.userId, res, options);
}

async function file(root: string, path: string) {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null;
  }
  if (decoded.includes("\0")) return null;
  const target = resolve(root, "." + decoded);
  if (target !== root && !target.startsWith(root + sep)) return null;
  const info = await stat(target).catch(() => null);
  return info?.isFile() ? target : null;
}

async function assets(req: IncomingMessage, res: ServerResponse, path: string, root: string) {
  let target = await file(root, path);
  // A path without an extension is a screen of the app, not a missing file.
  if (!target && extname(path) === "") target = await file(root, "/index.html");
  if (!target) return send(res, 404, "Not found", { "content-type": "text/plain; charset=utf-8" });
  const html = target.endsWith(".html");
  send(res, 200, req.method === "HEAD" ? "" : await readFile(target), {
    "content-type": TYPES[extname(target)] ?? "application/octet-stream",
    "cache-control": html ? "no-cache" : "public, max-age=31536000, immutable",
  });
}

export function createMiniAppServer(options: MiniAppOptions): Server {
  const root = resolve(options.staticDir ?? MINIAPP_DIST);
  return createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;
      const isApi = path === "/api" || path.startsWith("/api/");
      const reads = req.method === "GET" || req.method === "HEAD";
      // Only the API takes writes; the app's own files are read-only.
      if (!reads && !(isApi && WRITE_METHODS.includes(req.method ?? "")))
        return send(res, 405, "Method not allowed", {
          allow: isApi ? "GET, HEAD, POST, PATCH" : "GET, HEAD",
        });
      if (isApi) return await api(req, res, url, options);
      await assets(req, res, path, root);
    } catch (e) {
      if (e instanceof Refused && !res.headersSent)
        return json(res, e.status, { error: e.status === 413 ? "too_large" : "bad_request" });
      if (!res.headersSent) send(res, 500, "Server error", { "content-type": "text/plain; charset=utf-8" });
      else res.destroy();
    }
  });
}

// "off" disables the server; an unusable value is reported by the caller and skipped.
export function miniAppPort(value: string | undefined): number | null {
  const text = (value ?? "").trim().toLowerCase();
  if (text === "off") return null;
  if (text === "") return MINIAPP_DEFAULT_PORT;
  const port = Number(text);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error("MINIAPP_PORT: очікується номер порту або off.");
  return port;
}

// Failing to listen (busy port) must not take the bot down: the Mini App is optional.
export function startMiniApp(options: MiniAppOptions, port: number): Promise<Server | null> {
  const server = createMiniAppServer(options);
  return new Promise((done) => {
    server.once("error", (e: NodeJS.ErrnoException) => {
      console.error(`Mini App не запущено: ${e.code ?? "помилка"} на порту ${port}.`);
      done(null);
    });
    server.listen(port, MINIAPP_HOST, () => {
      server.on("error", () => console.error("Mini App: помилка сервера."));
      console.log(`Mini App слухає ${MINIAPP_HOST}:${(server.address() as AddressInfo).port}.`);
      done(server);
    });
  });
}
