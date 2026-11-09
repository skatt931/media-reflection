import { fold, matches, stems } from "../words.ts";

// What the Mini App shows of the diary and the ideas. Plain functions over plain rows, so the same code
// answers the server and the browser mock (`npm run miniapp:dev` with ?mock).
export type DiaryRow = { id: number; entry_date: string; body: string };
export type IdeaRow = { id: number; idea_date: string; idea_time: string; body: string };

export type DiaryItem = { id: number; date: string; excerpt: string; words: number };
export type DiaryList = { entries: DiaryItem[]; terms: string[] };
export type DiaryEntry = {
  id: number;
  date: string;
  body: string;
  words: number;
  older: { id: number; date: string } | null;
  newer: { id: number; date: string } | null;
};
export type IdeaItem = { id: number; date: string; time: string; body: string };
export type IdeaList = { ideas: IdeaItem[]; terms: string[] };

export const MAX_QUERY = 200;
const EXCERPT = 240;
const SNIPPET = 220;
const LEAD = 60;

const flat = (text: string) => text.replace(/\s+/g, " ").trim();
export const wordCount = (text: string) => flat(text).split(" ").filter(Boolean).length;

// Cuts at a word boundary and marks the cut with an ellipsis.
function clip(text: string, from: number, length: number) {
  let start = from;
  if (start > 0) {
    const space = text.indexOf(" ", start);
    start = space === -1 || space - start > 20 ? start : space + 1;
  }
  let end = Math.min(text.length, start + length);
  if (end < text.length) {
    const space = text.lastIndexOf(" ", end);
    if (space > start + length / 2) end = space;
  }
  return (
    (start > 0 ? "…" : "") + text.slice(start, end).replace(/[\s,;:]+$/, "") + (end < text.length ? "…" : "")
  );
}

// The text around the first hit (the beginning when the words are found only far apart), without line breaks.
export function snippet(body: string, terms: string[]) {
  const text = flat(body);
  if (!terms.length) return clip(text, 0, EXCERPT);
  const folded = fold(text);
  const at =
    folded.length === text.length
      ? Math.min(...terms.map((t) => folded.indexOf(t)).filter((i) => i >= 0))
      : 0;
  return clip(text, Number.isFinite(at) ? Math.max(0, at - LEAD) : 0, SNIPPET);
}

const query = (q: string | undefined) => (q ?? "").slice(0, MAX_QUERY).trim();
// Newest first; the same day, the later record first.
const newest = (rows: DiaryRow[]) =>
  [...rows].sort((a, b) =>
    a.entry_date === b.entry_date ? b.id - a.id : a.entry_date < b.entry_date ? 1 : -1,
  );

export function diaryList(rows: DiaryRow[], q?: string): DiaryList {
  const text = query(q);
  const found = text ? newest(rows).filter((row) => matches(fold(row.body), text)) : newest(rows);
  const terms = text ? stems(text) : [];
  return {
    terms,
    entries: found.map((row) => ({
      id: row.id,
      date: row.entry_date,
      excerpt: snippet(row.body, terms),
      words: wordCount(row.body),
    })),
  };
}

export function diaryEntry(rows: DiaryRow[], id: number): DiaryEntry | null {
  const list = newest(rows);
  const at = list.findIndex((row) => row.id === id);
  if (at < 0) return null;
  const link = (row: DiaryRow | undefined) => (row ? { id: row.id, date: row.entry_date } : null);
  return {
    id,
    date: list[at].entry_date,
    body: list[at].body,
    words: wordCount(list[at].body),
    newer: link(list[at - 1]),
    older: link(list[at + 1]),
  };
}

export function ideaList(rows: IdeaRow[], q?: string): IdeaList {
  const text = query(q);
  const sorted = [...rows].sort((a, b) => b.id - a.id);
  const found = text ? sorted.filter((row) => matches(fold(row.body), text)) : sorted;
  return {
    terms: text ? stems(text) : [],
    ideas: found.map((row) => ({ id: row.id, date: row.idea_date, time: row.idea_time, body: row.body })),
  };
}
