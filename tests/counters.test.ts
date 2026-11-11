import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { JournalStore, exportIdeas, exportJournal, journalSchemaVersion } from "../src/journal.ts";
import { Store } from "../src/store.ts";
import { buildExport } from "../src/export-package.ts";
import { handleLine } from "../src/mcp/server.ts";
import { callTool } from "../src/mcp/tools.ts";
import { addDays } from "../src/fields.ts";
import { MINIAPP_HOST, startMiniApp } from "../src/miniapp/server.ts";
import { counterDetail, counterList, daysBetween } from "../src/miniapp/counter-data.ts";
import {
  MAX_COUNTERS,
  addCounter,
  hideDiary,
  markCounter,
  readCounter,
  readCounters,
  removeCounter,
  renameCounter,
  unmarkCounter,
} from "../src/miniapp/counters.ts";

const NOW = new Date("2026-11-11T12:00:00Z");
const TODAY = "2026-11-11";
const at = (date: string) => new Date(`${date}T12:00:00Z`);

const newStore = () => new JournalStore(":memory:");
const mustAdd = (journal: JournalStore, name: string, kind: string, since?: string) => {
  const result = addCounter(journal, { name, kind, since }, NOW);
  assert.ok(result.ok, JSON.stringify(result));
  return result.value.id;
};
const days = (journal: JournalStore, id: number | string) => readCounter(journal, String(id), NOW)!.days;

test("days are the difference of calendar dates, so a clock change never moves them", () => {
  assert.equal(daysBetween("2026-11-11", "2026-11-11"), 0);
  assert.equal(daysBetween("2026-11-10", "2026-11-11"), 1);
  assert.equal(daysBetween("2026-03-28", "2026-03-30"), 2);
  assert.equal(daysBetween("2026-10-24", "2026-10-26"), 2);
  assert.equal(daysBetween("2025-12-31", "2026-01-01"), 1);
});

