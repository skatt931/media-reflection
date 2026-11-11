import type { CounterDetail, CounterItem, CounterList } from "./counter-types.ts";

// What the Mini App computes of the counters. Plain functions over plain rows, so the same code answers the
// server and the browser mock (`npm run miniapp:dev` with ?mock). No Node imports: the screens bundle this.
export type CounterRow = { id: number; name: string; kind: "done" | "keep"; started_on: string };
export type MarkRow = { counter_id: number; mark_date: string };
// The diary: only the date of its newest entry, never its text.
export type DiaryState = { last: string | null; hidden: boolean };

export const DIARY_ID = "diary";
export const DIARY_NAME = "Щоденник";
export const MAX_MARKS_SHOWN = 60;

const dayNumber = (date: string) => {
  const [year, month, day] = date.split("-").map(Number);
  // `Date.UTC` reads the years 0 to 99 as 1900 to 1999; setting the year on a date keeps it as written.
  const at = new Date(0);
  at.setUTCFullYear(year, month - 1, day);
  return Math.round(at.getTime() / 86_400_000);
};

// Calendar dates, not hours: a clock change never moves a day.
export const daysBetween = (from: string, to: string) => dayNumber(to) - dayNumber(from);

const newestFirst = (dates: string[]) => [...dates].sort().reverse();

// The first day of each run of a «keep» counter: its start, then every lapse.
function runStarts(row: CounterRow, marks: string[]) {
  return [row.started_on, ...[...marks].sort()].sort();
}

function itemOf(row: CounterRow, marks: string[], today: string): CounterItem {
  const newest = marks.length ? newestFirst(marks)[0] : null;
  const since = row.kind === "done" ? newest : newest && newest > row.started_on ? newest : row.started_on;
  return {
    id: String(row.id),
    name: row.name,
    kind: row.kind,
    days: since === null ? null : daysBetween(since, today),
    since,
    markedToday: row.kind === "done" && marks.includes(today),
  };
}

const marksOf = (marks: MarkRow[], id: number) =>
  marks.filter((mark) => mark.counter_id === id).map((mark) => mark.mark_date);

function diaryItem(diary: DiaryState, today: string): CounterItem | null {
  if (!diary.last) return null;
  return {
    id: DIARY_ID,
    name: DIARY_NAME,
    kind: "auto",
    days: Math.max(0, daysBetween(diary.last, today)),
    since: diary.last,
    markedToday: false,
    hidden: diary.hidden,
  };
}

// In the order they were made, the diary last.
export function counterList(
  rows: CounterRow[],
  marks: MarkRow[],
  diary: DiaryState,
  today: string,
): CounterList {
  const own = rows.map((row) => itemOf(row, marksOf(marks, row.id), today));
  const auto = diaryItem(diary, today);
  return { today, counters: auto ? [...own, auto] : own };
}

export function counterDetail(
  rows: CounterRow[],
  marks: MarkRow[],
  diary: DiaryState,
  id: string,
  today: string,
): CounterDetail | null {
  if (id === DIARY_ID) {
    const item = diaryItem(diary, today);
    return item && { ...item, marks: [], started: null, record: null };
  }
  const row = rows.find((candidate) => String(candidate.id) === id);
  if (!row) return null;
  const own = marksOf(marks, row.id);
  const item = itemOf(row, own, today);
  let record: number | null = null;
  if (row.kind === "keep" && own.length) {
    const starts = runStarts(row, own);
    const ends = [...starts.slice(1), today];
    record = Math.max(...starts.map((start, i) => daysBetween(start, ends[i])));
  }
  return {
    ...item,
    marks: newestFirst(own).slice(0, MAX_MARKS_SHOWN),
    started: row.kind === "keep" ? row.started_on : null,
    record,
  };
}
