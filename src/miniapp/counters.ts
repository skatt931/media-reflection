import { addDays, localDate, validDate } from "../fields.ts";
import { cleanName } from "../collections.ts";
import type { JournalStore } from "../journal.ts";
import {
  DIARY_ID,
  DIARY_NAME,
  counterDetail,
  counterList,
  type CounterRow,
  type DiaryState,
  type MarkRow,
} from "./counter-data.ts";
import type { CounterDetail, CounterList } from "./counter-types.ts";
import { bad, done, missing, record, type Written } from "./write.ts";

// Trackers of «how many days since»: the screens only show them, everything is checked here.
export const MAX_COUNTERS = 20;

const same = (a: string, b: string) => a.toLocaleLowerCase("uk") === b.toLocaleLowerCase("uk");

const rowsOf = (journal: JournalStore) =>
  journal.all("SELECT id, name, kind, started_on FROM counters ORDER BY id") as CounterRow[];
const marksOf = (journal: JournalStore) =>
  journal.all("SELECT counter_id, mark_date FROM counter_marks") as MarkRow[];
const diaryOf = (journal: JournalStore): DiaryState => ({
  // Only the date of the newest entry: the text of the diary is not read.
  last: journal.lastEntryDate(),
  hidden: journal.all("SELECT value FROM counter_prefs WHERE key='hide_diary'")[0]?.value === "1",
});

export function readCounters(journal: JournalStore, now = new Date()): CounterList {
  return counterList(rowsOf(journal), marksOf(journal), diaryOf(journal), localDate(now));
}

export function readCounter(journal: JournalStore, id: string, now = new Date()): CounterDetail | null {
  return counterDetail(rowsOf(journal), marksOf(journal), diaryOf(journal), id, localDate(now));
}

// The id of an own counter as the routes pass it; the diary is not one.
const own = (journal: JournalStore, id: string) =>
  /^\d{1,15}$/.test(id) ? rowsOf(journal).find((row) => String(row.id) === id) : undefined;

const taken = (journal: JournalStore, name: string, except?: number) =>
  same(name, DIARY_NAME) || rowsOf(journal).some((row) => row.id !== except && same(row.name, name));

export function addCounter(journal: JournalStore, input: unknown, now = new Date()): Written<{ id: number }> {
  const { name: raw, kind, since } = record(input);
  const name = cleanName(raw);
  if (!name) return bad("name");
  if (kind !== "done" && kind !== "keep") return bad("kind");
  const today = localDate(now);
  let started = today;
  if (since !== undefined && since !== null) {
    if (typeof since !== "string" || !validDate(since) || since > today) return bad("since");
    started = since;
  }
  if (taken(journal, name)) return bad("exists");
  if (rowsOf(journal).length >= MAX_COUNTERS) return bad("limit");
  const result = journal.run(
    "INSERT INTO counters(name,kind,started_on,created_at) VALUES(?,?,?,?)",
    name,
    kind,
    started,
    now.toISOString(),
  );
  return done({ id: Number(result.lastInsertRowid) });
}

export function renameCounter(
  journal: JournalStore,
  id: string,
  input: unknown,
  now = new Date(),
): Written<CounterDetail> {
  const row = own(journal, id);
  if (!row) return missing;
  const name = cleanName(record(input).name);
  if (!name) return bad("name");
  if (taken(journal, name, row.id)) return bad("exists");
  journal.run("UPDATE counters SET name=? WHERE id=?", name, row.id);
  return done(readCounter(journal, id, now)!);
}

// A «done» mark may be today or yesterday (a call made yesterday and not noted); a lapse is always today.
// The same day marked twice is one mark.
export function markCounter(
  journal: JournalStore,
  id: string,
  input: unknown,
  now = new Date(),
): Written<CounterDetail> {
  const row = own(journal, id);
  if (!row) return missing;
  const { date } = record(input);
  const today = localDate(now);
  const allowed = row.kind === "done" ? [today, addDays(today, -1)] : [today];
  if (typeof date !== "string" || !allowed.includes(date)) return bad("date");
  journal.run(
    "INSERT OR IGNORE INTO counter_marks(counter_id,mark_date,created_at) VALUES(?,?,?)",
    row.id,
    date,
    now.toISOString(),
  );
  return done(readCounter(journal, id, now)!);
}

// Taking a mark back needs a date that exists; the screen only offers today's with one tap, the rest from
// the details after a question.
export function unmarkCounter(
  journal: JournalStore,
  id: string,
  input: unknown,
  now = new Date(),
): Written<CounterDetail> {
  const row = own(journal, id);
  if (!row) return missing;
  const { date } = record(input);
  if (typeof date !== "string" || !validDate(date)) return bad("date");
  const result = journal.run("DELETE FROM counter_marks WHERE counter_id=? AND mark_date=?", row.id, date);
  return Number(result.changes) ? done(readCounter(journal, id, now)!) : missing;
}

export function removeCounter(journal: JournalStore, id: string): Written<true> {
  const row = own(journal, id);
  if (!row) return missing;
  journal.transaction(() => {
    journal.run("DELETE FROM counter_marks WHERE counter_id=?", row.id);
    journal.run("DELETE FROM counters WHERE id=?", row.id);
  });
  return done(true);
}

export function hideDiary(
  journal: JournalStore,
  input: unknown,
  now = new Date(),
): Written<CounterDetail | null> {
  const { hidden } = record(input);
  if (typeof hidden !== "boolean") return bad("hidden");
  journal.run(
    "INSERT INTO counter_prefs(key,value) VALUES('hide_diary',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
    hidden ? "1" : "0",
  );
  return done(readCounter(journal, DIARY_ID, now));
}