test("the tables are added without a migration: user_version stays, and a file opened twice is fine", () => {
  const store = newStore();
  assert.equal(Number(store.all("PRAGMA user_version")[0].user_version), journalSchemaVersion);
  for (const table of ["counters", "counter_marks", "counter_prefs"])
    assert.equal(store.all("SELECT name FROM sqlite_master WHERE type='table' AND name=?", table).length, 1);
  // Opening the same file twice (the bot and the MCP process do) is harmless.
  const dir = mkdtempSync(join(tmpdir(), "counters-"));
  try {
    const path = join(dir, "journal.sqlite");
    new JournalStore(path).close();
    const again = new JournalStore(path);
    again.run("INSERT INTO counters(name,kind,started_on,created_at) VALUES('a','done','2026-11-01','x')");
    again.close();
    const third = new JournalStore(path);
    assert.equal(third.all("SELECT count(*) AS n FROM counters")[0].n, 1);
    third.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a «done» counter counts from the last mark and has no number before the first one", () => {
  const journal = newStore();
  const id = mustAdd(journal, "Подзвонити мамі", "done");
  assert.equal(days(journal, id), null);
  assert.ok(markCounter(journal, String(id), { date: "2026-10-30" }, at("2026-10-30")).ok);
  assert.equal(days(journal, id), 12);
  const item = readCounters(journal, NOW).counters[0];
  assert.deepEqual(
    { name: item.name, kind: item.kind, days: item.days, since: item.since, markedToday: item.markedToday },
    { name: "Подзвонити мамі", kind: "done", days: 12, since: "2026-10-30", markedToday: false },
  );
});

test("a mark may be today or yesterday, nothing else, and repeating it changes nothing", () => {
  const journal = newStore();
  const id = String(mustAdd(journal, "Прибирання", "done"));
  for (const date of ["2026-11-12", "2026-11-09", "2026-11-31", "x", 5, null])
    assert.equal(markCounter(journal, id, { date }, NOW).ok, false, String(date));
  assert.ok(markCounter(journal, id, { date: "2026-11-10" }, NOW).ok);
  assert.equal(days(journal, id), 1);
  assert.ok(markCounter(journal, id, { date: TODAY }, NOW).ok);
  assert.ok(markCounter(journal, id, { date: TODAY }, NOW).ok);
  assert.equal(journal.all("SELECT * FROM counter_marks").length, 2);
  assert.equal(days(journal, id), 0);
  assert.equal(readCounters(journal, NOW).counters[0].markedToday, true);
});

test("a yesterday mark never moves the number back past a newer mark", () => {
  const journal = newStore();
  const id = String(mustAdd(journal, "Прибирання", "done"));
  markCounter(journal, id, { date: TODAY }, NOW);
  markCounter(journal, id, { date: "2026-11-10" }, NOW);
  assert.equal(days(journal, id), 0);
});

test("a mark taken back falls to the one before it, and a missing date is not found", () => {
  const journal = newStore();
  const id = String(mustAdd(journal, "Прибирання", "done"));
  markCounter(journal, id, { date: "2026-11-10" }, NOW);
  markCounter(journal, id, { date: TODAY }, NOW);
  assert.ok(unmarkCounter(journal, id, { date: TODAY }).ok);
  assert.equal(days(journal, id), 1);
  const gone = unmarkCounter(journal, id, { date: TODAY });
  assert.deepEqual(gone.ok === false && gone.status, 404);
  assert.ok(unmarkCounter(journal, id, { date: "2026-11-10" }).ok);
  assert.equal(days(journal, id), null);
});

test("a «keep» counter grows from its start, a lapse starts it over and the record stays", () => {
  const journal = newStore();
  const id = String(mustAdd(journal, "Не курю", "keep", "2026-10-08"));
  const first = readCounter(journal, id, NOW)!;
  assert.equal(first.days, 34);
  assert.equal(first.record, null);
  assert.equal(readCounters(journal, NOW).counters[0].markedToday, false);
  const lapse = at("2026-11-11");
  assert.ok(markCounter(journal, id, { date: TODAY }, lapse).ok);
  const after = readCounter(journal, id, NOW)!;
  assert.equal(after.days, 0);
  assert.equal(after.record, 34);
  assert.equal(after.started, "2026-10-08");
  assert.equal(after.since, TODAY);
  // Taking the lapse back returns the long run.
  assert.ok(unmarkCounter(journal, id, { date: TODAY }).ok);
  assert.equal(days(journal, id), 34);
});

test("a lapse is only for today, and the start may not lie in the future", () => {
  const journal = newStore();
  const id = String(mustAdd(journal, "Не курю", "keep", "2026-11-01"));
  assert.equal(markCounter(journal, id, { date: "2026-11-10" }, NOW).ok, false);
  assert.equal(addCounter(journal, { name: "Х", kind: "keep", since: "2026-11-12" }, NOW).ok, false);
  assert.equal(addCounter(journal, { name: "Х", kind: "keep", since: "завтра" }, NOW).ok, false);
  // Without a start it begins today.
  assert.equal(days(journal, mustAdd(journal, "Без початку", "keep")), 0);
});

test("the record is the longest run between starts, the current one included", () => {
  const journal = newStore();
  const id = String(mustAdd(journal, "Не курю", "keep", "2026-09-01"));
  journal.run("INSERT INTO counter_marks VALUES(?,?,?)", Number(id), "2026-09-11", "x");
  journal.run("INSERT INTO counter_marks VALUES(?,?,?)", Number(id), "2026-10-31", "x");
  const detail = readCounter(journal, id, NOW)!;
  assert.equal(detail.record, 50);
  assert.equal(detail.days, 11);
});

test("the detail lists the newest marks first and a done counter has no record", () => {
  const journal = newStore();
  const id = String(mustAdd(journal, "Прибирання", "done"));
  markCounter(journal, id, { date: "2026-11-10" }, NOW);
  markCounter(journal, id, { date: TODAY }, NOW);
  const detail = readCounter(journal, id, NOW)!;
  assert.deepEqual(detail.marks, [TODAY, "2026-11-10"]);
  assert.equal(detail.record, null);
  assert.equal(readCounter(journal, "999", NOW), null);
});

test("names are trimmed, up to 60 characters, unique in any case, and the diary's name is taken", () => {
  const journal = newStore();
  assert.ok(addCounter(journal, { name: "  Подзвонити   мамі ", kind: "done" }, NOW).ok);
  assert.equal(readCounters(journal, NOW).counters[0].name, "Подзвонити мамі");
  for (const name of ["подзвонити мамі", "ПОДЗВОНИТИ МАМІ", "щоденник", "", "   ", "я".repeat(61), 5, null])
    assert.equal(addCounter(journal, { name, kind: "done" }, NOW).ok, false, String(name));
  assert.ok(addCounter(journal, { name: "я".repeat(60), kind: "done" }, NOW).ok);
  assert.equal(addCounter(journal, { name: "Вид", kind: "other" }, NOW).ok, false);
  assert.equal(addCounter(journal, "nope", NOW).ok, false);
});

test("the number of counters is limited", () => {
  const journal = newStore();
  for (let i = 0; i < MAX_COUNTERS; i++) mustAdd(journal, `Лічильник ${i}`, "done");
  const over = addCounter(journal, { name: "Зайвий", kind: "done" }, NOW);
  assert.equal(over.ok, false);
});

test("renaming keeps the history and refuses a name already taken", () => {
  const journal = newStore();
  const a = String(mustAdd(journal, "Мама", "done"));
  const b = String(mustAdd(journal, "Прибирання", "done"));
  markCounter(journal, a, { date: TODAY }, NOW);
  const renamed = renameCounter(journal, a, { name: "Подзвонити мамі" }, NOW);
  assert.ok(renamed.ok && renamed.value.name === "Подзвонити мамі" && renamed.value.days === 0);
  assert.equal(renameCounter(journal, b, { name: "подзвонити мамі" }, NOW).ok, false);
  assert.equal(renameCounter(journal, b, { name: "Прибирання" }, NOW).ok, true);
  assert.equal(renameCounter(journal, "999", { name: "Х" }, NOW).ok, false);
});

test("deleting a counter takes its marks with it and leaves the others", () => {
  const journal = newStore();
  const a = String(mustAdd(journal, "Мама", "done"));
  const b = String(mustAdd(journal, "Прибирання", "done"));
  markCounter(journal, a, { date: TODAY }, NOW);
  markCounter(journal, b, { date: TODAY }, NOW);
  assert.ok(removeCounter(journal, a).ok);
  assert.equal(journal.all("SELECT * FROM counter_marks").length, 1);
  assert.equal(readCounter(journal, a, NOW), null);
  assert.equal(removeCounter(journal, a).ok, false);
  assert.equal(readCounters(journal, NOW).counters.length, 1);
});

test("the diary counts from its newest entry date, without reading its text, and can be hidden", () => {
  const journal = newStore();
  assert.equal(readCounters(journal, NOW).counters.length, 0);
  journal.add({ date: "2026-11-08", body: "приватний текст", source: "bot" });
  journal.add({ date: "2026-11-02", body: "старіший", source: "import", sourceName: "02.11.26.md" });
  const list = readCounters(journal, NOW);
  assert.equal(list.counters.length, 1);
  const diary = list.counters[0];
  assert.deepEqual(
    { id: diary.id, name: diary.name, kind: diary.kind, days: diary.days, hidden: diary.hidden },
    { id: "diary", name: "Щоденник", kind: "auto", days: 3, hidden: false },
  );
  assert.ok(!JSON.stringify(list).includes("приватний"));
  const hidden = hideDiary(journal, { hidden: true });
  assert.ok(hidden.ok);
  assert.equal(readCounters(journal, NOW).counters[0].hidden, true);
  assert.equal(readCounter(journal, "diary", NOW)!.hidden, true);
  assert.ok(hideDiary(journal, { hidden: false }).ok);
  assert.equal(readCounters(journal, NOW).counters[0].hidden, false);
  assert.equal(hideDiary(journal, { hidden: "yes" }).ok, false);
  // The diary is not a counter of its own: it cannot be marked, renamed or deleted.
  assert.equal(markCounter(journal, "diary", { date: TODAY }, NOW).ok, false);
  assert.equal(renameCounter(journal, "diary", { name: "Х" }, NOW).ok, false);
  assert.equal(removeCounter(journal, "diary").ok, false);
});

test("the counters follow creation order, the diary last", () => {
  const journal = newStore();
  journal.add({ date: "2026-11-10", body: "x", source: "bot" });
  mustAdd(journal, "Перший", "done");
  mustAdd(journal, "Другий", "keep");
  assert.deepEqual(
    readCounters(journal, NOW).counters.map((c) => c.name),
    ["Перший", "Другий", "Щоденник"],
  );
});

test("the pure functions answer from plain rows, as the browser mock needs", () => {
  const rows = [{ id: 1, name: "А", kind: "done" as const, started_on: "2026-11-01" }];
  const marks = [{ counter_id: 1, mark_date: "2026-11-08" }];
  const list = counterList(rows, marks, { last: null, hidden: false }, TODAY);
  assert.deepEqual(list, {
    today: TODAY,
    counters: [{ id: "1", name: "А", kind: "done", days: 3, since: "2026-11-08", markedToday: false }],
  });
  assert.equal(counterDetail(rows, marks, { last: null, hidden: false }, "2", TODAY), null);
});

// HTTP: the same checks every route goes through.
const TOKEN = "123456:test-token";
const OWNER = 42;
function sign(fields: Record<string, string>) {
  const text = Object.entries(fields)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
  const hash = createHmac("sha256", secret).update(text).digest("hex");
  return new URLSearchParams({ ...fields, hash }).toString();
}
const headers = {
  authorization: `tma ${sign({
    auth_date: String(Math.floor(NOW.getTime() / 1000) - 60),
    user: JSON.stringify({ id: OWNER }),
  })}`,
  "content-type": "application/json",
};

let dir: string;
let journal: JournalStore;
let base: string;
let close: () => void;
let bare: string;
let closeBare: () => void;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), "counters-http-"));
  journal = new JournalStore(":memory:");
  const server = await startMiniApp(
    { token: TOKEN, owner: OWNER, journal, now: () => NOW, staticDir: dir },
    0,
  );
  assert.ok(server);
  base = `http://${MINIAPP_HOST}:${(server.address() as AddressInfo).port}`;
  close = () => {
    server.closeAllConnections();
    server.close();
  };
  const other = await startMiniApp({ token: TOKEN, owner: OWNER, now: () => NOW, staticDir: dir }, 0);
  assert.ok(other);
  bare = `http://${MINIAPP_HOST}:${(other.address() as AddressInfo).port}`;
  closeBare = () => {
    other.closeAllConnections();
    other.close();
  };
});
after(() => {
  close();
  closeBare();
  rmSync(dir, { recursive: true, force: true });
});

