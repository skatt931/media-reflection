// What the Mini App gets for a month's wrap. Only types: the screens bundle this file.
import type { AlbumQuote } from "./album-types.ts";
import type { Tile } from "./collection-types.ts";

// A candidate for the «unexpected fact» card. The words around the number are chosen by code:
// the card reads `${n} ${plural(n, unit)} ${rest}`.
export type WrapFact = {
  id: string;
  n: number;
  unit: [one: string, few: string, many: string];
  rest: string;
  detail: string;
};

export type WrapFacts = {
  period: string;
  saved: number;
  // Against the month before; null when that month had nothing.
  previous: number | null;
  topType: { label: string; n: number } | null;
  loved: Tile[];
  // The newest materials: the cover's face when nothing was marked ❤️.
  latest: Tile[];
  topics: [name: string, n: number][];
  authors: [name: string, n: number][];
  // Rows: morning, day, evening, night. Columns: Monday … Sunday.
  rhythm: number[][];
  // The busiest cell of the grid, e.g. "неділя ввечері"; null when there is no single peak.
  peak: string | null;
  // The latest save of the month by the clock, "02:47 у вівторок".
  late: string | null;
  facts: WrapFact[];
  quotes: AlbumQuote[];
};

// What is stored per month: no titles or quotes, only what points at the live facts.
export type WrapSpec = {
  seed: number;
  createdAt: string;
  // Written by the AI; null without Groq.
  mood: string | null;
  moodLine: string | null;
  numberLine: string | null;
  factId: string | null;
  factLine: string | null;
};

export type Wrap = { facts: WrapFacts; spec: WrapSpec | null };
