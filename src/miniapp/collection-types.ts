// What the Mini App shows of collections. Only types: the screens bundle this file.
import type { Labels, LibraryCard } from "./library-types.ts";

// A cover for a mosaic (a material without one shows its first letter).
export type Tile = { id: string; title: string; cover: boolean };

export type CollectionCard = { id: string; name: string; count: number; tiles: Tile[] };
export type CollectionList = { collections: CollectionCard[] };
export type CollectionView = CollectionCard & { items: LibraryCard[]; labels: Labels };