const call = (path: string, method = "GET", body?: unknown, h: Record<string, string> = headers) =>
  fetch(base + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });

test("every counter route refuses a request without a valid initData", async () => {
  for (const [path, method] of [
    ["/api/counters", "GET"],
    ["/api/counters", "POST"],
    ["/api/counters/1", "GET"],
    ["/api/counters/1", "PATCH"],
    ["/api/counters/1/mark", "POST"],
    ["/api/counters/1/unmark", "POST"],
    ["/api/counters/1/delete", "POST"],
    ["/api/counters/diary/hidden", "POST"],
  ])
    assert.equal(
      (await call(path, method, method === "GET" ? undefined : {}, { "content-type": "application/json" }))
        .status,
      401,
      `${method} ${path}`,
    );
});

test("create, mark, read, take back, rename and delete over HTTP", async () => {
  const created = await call("/api/counters", "POST", { name: "Подзвонити мамі", kind: "done" });
  assert.equal(created.status, 201);
  const { id } = (await created.json()) as { id: number };
  assert.equal((await call(`/api/counters/${id}/mark`, "POST", { date: TODAY })).status, 200);
  const list = (await (await call("/api/counters")).json()) as any;
  assert.equal(list.today, TODAY);
  assert.deepEqual(
    list.counters.map((c: any) => [c.name, c.days, c.markedToday]),
    [["Подзвонити мамі", 0, true]],
  );
  const detail = (await (await call(`/api/counters/${id}`)).json()) as any;
  assert.deepEqual(detail.marks, [TODAY]);
  assert.equal((await call(`/api/counters/${id}/unmark`, "POST", { date: TODAY })).status, 200);
  assert.equal((await call(`/api/counters/${id}/unmark`, "POST", { date: TODAY })).status, 404);
  const renamed = await call(`/api/counters/${id}`, "PATCH", { name: "Мама" });
  assert.equal(((await renamed.json()) as any).name, "Мама");
  assert.equal((await call(`/api/counters/${id}/delete`, "POST", {})).status, 200);
  assert.equal((await call(`/api/counters/${id}`)).status, 404);
});

test("bad input is a 400, an unknown counter a 404, a wrong method a 405", async () => {
  assert.equal((await call("/api/counters", "POST", { name: "", kind: "done" })).status, 400);
  assert.equal((await call("/api/counters", "POST", { name: "Х", kind: "zzz" })).status, 400);
  assert.equal((await call("/api/counters/999/mark", "POST", { date: TODAY })).status, 404);
  assert.equal((await call("/api/counters", "PATCH", {})).status, 405);
  assert.equal((await call("/api/counters/1/mark", "GET")).status, 405);
  assert.equal((await call("/api/counters/abc")).status, 404);
  assert.equal((await call("/api/counters/diary/mark", "POST", {})).status, 404);
  assert.equal((await call("/api/counters/diary/hidden", "POST", { hidden: 1 })).status, 400);
  assert.equal((await call("/api/counters/diary/hidden", "POST", { hidden: true })).status, 200);
});

test("without a journal the counters answer 503 and nothing else breaks", async () => {
  assert.equal((await fetch(`${bare}/api/counters`, { headers })).status, 503);
  assert.equal((await fetch(`${bare}/api/me`, { headers })).status, 200);
});

// Gaps: edge dates, the clock, limits, broken bodies, other callers of the journal.
const prague = (iso: string) => new Date(iso);

test("days across leap days, month ends and the turn of the year", () => {
  assert.equal(daysBetween("2024-02-28", "2024-03-01"), 2);
  assert.equal(daysBetween("2026-02-28", "2026-03-01"), 1);
  assert.equal(daysBetween("2026-01-31", "2026-03-01"), 29);
  assert.equal(daysBetween("2025-01-01", "2026-01-01"), 365);
  assert.equal(daysBetween("2024-01-01", "2025-01-01"), 366);
  assert.equal(daysBetween("2026-11-12", "2026-11-11"), -1);
});

// Date.UTC reads a year 0..99 as 1900..1999. The screens never offer such a date, but the server takes a start
// like "0050-01-01" (validDate accepts it), and then the number of days is wrong by nineteen centuries.
test("a date from the first centuries is counted as that year, not as 19xx", () => {
  assert.equal(daysBetween("0099-12-31", "0100-01-01"), 1);
  assert.equal(daysBetween("0050-01-01", "0051-01-01"), 365);
  const journal = newStore();
  const id = mustAdd(journal, "Давно", "keep", "0050-01-01");
  assert.equal(days(journal, id), Math.round((Date.parse(TODAY) - Date.parse("0050-01-01")) / 864e5));
});

test("«today» is the local calendar day: midnight in Prague moves it, UTC midnight does not", () => {
  const journal = newStore();
  const id = String(mustAdd(journal, "Прибирання", "done"));
  // 23:30 in Prague on 11 November is 22:30 UTC; 00:30 on the 12th is 23:30 UTC.
  const evening = prague("2026-11-11T22:30:00Z");
  const night = prague("2026-11-11T23:30:00Z");
  assert.equal(readCounters(journal, evening).today, "2026-11-11");
  assert.equal(readCounters(journal, night).today, "2026-11-12");
  assert.ok(markCounter(journal, id, { date: "2026-11-11" }, evening).ok);
  assert.equal(readCounter(journal, id, evening)!.days, 0);
  assert.equal(readCounter(journal, id, night)!.days, 1);
  assert.equal(readCounters(journal, night).counters[0].markedToday, false);
  // After midnight yesterday is still allowed, and the day before it is not.
  assert.ok(markCounter(journal, id, { date: "2026-11-11" }, night).ok);
  assert.equal(markCounter(journal, id, { date: "2026-11-10" }, night).ok, false);
  // A start of «today» before midnight is not in the future after it, but «tomorrow» is, in either hour.
  assert.equal(addCounter(journal, { name: "А", kind: "keep", since: "2026-11-12" }, evening).ok, false);
  assert.ok(addCounter(journal, { name: "Б", kind: "keep", since: "2026-11-12" }, night).ok);
});

