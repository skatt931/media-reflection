import { dirname, extname } from "node:path";
import { localDate, reactions, statuses, types } from "../fields.ts";
import { retrieve } from "../search.ts";
import type { Store } from "../store.ts";
import {
  NO_REACTION,
  type Labels,
  type LibraryCard,
  type LibraryItem,
  type LibraryList,
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

// Only what the screens show: bookkeeping fields (manual locks, metadata versions) stay on the server.
function card(s: Store, item: Row, unreviewed: Set<string>, noThought: Set<string>): LibraryCard {
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
    unreviewed: unreviewed.has(item.id),
    noThought: noThought.has(item.id),
  };
}

export function libraryList(s: Store, filter: LibraryFilter, today = localDate()): LibraryList {
  const unreviewed = new Set<string>(s.unreflected(today).map((i) => i.id));
  const noThought = new Set<string>(s.unthought().map((i) => i.id));
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
    .map((item) => card(s, item, unreviewed, noThought));
  return { items, total: all.length, counts, labels };
}

export function libraryItem(s: Store, id: string): LibraryItem | undefined {
  const item = s.item(id);
  if (!item) return undefined;
  return {
    ...card(s, item, new Set(s.unreflected().map((i) => i.id)), new Set(s.unthought().map((i) => i.id))),
    url: web(item.url),
    summary: (item.summary as string | undefined) ?? null,
    description: (item.description as string | undefined) ?? null,
    entities: (item.entities as string[] | undefined) ?? [],
    tags: (item.tags as string[] | undefined) ?? [],
    impressions: s.reflections(id).map((r) => ({
      date: localDate(new Date(r.created_at)),
      body: r.body as string,
    })),
    labels,
  };
}

export function libraryCover(s: Store, id: string) {
  const item = s.item(id);
  const path = item ? coverOf(s, item) : null;
  return path ? { path, type: COVER_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream" } : null;
}
