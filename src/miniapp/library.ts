import { dirname, extname } from "node:path";
import { collectionsOf } from "../collections.ts";
import { localDate, reactions, statuses, types } from "../fields.ts";
import { retrieve } from "../search.ts";
import type { Store } from "../store.ts";
import { fold, matches, stems } from "../words.ts";
import { snippet } from "./data.ts";
import {
  NO_REACTION,
  type Labels,
  type LibraryCard,
  type LibraryItem,
  type LibraryList,
  type Thought,
} from "./library-types.ts";

type Row = Record<string, any>;

// Words for the interface come from the one place that owns them, so the app and the bot never disagree.
const labels: Labels = { types, statuses, reactions };

const QUERY_MAX = 200;

const COVER_TYPES: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

const dateOf = (item: Row): string => item.consumed_on ?? localDate(new Date(item.created_at));
const list = (value: string | null) => (value ? value.split(",").filter(Boolean) : []);
// The file name comes from the database; it must stay inside the covers folder.
const coverOf = (s: Store, item: Row) => {
  const path = s.coverPath(item);
  return path && dirname(path) === s.coverDir ? path : null;
};
const web = (url: unknown) => (typeof url === "string" && /^https?:\/\//i.test(url) ? url : null);

export type LibraryFilter = {
  q: string;
  types: string[];
  statuses: string[];
  reactions: string[];
  unreviewed: boolean;
  noThought: boolean;
};

export function libraryFilter(params: URLSearchParams): LibraryFilter {
  return {
    q: (params.get("q") ?? "").trim().slice(0, QUERY_MAX),
    types: list(params.get("type")),
    statuses: list(params.get("status")),
    reactions: list(params.get("reaction")),
    unreviewed: params.get("unreviewed") === "1",
    noThought: params.get("nothought") === "1",
  };
}

// What `card` needs besides the item itself, read once for a whole list.
type Context = {
  unreviewed: Set<string>;
  noThought: Set<string>;
  // Each item's own notes, oldest first.
  notes: Map<string, Row[]>;
  // The search the list answers, as the stems to look for in the notes.
  q: string;
  terms: string[];
};

const THOUGHT_MAX = 600;

// One line of text, cut at a word with an ellipsis when it is long.
function flatten(text: string, max: number) {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  const space = flat.lastIndexOf(" ", max);
  return flat.slice(0, space > max / 2 ? space : max).replace(/[\s,;:]+$/, "") + "…";
}

// The latest thing the owner wrote about the item. With a search: the latest note that holds the words (cut
// around the first hit), or failing that one of them, or failing that the latest note, unmarked.
export function thoughtOf(notes: Row[], q = "", terms: string[] = []): Thought | null {
  const last = notes.at(-1);
  if (!last) return null;
  const note = (r: Row, hit: boolean): Thought => ({
    body: hit ? snippet(r.body, terms) : flatten(r.body, THOUGHT_MAX),
    date: localDate(new Date(r.created_at)),
    hit,
  });
  if (q) {
    const all = [...notes].reverse().find((r) => matches(fold(r.body), q));
    if (all) return note(all, true);
    const some = [...notes].reverse().find((r) => terms.some((t) => fold(r.body).includes(t)));
    if (some) return note(some, true);
  }
  return note(last, false);
}

// Only what the screens show: bookkeeping fields (manual locks, metadata versions) stay on the server.
function card(s: Store, item: Row, ctx: Context): LibraryCard {
  return {
    id: item.id as string,
    title: item.title as string,
    type: item.type as string,
    creator: (item.creator as string | null) ?? null,
    source: item.url ? (item.source as string) : null,
    status: (item.status as string | null) ?? null,
    reaction: (item.reaction as string | null) ?? null,
    date: dateOf(item),
    tags: ((item.tags as string[] | undefined) ?? []).slice(0, 3),
    cover: coverOf(s, item) !== null,
    unreviewed: ctx.unreviewed.has(item.id),
    noThought: ctx.noThought.has(item.id),
    thought: thoughtOf(ctx.notes.get(item.id) ?? [], ctx.q, ctx.terms),
  };
}

function context(s: Store, today: string, q = ""): Context {
  const notes = new Map<string, Row[]>();
  for (const r of s.all("SELECT item_id, body, created_at FROM reflections ORDER BY created_at, update_id"))
    notes.set(r.item_id, [...(notes.get(r.item_id) ?? []), r]);
  return {
    unreviewed: new Set<string>(s.unreflected(today).map((i) => i.id)),
    noThought: new Set<string>(s.unthought().map((i) => i.id)),
    notes,
    q,
    terms: q ? stems(q) : [],
  };
}

// The cards of these materials, in this order (a material that is gone is skipped).
export function libraryCards(s: Store, ids: string[], today = localDate()): LibraryCard[] {
  const ctx = context(s, today);
  return ids.flatMap((id) => {
    const item = s.item(id);
    return item ? [card(s, item, ctx)] : [];
  });
}

export function libraryList(s: Store, filter: LibraryFilter, today = localDate()): LibraryList {
  const ctx = context(s, today, filter.q);
  const { unreviewed, noThought } = ctx;
  const all = s.items();
  const counts = {
    saved: 0,
    unreviewed: unreviewed.size,
    noThought: noThought.size,
    types: {} as Record<string, number>,
  };
  for (const item of all) {
    if (item.status === "saved") counts.saved++;
    counts.types[item.type] = (counts.types[item.type] ?? 0) + 1;
  }
  // The word search is the bot's own: endings are ignored and notes are searched too.
  const found = filter.q
    ? retrieve(
        s,
        {
          terms: [filter.q],
          types: [],
          reaction: null,
          status: null,
          from: null,
          to: null,
          best: false,
          limit: 0,
        },
        Number.POSITIVE_INFINITY,
      )
    : all;
  const items = found
    .filter(
      (item) =>
        (!filter.types.length || filter.types.includes(item.type)) &&
        (!filter.statuses.length || filter.statuses.includes(item.status)) &&
        (!filter.reactions.length || filter.reactions.includes(item.reaction ?? NO_REACTION)) &&
        (!filter.unreviewed || unreviewed.has(item.id)) &&
        (!filter.noThought || noThought.has(item.id)),
    )
    .sort((a, b) => dateOf(b).localeCompare(dateOf(a)) || b.created_at.localeCompare(a.created_at))
    .map((item) => card(s, item, ctx));
  return { items, terms: ctx.terms, total: all.length, counts, labels };
}

export function libraryItem(s: Store, id: string): LibraryItem | undefined {
  const item = s.item(id);
  if (!item) return undefined;
  const notes = s.reflections(id);
  const ctx: Context = {
    unreviewed: new Set(s.unreflected().map((i) => i.id)),
    noThought: new Set(s.unthought().map((i) => i.id)),
    notes: new Map([[id, notes]]),
    q: "",
    terms: [],
  };
  return {
    ...card(s, item, ctx),
    url: web(item.url),
    summary: (item.summary as string | undefined) ?? null,
    description: (item.description as string | undefined) ?? null,
    entities: (item.entities as string[] | undefined) ?? [],
    tags: (item.tags as string[] | undefined) ?? [],
    impressions: notes.map((r) => ({
      date: localDate(new Date(r.created_at)),
      body: r.body as string,
    })),
    collections: collectionsOf(s, id),
    labels,
  };
}

export function libraryCover(s: Store, id: string) {
  const item = s.item(id);
  const path = item ? coverOf(s, item) : null;
  return path ? { path, type: COVER_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream" } : null;
}