test("the clock change does not shift the days or the allowed marks", () => {
  const journal = newStore();
  const done = String(mustAdd(journal, "Мама", "done"));
  const keep = String(mustAdd(journal, "Не курю", "keep", "2026-03-27"));
  // Spring forward is on 29 March 2026 (a 23-hour day in Prague), the autumn change on 25 October (25 hours).
  const spring = prague("2026-03-30T00:30:00+02:00");
  assert.equal(readCounters(journal, spring).today, "2026-03-30");
  assert.equal(readCounter(journal, keep, spring)!.days, 3);
  assert.ok(markCounter(journal, done, { date: "2026-03-29" }, spring).ok);
  assert.equal(readCounter(journal, done, spring)!.days, 1);
  const autumn = prague("2026-10-26T00:30:00+01:00");
  const stamp = String(mustAdd(journal, "Осінь", "keep", "2026-10-24"));
  assert.equal(readCounter(journal, stamp, autumn)!.days, 2);
  assert.ok(markCounter(journal, stamp, { date: "2026-10-26" }, autumn).ok);
  assert.equal(readCounter(journal, stamp, autumn)!.days, 0);
  assert.equal(readCounter(journal, stamp, autumn)!.record, 2);
  // The extra hour of 25 October: both 00:30 and 23:30 are that same calendar day.
  assert.equal(readCounters(journal, prague("2026-10-24T22:30:00Z")).today, "2026-10-25");
  assert.equal(readCounters(journal, prague("2026-10-25T22:30:00Z")).today, "2026-10-25");
  assert.equal(readCounters(journal, prague("2026-10-25T23:30:00Z")).today, "2026-10-26");
});

test("the start of a «keep» counter: only real calendar dates, not later than today", () => {
  const journal = newStore();
  for (const since of [
    "2026-02-29",
    "2026-13-01",
    "2026-00-10",
    "2026-1-1",
    "11.11.2026",
    "",
    " ",
    "2026-11-11T00:00:00Z",
    20261101,
    true,
    {},
    [],
  ])
    assert.equal(
      addCounter(journal, { name: "Х", kind: "keep", since }, NOW).ok,
      false,
      JSON.stringify(since),
    );
  for (const since of ["2024-02-29", TODAY, undefined, null])
    assert.ok(addCounter(journal, { name: `Х ${since}`, kind: "keep", since }, NOW).ok, String(since));
  assert.equal(
    days(journal, mustAdd(journal, "Давно", "keep", "2020-02-29")),
    daysBetween("2020-02-29", TODAY),
  );
  assert.equal(readCounters(journal, NOW).counters.length, 5);
});

test("a start given to a «done» counter is checked and changes no number", () => {
  const journal = newStore();
  assert.equal(addCounter(journal, { name: "Х", kind: "done", since: "2027-01-01" }, NOW).ok, false);
  const id = mustAdd(journal, "Мама", "done", "2026-10-01");
  assert.equal(days(journal, id), null);
  assert.equal(readCounter(journal, String(id), NOW)!.started, null);
});

test("names: whitespace of every kind folds into one space, the limit counts the clean name", () => {
  const journal = newStore();
  assert.ok(addCounter(journal, { name: "\n\tПодзвонити\u00a0\r\n мамі\t", kind: "done" }, NOW).ok);
  assert.equal(readCounters(journal, NOW).counters[0].name, "Подзвонити мамі");
  const padded = ` ${"я".repeat(60)} `;
  assert.ok(addCounter(journal, { name: padded, kind: "keep" }, NOW).ok);
  assert.equal(addCounter(journal, { name: "я".repeat(60), kind: "done" }, NOW).ok, false);
  assert.equal(addCounter(journal, { name: `${"я".repeat(58)} я`, kind: "done" }, NOW).ok, true);
  assert.equal(addCounter(journal, { name: `${"я".repeat(60)} я`, kind: "done" }, NOW).ok, false);
  for (const name of [["а"], {}, true, 0, undefined])
    assert.equal(addCounter(journal, { name, kind: "done" }, NOW).ok, false, JSON.stringify(name));
  // Two spaces inside make the same name as one.
  assert.equal(addCounter(journal, { name: "Подзвонити  мамі", kind: "keep" }, NOW).ok, false);
  // «ЩОДЕННИК» in any case and with extra spaces is the diary's name too.
  assert.equal(addCounter(journal, { name: "  ЩОДЕННИК ", kind: "keep" }, NOW).ok, false);
});

test("a refusal says which field: name, kind, since, exists, limit", () => {
  const journal = newStore();
  const error = (input: unknown) => {
    const result = addCounter(journal, input, NOW);
    return result.ok ? "ok" : `${result.status} ${result.error}`;
  };
  assert.equal(error({ kind: "done" }), "400 name");
  assert.equal(error({ name: "Х" }), "400 kind");
  assert.equal(error({ name: "Х", kind: "DONE" }), "400 kind");
  assert.equal(error({ name: "Х", kind: "auto" }), "400 kind");
  assert.equal(error({ name: "Х", kind: "keep", since: "2030-01-01" }), "400 since");
  assert.equal(error(null), "400 name");
  assert.equal(error([{ name: "Х", kind: "done" }]), "400 name");
  assert.equal(error({ name: "Х", kind: "done" }), "ok");
  assert.equal(error({ name: "х", kind: "keep" }), "400 exists");
  for (let i = 1; i < MAX_COUNTERS; i++) assert.equal(error({ name: `Л ${i}`, kind: "done" }), "ok");
  assert.equal(error({ name: "Зайвий", kind: "done" }), "400 limit");
  // «exists» is told before «limit»; the diary does not take a place.
  assert.equal(error({ name: "Х", kind: "done" }), "400 exists");
  journal.add({ date: "2026-11-10", body: "x", source: "bot" });
  assert.equal(readCounters(journal, NOW).counters.length, MAX_COUNTERS + 1);
});

test("the limit is lifted by a deletion, and nothing was written by the refused one", () => {
  const journal = newStore();
  const ids = Array.from({ length: MAX_COUNTERS }, (_, i) => mustAdd(journal, `Л ${i}`, "done"));
  assert.equal(addCounter(journal, { name: "Зайвий", kind: "done" }, NOW).ok, false);
  assert.equal(Number(journal.all("SELECT count(*) AS n FROM counters")[0].n), MAX_COUNTERS);
  assert.ok(removeCounter(journal, String(ids[3])).ok);
  assert.ok(addCounter(journal, { name: "Зайвий", kind: "done" }, NOW).ok);
});

test("a renamed counter may change only the case of its own name, and not take the diary's", () => {
  const journal = newStore();
  const id = String(mustAdd(journal, "Мама", "done"));
  assert.equal(renameCounter(journal, id, { name: "МАМА" }, NOW).ok, true);
  assert.equal(readCounter(journal, id, NOW)!.name, "МАМА");
  for (const input of [
    { name: "щоденник" },
    { name: "" },
    { name: "я".repeat(61) },
    {},
    null,
    "x",
    [],
    { name: 5 },
  ])
    assert.equal(renameCounter(journal, id, input, NOW).ok, false, JSON.stringify(input));
  assert.equal(readCounter(journal, id, NOW)!.name, "МАМА");
  // The id must be a plain number: no sign, zeros, spaces, a fraction or a number too long to be one.
  for (const bad of ["01", "-1", "1.0", " 1", "1 ", "1e1", "", "0".repeat(16), "٣"])
    assert.equal(renameCounter(journal, bad, { name: "Нове" }, NOW).ok, false, JSON.stringify(bad));
  assert.equal(readCounter(journal, id, NOW)!.name, "МАМА");
});

