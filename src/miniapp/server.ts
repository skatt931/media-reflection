import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { readFile, stat } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import { extname, resolve, sep } from "node:path";
import { checkInitData } from "./auth.ts";

// Listens on loopback only: the outside world reaches it through `tailscale serve <port>`.
export const MINIAPP_HOST = "127.0.0.1";
export const MINIAPP_DEFAULT_PORT = 8787;
export const MINIAPP_DIST = resolve(import.meta.dirname, "../../miniapp-dist");

export type MiniAppOptions = {
  token: string;
  owner: number;
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
    "default-src 'self'; script-src 'self' https://telegram.org; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; form-action 'none'",
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

// Returns undefined for an unknown route. Every route gets here only after initData was verified.
function route(path: string, userId: number): unknown {
  if (path === "/api/me") return { userId };
  return undefined;
}

async function api(req: IncomingMessage, res: ServerResponse, path: string, options: MiniAppOptions) {
  const header = req.headers.authorization ?? "";
  const checked = header.startsWith("tma ")
    ? checkInitData(header.slice(4), options.token, options.owner, options.now?.())
    : ({ ok: false } as const);
  // One answer for every refusal, so nothing reveals which check failed.
  if (!checked.ok) return json(res, 401, { error: "unauthorized" });
  const body = route(path, checked.userId);
  return body === undefined ? json(res, 404, { error: "not_found" }) : json(res, 200, body);
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
      if (req.method !== "GET" && req.method !== "HEAD")
        return send(res, 405, "Method not allowed", { allow: "GET, HEAD" });
      const path = new URL(req.url ?? "/", "http://localhost").pathname;
      if (path === "/api" || path.startsWith("/api/")) return await api(req, res, path, options);
      await assets(req, res, path, root);
    } catch {
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
