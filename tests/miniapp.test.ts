import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkInitData, INIT_DATA_MAX_AGE } from "../src/miniapp/auth.ts";
import { MINIAPP_HOST, miniAppPort, startMiniApp } from "../src/miniapp/server.ts";

const TOKEN = "123456:test-token";
const OWNER = 42;
const NOW = new Date("2026-11-09T12:00:00Z");
const seconds = Math.floor(NOW.getTime() / 1000);

// Builds initData the way Telegram does: sorted fields, HMAC keyed with HMAC("WebAppData", token).
function sign(fields: Record<string, string>, token = TOKEN) {
  const text = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(token).digest();
  const hash = createHmac("sha256", secret).update(text).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}

const fields = (over: Record<string, string> = {}) => ({
  auth_date: String(seconds - 60),
  query_id: "AAH",
  signature: "sig",
  user: JSON.stringify({ id: OWNER, first_name: "Ігор" }),
  ...over,
});

test("initData: valid data of the owner passes", () => {
  assert.deepEqual(checkInitData(sign(fields()), TOKEN, OWNER, NOW), { ok: true, userId: OWNER });
});

test("initData: refusals", () => {
  const refused = (initData: string, owner = OWNER, token = TOKEN, now = NOW) =>
    assert.equal(checkInitData(initData, token, owner, now).ok, false);
  refused("");
  refused("garbage");
  refused(sign(fields(), "999:other-token"));
  refused(sign(fields()), 43);
  refused(sign(fields({ user: JSON.stringify({ id: 43 }) })));
  refused(sign(fields({ user: "not json" })));
  refused(sign(fields({ user: JSON.stringify({ id: String(OWNER) }) })));
  refused(sign(fields({ auth_date: String(seconds - INIT_DATA_MAX_AGE - 1) })));
  refused(sign(fields({ auth_date: String(seconds + 3600) })));
  refused(sign(fields({ auth_date: "soon" })));
  const { user: _user, ...withoutUser } = fields();
  refused(sign(withoutUser));
  // A field changed after signing, a missing or malformed hash.
  refused(sign(fields()).replace("query_id=AAH", "query_id=AAI"));
  refused(sign(fields()).replace(/hash=[0-9a-f]+/, "hash=abc"));
  refused(new URLSearchParams(fields()).toString());
});

test("initData: the owner must be configured", () => {
  assert.equal(checkInitData(sign(fields()), TOKEN, Number.NaN, NOW).ok, false);
  assert.equal(checkInitData(sign(fields()), "", OWNER, NOW).ok, false);
});

test("MINIAPP_PORT: default, off, number, invalid", () => {
  assert.equal(miniAppPort(undefined), 8787);
  assert.equal(miniAppPort(" "), 8787);
  assert.equal(miniAppPort("OFF"), null);
  assert.equal(miniAppPort("9000"), 9000);
  assert.throws(() => miniAppPort("0"));
  assert.throws(() => miniAppPort("99999"));
  assert.throws(() => miniAppPort("abc"));
});

let dir: string;
let base: string;
let close: () => void;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "miniapp-"));
  mkdirSync(join(dir, "dist/assets"), { recursive: true });
  writeFileSync(join(dir, "dist/index.html"), "<!doctype html><title>app</title>");
  writeFileSync(join(dir, "dist/assets/app.js"), "console.log(1)");
  writeFileSync(join(dir, "secret.txt"), "outside the build");
  const server = await startMiniApp(
    { token: TOKEN, owner: OWNER, staticDir: join(dir, "dist"), now: () => NOW },
    0,
  );
  assert.ok(server);
  base = `http://${MINIAPP_HOST}:${(server.address() as AddressInfo).port}`;
  close = () => {
    server.closeAllConnections();
    server.close();
  };
});

after(() => {
  close();
  rmSync(dir, { recursive: true, force: true });
});

const auth = (initData: string) => ({ authorization: `tma ${initData}` });

test("server listens on loopback only", async () => {
  const server = await startMiniApp({ token: TOKEN, owner: OWNER, staticDir: dir }, 0);
  assert.ok(server);
  assert.equal((server.address() as AddressInfo).address, "127.0.0.1");
  server.close();
});

test("a busy port does not throw", async () => {
  const port = Number(new URL(base).port);
  assert.equal(await startMiniApp({ token: TOKEN, owner: OWNER, staticDir: dir }, port), null);
});

test("API: no answer without valid initData of the owner", async () => {
  const noHeader = await fetch(`${base}/api/me`);
  assert.equal(noHeader.status, 401);
  for (const headers of [
    { authorization: "Bearer x" },
    auth("garbage"),
    auth(sign(fields(), "999:other-token")),
    auth(sign(fields({ user: JSON.stringify({ id: 43 }) }))),
    auth(sign(fields({ auth_date: String(seconds - INIT_DATA_MAX_AGE - 5) }))),
  ]) {
    const response = await fetch(`${base}/api/me`, { headers });
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "unauthorized" });
  }
  // Unknown routes do not reveal anything either without credentials.
  assert.equal((await fetch(`${base}/api/nothing`)).status, 401);
  assert.equal((await fetch(`${base}/api`)).status, 401);
});

test("API: the owner gets data, unknown routes are 404", async () => {
  const headers = auth(sign(fields()));
  const me = await fetch(`${base}/api/me`, { headers });
  assert.equal(me.status, 200);
  assert.equal(me.headers.get("cache-control"), "no-store");
  assert.deepEqual(await me.json(), { userId: OWNER });
  assert.equal((await fetch(`${base}/api/nothing`, { headers })).status, 404);
});

test("only GET and HEAD are allowed", async () => {
  for (const path of ["/", "/api/me"]) {
    const response = await fetch(`${base}${path}`, { method: "POST", headers: auth(sign(fields())) });
    assert.equal(response.status, 405);
  }
});

test("static files: index, assets, app screens fall back to index.html", async () => {
  const index = await fetch(`${base}/`);
  assert.equal(index.status, 200);
  assert.equal(index.headers.get("content-type"), "text/html; charset=utf-8");
  assert.equal(index.headers.get("cache-control"), "no-cache");
  assert.match(
    index.headers.get("content-security-policy") ?? "",
    /script-src 'self' https:\/\/telegram.org/,
  );
  assert.equal(index.headers.get("x-content-type-options"), "nosniff");

  const script = await fetch(`${base}/assets/app.js`);
  assert.equal(script.headers.get("content-type"), "text/javascript; charset=utf-8");
  assert.match(script.headers.get("cache-control") ?? "", /immutable/);
  assert.equal(await script.text(), "console.log(1)");

  assert.match(await (await fetch(`${base}/diary`)).text(), /<title>app<\/title>/);
  assert.equal((await fetch(`${base}/assets/missing.js`)).status, 404);
  assert.equal((await fetch(`${base}/`, { method: "HEAD" })).status, 200);
});

test("static files: no path escapes the build folder", async () => {
  for (const path of [
    "/../secret.txt",
    "/%2e%2e/secret.txt",
    "/..%2fsecret.txt",
    "/assets/%00.js",
    "/%E0%A4%A",
  ]) {
    const response = await fetch(`${base}${path}`);
    assert.doesNotMatch(await response.text(), /outside the build/, path);
  }
  // fetch normalizes "/../" itself, so send the raw request line too.
  const { request } = await import("node:http");
  const status = await new Promise<number>((done) => {
    const req = request({ host: MINIAPP_HOST, port: new URL(base).port, path: "/../secret.txt" }, (res) => {
      res.resume();
      done(res.statusCode ?? 0);
    });
    req.end();
  });
  assert.notEqual(status, 200);
});