test("the details show 60 marks at most, newest first, and the record still counts all of them", () => {
  const journal = newStore();
  const id = String(mustAdd(journal, "Не курю", "keep", "2025-01-01"));
  // One lapse every second day for 70 lapses, the newest on 10 November.
  for (let i = 0; i < 70; i++)
    journal.run("INSERT INTO counter_marks VALUES(?,?,?)", Number(id), addDays("2026-11-10", -2 * i), "x");
  const detail = readCounter(journal, id, NOW)!;
  assert.equal(detail.marks.length, 60);
  assert.equal(detail.marks[0], "2026-11-10");
  assert.equal(detail.marks[59], addDays("2026-11-10", -118));
  assert.deepEqual(detail.marks, [...detail.marks].sort().reverse());
  // The longest run is the first one, from 1 January 2025 to the oldest lapse, 140 days before 10 November.
  assert.equal(detail.record, daysBetween("2025-01-01", addDays("2026-11-10", -138)));
  assert.equal(detail.days, 1);
});

test("two counters with the same dates keep their marks apart", () => {
  const journal = newStore();
  const a = String(mustAdd(journal, "Мама", "done"));
  const b = String(mustAdd(journal, "Прибирання", "done"));
  for (const id of [a, b]) {
    markCounter(journal, id, { date: "2026-11-10" }, NOW);
    markCounter(journal, id, { date: TODAY }, NOW);
  }
  assert.equal(journal.all("SELECT * FROM counter_marks").length, 4);
  assert.ok(unmarkCounter(journal, a, { date: TODAY }).ok);
  assert.equal(days(journal, a), 1);
  assert.equal(days(journal, b), 0);
  assert.deepEqual(readCounter(journal, b, NOW)!.marks, [TODAY, "2026-11-10"]);
  // A mark is found only on its own counter.
  assert.equal(unmarkCounter(journal, a, { date: TODAY }).ok, false);
  assert.equal(journal.all("SELECT * FROM counter_marks WHERE counter_id=?", Number(b)).length, 2);
  assert.ok(renameCounter(journal, a, { name: "Тато" }, NOW).ok);
  assert.deepEqual(readCounter(journal, b, NOW)!.marks, [TODAY, "2026-11-10"]);
});

test("unmarking checks the date, and cannot be used to reach the other kind's rules", () => {
  const journal = newStore();
  const id = String(mustAdd(journal, "Мама", "done"));
  markCounter(journal, id, { date: TODAY }, NOW);
  for (const date of ["2026-02-30", "x", "", 5, null, undefined, [TODAY], { date: TODAY }])
    assert.equal(unmarkCounter(journal, id, { date }).ok, false, JSON.stringify(date));
  assert.equal(unmarkCounter(journal, id, null).ok, false);
  assert.equal(unmarkCounter(journal, id, "x").ok, false);
  const wrongDate = unmarkCounter(journal, id, { date: "x" });
  assert.deepEqual(wrongDate.ok === false && [wrongDate.status, wrongDate.error], [400, "date"]);
  assert.equal(days(journal, id), 0);
  // A valid but old date that has no mark is a 404, not a 400.
  const none = unmarkCounter(journal, id, { date: "2020-01-01" });
  assert.deepEqual(none.ok === false && none.status, 404);
  // A mark of a past day (put there by hand) can be taken back though it could not be made now.
  journal.run("INSERT INTO counter_marks VALUES(?,?,?)", Number(id), "2026-10-01", "x");
  assert.ok(unmarkCounter(journal, id, { date: "2026-10-01" }).ok);
});

test("a new counter after the newest one was deleted starts with no marks of the old one", () => {
  const journal = newStore();
  const first = mustAdd(journal, "Мама", "done");
  const second = mustAdd(journal, "Прибирання", "done");
  markCounter(journal, String(second), { date: TODAY }, NOW);
  assert.ok(removeCounter(journal, String(second)).ok);
  // SQLite may give the freed id to the next counter; it must not inherit anything.
  const next = mustAdd(journal, "Новий", "done");
  assert.equal(days(journal, next), null);
  assert.deepEqual(readCounter(journal, String(next), NOW)!.marks, []);
  assert.equal(journal.all("SELECT * FROM counter_marks WHERE counter_id=?", first).length, 0);
});

test("a deleted counter leaves no mark behind, even for a «keep» one with many lapses", () => {
  const journal = newStore();
  const id = String(mustAdd(journal, "Не курю", "keep", "2026-01-01"));
  for (const date of ["2026-03-01", "2026-06-01", TODAY])
    journal.run("INSERT INTO counter_marks VALUES(?,?,?)", Number(id), date, "x");
  const other = String(mustAdd(journal, "Мама", "done"));
  markCounter(journal, other, { date: TODAY }, NOW);
  assert.ok(removeCounter(journal, id).ok);
  assert.deepEqual(
    journal.all("SELECT counter_id FROM counter_marks").map((row) => Number(row.counter_id)),
    [Number(other)],
  );
  assert.equal(removeCounter(journal, "diary").ok, false);
  assert.equal(removeCounter(journal, "").ok, false);
  assert.equal(removeCounter(journal, "01").ok, false);
});

test("the diary: a future entry is zero days, and hiding it works before there is a first entry", () => {
  const journal = newStore();
  // With no entries there is no diary counter, yet the choice is remembered for when there is one.
  const early = hideDiary(journal, { hidden: true }, NOW);
  assert.ok(early.ok && early.value === null);
  assert.equal(readCounter(journal, "diary", NOW), null);
  journal.add({ date: "2026-11-20", body: "x", source: "bot" });
  const diary = readCounters(journal, NOW).counters[0];
  assert.deepEqual([diary.days, diary.since, diary.hidden], [0, "2026-11-20", true]);
  const detail = readCounter(journal, "diary", NOW)!;
  assert.deepEqual([detail.marks, detail.started, detail.record], [[], null, null]);
  for (const hidden of [undefined, null, 0, "true", [true]])
    assert.equal(hideDiary(journal, { hidden }).ok, false, JSON.stringify(hidden));
  assert.equal(hideDiary(journal, null).ok, false);
  // Hiding twice is one row.
  hideDiary(journal, { hidden: true });
  hideDiary(journal, { hidden: false });
  assert.equal(Number(journal.all("SELECT count(*) AS n FROM counter_prefs")[0].n), 1);
});

test("the diary is a number of days even when a counter is named alike, and an entry text never leaves", () => {
  const journal = newStore();
  journal.add({ date: "2026-11-09", body: "СЕКРЕТНИЙ_ТЕКСТ", source: "bot" });
  mustAdd(journal, "Щоденник2", "done");
  const text = JSON.stringify([readCounters(journal, NOW), readCounter(journal, "diary", NOW)]);
  assert.ok(!text.includes("СЕКРЕТНИЙ"));
  assert.equal(readCounters(journal, NOW).counters.at(-1)!.days, 2);
});

