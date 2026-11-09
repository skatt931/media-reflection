// What the Mini App shows of a month's album. Only types: the screens bundle this file.
import type { Tile } from "./collection-types.ts";

export type AlbumQuote = { id: string; title: string; body: string; date: string };
export type AlbumNote = { id: number; date: string; excerpt: string };

export type Album = {
  // "2026-11"
  period: string;
  // A finished month is on the shelf for good; the current one is still filling up.
  done: boolean;
  counts: { saved: number; loved: number; thoughts: number; diary: number };
  // Everything marked ❤️ that month, the newest first.
  loved: Tile[];
  // Places in the mosaic while the month is open, so an album that is half empty looks half empty.
  slots: number;
  quotes: AlbumQuote[];
  diary: AlbumNote[];
  // The neighbouring months that have an album.
  older: string | null;
  newer: string | null;
};

export type AlbumCard = {
  period: string;
  done: boolean;
  saved: number;
  loved: number;
  thoughts: number;
  tiles: Tile[];
};
export type Shelf = { albums: AlbumCard[] };
