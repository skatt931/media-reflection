import { localDate } from "../fields.ts";
import type { JournalStore } from "../journal.ts";
import type { Store } from "../store.ts";
import type { Album, AlbumCard, AlbumNote, AlbumQuote, Shelf } from "./album-types.ts";
import type { Tile } from "./collection-types.ts";

// «Мій листопад»: the month's album, put together from what the owner already wrote and marked, by plain rules.
// Everything is read locally; the words are the owner's own, cut but never rewritten.
type Row = Record<string, any>;

const QUOTES = 5;
const QUOTE_MAX = 240;
const QUOTE_MIN = 25;
const NOTE_MAX = 140;
const DIARY_SHOWN = 10;
const LOVED_SHOWN = 24;
// Where a still-open month starts: six places, more as they fill.
const SLOTS = 6;

export const validAlbumPeriod = (period: string) => /^\d{4}-(0[1-9]|1[0-2])$/.test(period);

const flat = (text: string) => text.replace(/\s+/g, " ").trim();

// Up to `max` characters, ending where a sentence ends if one does after the first part, else at a word.
export function lead(text: string, max: number) {
  const one = flat(text);
  if (one.length <= max) return one;
  const head = one.slice(0, max);
  const end = Math.max(...[". ", "! ", "? ", "… "].map((m) => head.lastIndexOf(m)));
  if (end >= max * 0.4) return head.slice(0, end + 1);
  const space = head.lastIndexOf(" ");
  return head.slice(0, space > max / 2 ? space : max).replace(/[\s,;:]+$/, "") + "…";
}

// The first sentence, or the start of the text if the sentence is long.
export function firstSentence(text: string, max: number) {
  const one = flat(text);
  const sentence = /^.+?[.!?…](?=\s|$)/u.exec(one)?.[0];
  return sentence && sentence.length <= max ? sentence : lead(one, max);
}

const monthOf = (iso: string) => localDate(new Date(iso)).slice(0, 7);

export function tileOf(s: Store, item: Row): Tile {
  return { id: item.id, title: item.title, cover: s.coverPath(item) !== null };
}

// The best note of each material that month, ❤️ first, then 👍, then the longer ones; at most a few,
// shown in the order they were written.
function quotesOf(items: Row[], notes: Row[]): AlbumQuote[] {
  const weight = (item: Row) => (item.reaction === "loved" ? 3 : item.reaction === "positive" ? 2 : 1);
  const byId = new Map(items.map((i) => [i.id as string, i]));
  const best = new Map<string, { item: Row; note: Row; score: number }>();
  for (const note of notes) {
    const item = byId.get(note.item_id);
    const body = flat(note.body);
    if (!item || body.length < QUOTE_MIN) continue;
    const score = weight(item) * 1000 + Math.min(body.length, QUOTE_MAX);
    if (score > (best.get(item.id)?.score ?? 0)) best.set(item.id, { item, note, score });
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, QUOTES)
    .sort((a, b) => a.note.created_at.localeCompare(b.note.created_at))
    .map(({ item, note }) => ({
      id: item.id,
      title: item.title,
      body: lead(note.body, QUOTE_MAX),
      date: localDate(new Date(note.created_at)),
    }));
}

function diaryOf(journal: JournalStore | undefined, period: string) {
  const rows = (journal?.all(
    "SELECT id, entry_date, body FROM journal_entries WHERE entry_date BETWEEN ? AND ? ORDER BY entry_date, id",
    `${period}-01`,
    `${period}-31`,
  ) ?? []) as { id: number; entry_date: string; body: string }[];
  const notes: AlbumNote[] = rows
    .slice(-DIARY_SHOWN)
    .map((r) => ({ id: r.id, date: r.entry_date, excerpt: firstSentence(r.body, NOTE_MAX) }));
  return { count: rows.length, notes };
}

export function albumOf(
  s: Store,
  journal: JournalStore | undefined,
  period: string,
  today = localDate(),
): Album | null {
  if (!validAlbumPeriod(period)) return null;
  const items = s.items().filter((i) => monthOf(i.created_at) === period);
  if (!items.length) return null;
  const notes = s
    .all("SELECT item_id, body, created_at FROM reflections ORDER BY created_at, update_id")
    .filter((r) => monthOf(r.created_at) === period);
  const loved = items.filter((i) => i.reaction === "loved");
  const done = period < today.slice(0, 7);
  const diary = diaryOf(journal, period);
  const months = [...new Set(s.items().map((i) => monthOf(i.created_at)))].sort().reverse();
  const at = months.indexOf(period);
  return {
    period,
    done,
    counts: { saved: items.length, loved: loved.length, thoughts: notes.length, diary: diary.count },
    loved: loved.slice(0, LOVED_SHOWN).map((i) => tileOf(s, i)),
    slots: done ? loved.length : Math.max(SLOTS, Math.ceil((loved.length + 1) / 3) * 3),
    quotes: quotesOf(items, notes),
    diary: diary.notes,
    older: months[at + 1] ?? null,
    newer: months[at - 1] ?? null,
  };
}

// Every month that has something saved, newest first: the open one at the head, the finished ones behind it.
export function shelfOf(s: Store, today = localDate()): Shelf {
  const lovedBy = new Map<string, Row[]>();
  const allBy = new Map<string, Row[]>();
  for (const item of s.items()) {
    const month = monthOf(item.created_at);
    allBy.set(month, [...(allBy.get(month) ?? []), item]);
    if (item.reaction === "loved") lovedBy.set(month, [...(lovedBy.get(month) ?? []), item]);
  }
  const thoughts = new Map<string, number>();
  for (const r of s.all("SELECT created_at FROM reflections"))
    thoughts.set(monthOf(r.created_at), (thoughts.get(monthOf(r.created_at)) ?? 0) + 1);
  const albums: AlbumCard[] = [...allBy.keys()]
    .sort()
    .reverse()
    .map((period) => {
      const loved = lovedBy.get(period) ?? [];
      const done = period < today.slice(0, 7);
      // A finished month with nothing marked still gets a face: its newest materials.
      const faces = loved.length || !done ? loved : allBy.get(period)!;
      return {
        period,
        done,
        saved: allBy.get(period)!.length,
        loved: loved.length,
        thoughts: thoughts.get(period) ?? 0,
        tiles: faces.slice(0, 4).map((i) => tileOf(s, i)),
      };
    });
  return { albums };
}