test("a file made before the counters keeps everything and gets the three tables without a new version", () => {
  const dir = mkdtempSync(join(tmpdir(), "counters-old-"));
  try {
    const path = join(dir, "journal.sqlite");
    const first = new JournalStore(path);
    first.add({ date: "2026-11-02", body: "Давній запис", source: "bot" });
    const idea = first.addIdea({ body: "Ідея", source: "text", date: "2026-11-02", time: "10:00" })!;
    first.close();
    // The same file as the previous release left it: current version, no counter tables.
    const raw = new DatabaseSync(path);
    for (const table of ["counter_marks", "counters", "counter_prefs"]) raw.exec(`DROP TABLE ${table}`);
    const version = Number(raw.prepare("PRAGMA user_version").get()!.user_version);
    assert.equal(version, journalSchemaVersion);
    raw.close();
    const store = new JournalStore(path);
    assert.equal(Number(store.all("PRAGMA user_version")[0].user_version), journalSchemaVersion);
    assert.equal(store.lastEntryDate(), "2026-11-02");
    assert.equal(store.idea(idea).body, "Ідея");
    assert.equal(readCounters(store, NOW).counters.length, 1);
    mustAdd(store, "Мама", "done");
    store.close();
    // And the next start sees the counter that was added.
    const again = new JournalStore(path);
    assert.deepEqual(
      readCounters(again, NOW).counters.map((c) => c.name),
      ["Мама", "Щоденник"],
    );
    again.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the counter tables are separate: no journal table refers to them, so dropping them is safe", () => {
  const dir = mkdtempSync(join(tmpdir(), "counters-drop-"));
  try {
    const path = join(dir, "journal.sqlite");
    const store = new JournalStore(path);
    mustAdd(store, "Мама", "done");
    store.add({ date: "2026-11-02", body: "Запис", source: "bot" });
    store.close();
    const raw = new DatabaseSync(path);
    const others = raw
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE name NOT LIKE 'counter%' AND name NOT LIKE 'sqlite_%'",
      )
      .all() as { name: string; sql: string | null }[];
    assert.ok(others.length > 0);
    for (const row of others) assert.ok(!/counter/i.test(row.sql ?? ""), row.name);
    for (const table of ["counter_marks", "counters", "counter_prefs"]) raw.exec(`DROP TABLE ${table}`);
    assert.equal(raw.prepare("PRAGMA integrity_check").get()!.integrity_check, "ok");
    assert.equal(Number(raw.prepare("SELECT count(*) AS n FROM journal_entries").get()!.n), 1);
    raw.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a file written by a newer version is still refused, and no counter table is added to it", () => {
  const dir = mkdtempSync(join(tmpdir(), "counters-new-"));
  try {
    const path = join(dir, "journal.sqlite");
    const raw = new DatabaseSync(path);
    raw.exec(`PRAGMA user_version=${journalSchemaVersion + 1}`);
    raw.close();
    assert.throws(() => new JournalStore(path), /версію/);
    const check = new DatabaseSync(path);
    assert.equal(
      check.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name LIKE 'counter%'").get()!.n,
      0,
    );
    check.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the table refuses a kind that is neither «done» nor «keep», and a mark twice for one day", () => {
  const journal = newStore();
  assert.throws(() =>
    journal.run("INSERT INTO counters(name,kind,started_on,created_at) VALUES('a','auto','2026-11-01','x')"),
  );
  const id = mustAdd(journal, "Мама", "done");
  journal.run("INSERT INTO counter_marks VALUES(?,?,?)", id, TODAY, "x");
  assert.throws(() => journal.run("INSERT INTO counter_marks VALUES(?,?,?)", id, TODAY, "y"));
});

test("MCP: the tools do not name counters and nothing of them is in any answer", () => {
  const journal = newStore();
  mustAdd(journal, "ПРИВАТНИЙ_ЛІЧИЛЬНИК", "keep", "2026-10-01");
  const id = String(mustAdd(journal, "ІНШИЙ_ЛІЧИЛЬНИК", "done"));
  markCounter(journal, id, { date: TODAY }, NOW);
  journal.add({ date: "2026-11-08", body: "Запис про день", source: "bot" });
  journal.addIdea({ body: "Ідея", source: "text", date: "2026-11-09", time: "10:00" });
  const sources = { journal, now: () => NOW };
  const call = (method: string, params?: unknown) =>
    handleLine(JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }), sources)!;
  const listing = call("tools/list");
  assert.ok(!/counter|лічильник/i.test(listing));
  const answers = [
    call("tools/call", { name: "list_diary", arguments: {} }),
    call("tools/call", { name: "list_ideas", arguments: { resolved: true } }),
    call("tools/call", { name: "get_diary_entry", arguments: { id: 1 } }),
  ].join("\n");
  assert.match(answers, /Запис про день/);
  assert.ok(!/ЛІЧИЛЬНИК|counter/i.test(answers));
  // A tool for counters does not exist, and a name made up to reach the table is refused.
  for (const name of ["list_counters", "get_counter", "counters"])
    assert.throws(() => callTool(name, {}, sources));
  // add_idea writes to the same file and leaves the counters as they were.
  callTool("add_idea", { text: "Нова ідея" }, sources);
  assert.equal(readCounters(journal, NOW).counters.length, 3);
  assert.deepEqual(readCounter(journal, id, NOW)!.marks, [TODAY]);
});

test("export: the diary and ideas go out as before, and counters never reach the archive or the folders", () => {
  const dir = mkdtempSync(join(tmpdir(), "counters-export-"));
  try {
    const s = new Store(":memory:");
    const journal = newStore();
    mustAdd(journal, "ПРИВАТНИЙ_ЛІЧИЛЬНИК", "keep", "2026-10-01");
    const id = String(mustAdd(journal, "ІНШИЙ_ЛІЧИЛЬНИК", "done"));
    markCounter(journal, id, { date: TODAY }, NOW);
    hideDiary(journal, { hidden: true }, NOW);
    journal.add({ date: "2026-11-09", body: "Вчорашній запис", source: "bot" });
    journal.addIdea({ body: "Ідея", source: "text", date: "2026-11-09", time: "14:30" });
    const options = { journal, journalDir: join(dir, "diary"), ideasDir: join(dir, "ideas") };
    const built = buildExport(s, options);
    assert.equal(built.diary, 1);
    assert.equal(built.ideas, 1);
    assert.ok(!built.zip!.toString("latin1").includes("ЛІЧИЛЬНИК"));
    assert.ok(!built.zip!.toString("utf8").includes("ЛІЧИЛЬНИК"));
    built.commit();
    assert.equal(buildExport(s, options).zip, null);
    // The script's folders hold only the diary and the ideas.
    const report = [exportJournal(journal, join(dir, "diary")), exportIdeas(journal, join(dir, "ideas"))];
    assert.ok(report.every((r) => r.written.length === 0));
    for (const folder of ["diary", "ideas"])
      for (const file of readdirSync(join(dir, folder), { withFileTypes: true }))
        if (file.isFile())
          assert.ok(!readFileSync(join(dir, folder, file.name), "utf8").includes("ЛІЧИЛЬНИК"));
    assert.ok(!existsSync(join(dir, "counters")));
    // The counters are untouched by the export.
    assert.equal(readCounters(journal, NOW).counters.length, 3);
    s.close();
    journal.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// HTTP, each case on its own server and journal, so the shared one above stays as the first tests left it.
type Send = (path: string, method?: string, body?: unknown, h?: Record<string, string>) => Promise<Response>;
async function app<T>(run: (send: Send, journal: JournalStore, base: string) => Promise<T>, now = NOW) {
  const own = new JournalStore(":memory:");
  const server = await startMiniApp(
    { token: TOKEN, owner: OWNER, journal: own, now: () => now, staticDir: dir },
    0,
  );
  assert.ok(server);
  const url = `http://${MINIAPP_HOST}:${(server.address() as AddressInfo).port}`;
  const send = (path: string, method = "GET", body?: unknown, h: Record<string, string> = headers) =>
    fetch(url + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    return await run(send, own, url);
  } finally {
    server.closeAllConnections();
    server.close();
    own.close();
  }
}

test("HTTP: a body that is not JSON, not an object or in the wrong type is refused and writes nothing", async () => {
  await app(async (_send, own, url) => {
    const raw = (path: string, method: string, body: string, type?: string) =>
      fetch(url + path, {
        method,
        headers: { authorization: headers.authorization, ...(type ? { "content-type": type } : {}) },
        body,
      });
    assert.equal((await raw("/api/counters", "POST", "{broken", "application/json")).status, 400);
    assert.equal((await raw("/api/counters", "POST", "", "application/json")).status, 400);
    assert.equal(
      (await raw("/api/counters", "POST", '{"name":"Х","kind":"done"}', "text/plain")).status,
      415,
    );
    assert.equal((await raw("/api/counters", "POST", '{"name":"Х","kind":"done"}')).status, 415);
    // JSON that is not an object has no fields: the same 400 as an empty one.
    for (const body of ["null", "[]", '"text"', "5", "true", '[{"name":"Х","kind":"done"}]'])
      assert.equal((await raw("/api/counters", "POST", body, "application/json")).status, 400, body);
    assert.equal(
      (await raw("/api/counters", "POST", '{"name":"Х","kind":"done"}', "application/json; charset=utf-8"))
        .status,
      201,
    );
    assert.equal(Number(own.all("SELECT count(*) AS n FROM counters")[0].n), 1);
    const id = Number(own.all("SELECT id FROM counters")[0].id);
    for (const [path, method] of [
      [`/api/counters/${id}`, "PATCH"],
      [`/api/counters/${id}/mark`, "POST"],
      [`/api/counters/${id}/unmark`, "POST"],
      ["/api/counters/diary/hidden", "POST"],
    ]) {
      assert.equal((await raw(path, method, "{broken", "application/json")).status, 400, path);
      assert.equal((await raw(path, method, "{}", "text/plain")).status, 415, path);
      assert.equal((await raw(path, method, "null", "application/json")).status, 400, path);
    }
    assert.equal(Number(own.all("SELECT count(*) AS n FROM counter_marks")[0].n), 0);
    assert.equal(own.all("SELECT name FROM counters")[0].name, "Х");
    assert.equal(Number(own.all("SELECT count(*) AS n FROM counter_prefs")[0].n), 0);
    // A too long body is a 413 and nothing is created.
    const huge = JSON.stringify({ name: "Х".repeat(600 * 1024), kind: "done" });
    assert.equal((await raw("/api/counters", "POST", huge, "application/json")).status, 413);
    assert.equal(Number(own.all("SELECT count(*) AS n FROM counters")[0].n), 1);
  });
});

test("HTTP: the counter routes check the user before they read the body, and a stranger gets the same 401", async () => {
  await app(async (send, own) => {
    const stranger = {
      authorization: `tma ${sign({
        auth_date: String(Math.floor(NOW.getTime() / 1000) - 60),
        user: JSON.stringify({ id: OWNER + 1 }),
      })}`,
      "content-type": "application/json",
    };
    const huge = { name: "Х".repeat(600 * 1024), kind: "done" };
    for (const h of [
      stranger,
      { "content-type": "application/json" },
      { ...headers, authorization: "tma bad" },
    ]) {
      assert.equal((await send("/api/counters", "POST", huge, h)).status, 401);
      assert.equal((await send("/api/counters", "GET", undefined, h)).status, 401);
    }
    assert.equal(Number(own.all("SELECT count(*) AS n FROM counters")[0].n), 0);
  });
});

test("HTTP: a signature that is too old is refused on the counter routes too", async () => {
  const later = new Date(NOW.getTime() + 3 * 24 * 3600 * 1000);
  await app(async (send, own) => {
    assert.equal((await send("/api/counters")).status, 401);
    assert.equal((await send("/api/counters", "POST", { name: "Х", kind: "done" })).status, 401);
    assert.equal(Number(own.all("SELECT count(*) AS n FROM counters")[0].n), 0);
  }, later);
});

test("HTTP: every wrong method on every counter path is a 405 and changes nothing", async () => {
  await app(async (send, own) => {
    const created = await send("/api/counters", "POST", { name: "Мама", kind: "done" });
    const { id } = (await created.json()) as { id: number };
    own.add({ date: "2026-11-10", body: "x", source: "bot" });
    const cases: [string, string[]][] = [
      ["/api/counters", ["PATCH"]],
      [`/api/counters/${id}`, ["POST"]],
      [`/api/counters/${id}/mark`, ["GET", "HEAD", "PATCH"]],
      [`/api/counters/${id}/unmark`, ["GET", "HEAD", "PATCH"]],
      [`/api/counters/${id}/delete`, ["GET", "HEAD", "PATCH"]],
      ["/api/counters/diary/hidden", ["GET", "HEAD", "PATCH"]],
      ["/api/counters/diary", ["POST", "PATCH"]],
    ];
    for (const [path, methods] of cases)
      for (const method of methods) {
        const res = await send(
          path,
          method,
          method === "GET" || method === "HEAD" ? undefined : { name: "Інше", date: TODAY, hidden: true },
        );
        // The diary has nothing to patch: a 404; the rest is a 405.
        assert.equal(
          res.status,
          path === "/api/counters/diary" && method === "PATCH" ? 404 : 405,
          `${method} ${path}`,
        );
      }
    // The server itself answers 405 to methods the API never takes, before any route sees them.
    for (const method of ["DELETE", "PUT"]) {
      assert.equal((await send(`/api/counters/${id}`, method, {})).status, 405, method);
      assert.equal((await send("/api/counters", method, {})).status, 405, method);
    }
    assert.equal(own.all("SELECT name FROM counters")[0].name, "Мама");
    assert.equal(Number(own.all("SELECT count(*) AS n FROM counter_marks")[0].n), 0);
    assert.equal(Number(own.all("SELECT count(*) AS n FROM counter_prefs")[0].n), 0);
    assert.equal((await send(`/api/counters/${id}`)).status, 200);
  });
});

test("HTTP: HEAD reads, and odd paths are a 404 without touching the data", async () => {
  await app(async (send, own) => {
    const { id } = (await (await send("/api/counters", "POST", { name: "Мама", kind: "done" })).json()) as {
      id: number;
    };
    assert.equal((await send("/api/counters", "HEAD")).status, 200);
    assert.equal((await send(`/api/counters/${id}`, "HEAD")).status, 200);
    for (const path of [
      "/api/counters/",
      `/api/counters/${id}/`,
      `/api/counters/0${id}`,
      `/api/counters/-${id}`,
      `/api/counters/${id}/hidden`,
      `/api/counters/${id}/other`,
      `/api/counters/${"9".repeat(16)}`,
      "/api/counters/diary/mark",
      "/api/counters/diary/unmark",
      "/api/counters/diary/delete",
      "/api/counters/DIARY",
      "/api/counters/%31",
      `/api/counters/${id}/mark/extra`,
    ]) {
      const res = await send(
        path,
        path.endsWith("/hidden") ? "POST" : "GET",
        path.endsWith("/hidden") ? {} : undefined,
      );
      assert.equal(res.status, 404, path);
    }
    for (const path of [
      "/api/counters/diary/mark",
      "/api/counters/diary/delete",
      "/api/counters/diary/unmark",
    ])
      assert.equal((await send(path, "POST", { date: TODAY })).status, 404, path);
    assert.equal(Number(own.all("SELECT count(*) AS n FROM counters")[0].n), 1);
    assert.equal(Number(own.all("SELECT count(*) AS n FROM counter_marks")[0].n), 0);
    // A query string does not change the route.
    assert.equal((await send("/api/counters?x=1")).status, 200);
    assert.equal((await send(`/api/counters/${id}?x=1`)).status, 200);
  });
});

test("HTTP: the answers carry the codes and the reasons of the checks", async () => {
  await app(async (send, own) => {
    const error = async (res: Response) => ((await res.json()) as { error: string }).error;
    assert.equal(await error(await send("/api/counters", "POST", { name: "", kind: "done" })), "name");
    assert.equal(await error(await send("/api/counters", "POST", { name: "Х", kind: "zzz" })), "kind");
    assert.equal(
      await error(await send("/api/counters", "POST", { name: "Х", kind: "keep", since: "2030-01-01" })),
      "since",
    );
    const { id } = (await (await send("/api/counters", "POST", { name: "Х", kind: "done" })).json()) as {
      id: number;
    };
    const again = await send("/api/counters", "POST", { name: "х", kind: "keep" });
    assert.deepEqual([again.status, await error(again)], [400, "exists"]);
    assert.equal(await error(await send(`/api/counters/${id}/mark`, "POST", { date: "2026-11-12" })), "date");
    assert.equal(await error(await send(`/api/counters/${id}/mark`, "POST", {})), "date");
    assert.equal(await error(await send(`/api/counters/${id}/unmark`, "POST", { date: "x" })), "date");
    assert.equal(
      await error(await send(`/api/counters/${id}/unmark`, "POST", { date: "2020-01-01" })),
      "not_found",
    );
    assert.equal(await error(await send("/api/counters/diary/hidden", "POST", { hidden: "no" })), "hidden");
    assert.equal(await error(await send(`/api/counters/${id}`, "PATCH", { name: "Щоденник" })), "exists");
    assert.equal(await error(await send("/api/counters/999", "PATCH", { name: "Нове" })), "not_found");
    for (let i = 1; i < MAX_COUNTERS; i++)
      await send("/api/counters", "POST", { name: `Л ${i}`, kind: "done" });
    const over = await send("/api/counters", "POST", { name: "Зайвий", kind: "done" });
    assert.deepEqual([over.status, await error(over)], [400, "limit"]);
    assert.equal(Number(own.all("SELECT count(*) AS n FROM counters")[0].n), MAX_COUNTERS);
  });
});

test("HTTP: the diary answers null for its hidden flag before the first entry, and the list keeps the order", async () => {
  await app(async (send, own) => {
    const early = await send("/api/counters/diary/hidden", "POST", { hidden: true });
    assert.equal(early.status, 200);
    assert.equal(await early.json(), null);
    own.add({ date: "2026-11-09", body: "Запис", source: "bot" });
    await send("/api/counters", "POST", { name: "Перший", kind: "done" });
    await send("/api/counters", "POST", { name: "Другий", kind: "keep" });
    const list = (await (await send("/api/counters")).json()) as any;
    assert.deepEqual(
      list.counters.map((c: any) => [c.name, c.hidden ?? false]),
      [
        ["Перший", false],
        ["Другий", false],
        ["Щоденник", true],
      ],
    );
    const detail = (await (await send("/api/counters/diary")).json()) as any;
    assert.deepEqual([detail.kind, detail.days, detail.marks], ["auto", 2, []]);
    assert.ok(!JSON.stringify(list).includes("Запис"));
  });
});

test("HTTP: after midnight in Prague the server's day moves with the clock it was given", async () => {
  let now = prague("2026-11-11T22:30:00Z");
  const own = new JournalStore(":memory:");
  const server = await startMiniApp(
    { token: TOKEN, owner: OWNER, journal: own, now: () => now, staticDir: dir },
    0,
  );
  assert.ok(server);
  const url = `http://${MINIAPP_HOST}:${(server.address() as AddressInfo).port}`;
  // The initData of the test was signed at NOW; the clock here is a few hours later, which is still fresh.
  const send = (path: string, method = "GET", body?: unknown) =>
    fetch(url + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    const { id } = (await (await send("/api/counters", "POST", { name: "Мама", kind: "done" })).json()) as {
      id: number;
    };
    assert.equal((await send(`/api/counters/${id}/mark`, "POST", { date: "2026-11-11" })).status, 200);
    now = prague("2026-11-11T23:30:00Z");
    const list = (await (await send("/api/counters")).json()) as any;
    assert.equal(list.today, "2026-11-12");
    assert.deepEqual([list.counters[0].days, list.counters[0].markedToday], [1, false]);
    assert.equal((await send(`/api/counters/${id}/mark`, "POST", { date: "2026-11-10" })).status, 400);
    assert.equal((await send(`/api/counters/${id}/mark`, "POST", { date: "2026-11-12" })).status, 200);
  } finally {
    server.closeAllConnections();
    server.close();
    own.close();
  }
});

test("names: zero-width and bidi characters do not make a second name that looks the same", () => {
  const journal = newStore();
  assert.ok(addCounter(journal, { name: "Подзвонити мамі", kind: "done" }, NOW).ok);
  for (const name of ["Подзвонити​ мамі", "‮Подзвонити мамі", "Подзвонити﻿ мамі‍"])
    assert.equal(addCounter(journal, { name, kind: "keep" }, NOW).ok, false, JSON.stringify(name));
  assert.equal(addCounter(journal, { name: "​‍﻿", kind: "keep" }, NOW).ok, false);
  assert.equal(addCounter(journal, { name: "Щоден​ник", kind: "keep" }, NOW).ok, false);
  assert.equal(readCounters(journal, NOW).counters.length, 1);
});

test("an id is never reused, so a screen that still shows a deleted counter cannot mark a new one", () => {
  const journal = newStore();
  const old = mustAdd(journal, "Не курю", "keep", "2026-10-08");
  assert.ok(removeCounter(journal, String(old)).ok);
  const fresh = mustAdd(journal, "Подзвонити мамі", "done");
  assert.notEqual(fresh, old);
  assert.equal(markCounter(journal, String(old), { date: TODAY }, NOW).ok, false);
  assert.equal(journal.all("SELECT * FROM counter_marks").length, 0);
});
