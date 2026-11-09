import {
  addToCollection,
  collection,
  collectionRows,
  createCollection,
  deleteCollection,
  memberIds,
  removeFromCollection,
  renameCollection,
  type Named,
} from "../collections.ts";
import { reactions, statuses, types } from "../fields.ts";
import type { Store } from "../store.ts";
import type { CollectionCard, CollectionList, CollectionView, Tile } from "./collection-types.ts";
import { libraryCards } from "./library.ts";
import { bad, done, missing, record, type Written } from "./write.ts";

const TILES = 4;

function tile(s: Store, id: string): Tile | null {
  const item = s.item(id);
  return item ? { id, title: item.title as string, cover: s.coverPath(item) !== null } : null;
}

// The mosaic takes the newest materials that have a picture; if there are fewer than four, plain tiles fill in.
function tilesOf(s: Store, ids: string[]): Tile[] {
  const all = ids.flatMap((id) => tile(s, id) ?? []);
  return [...all.filter((t) => t.cover), ...all.filter((t) => !t.cover)].slice(0, TILES);
}

const cardOf = (s: Store, row: { id: string; name: string }, ids: string[]): CollectionCard => ({
  id: row.id,
  name: row.name,
  count: ids.length,
  tiles: tilesOf(s, ids),
});

export function collectionList(s: Store): CollectionList {
  return { collections: collectionRows(s).map((row) => cardOf(s, row, memberIds(s, row.id))) };
}

export function collectionView(s: Store, id: string): CollectionView | undefined {
  const row = collection(s, id);
  if (!row) return undefined;
  const ids = memberIds(s, id);
  return {
    ...cardOf(s, row as { id: string; name: string }, ids),
    items: libraryCards(s, ids),
    labels: { types, statuses, reactions },
  };
}

const named = (result: Named): Written<{ id: string }> =>
  result.ok ? done({ id: result.id }) : result.error === "missing" ? missing : bad(result.error);

export const addCollection = (s: Store, input: unknown, now = new Date()) =>
  named(createCollection(s, record(input).name, now));

export function editCollection(s: Store, id: string, input: unknown): Written<CollectionView> {
  const result = named(renameCollection(s, id, record(input).name));
  return result.ok ? done(collectionView(s, id)!) : result;
}

export const removeCollection = (s: Store, id: string): Written<true> =>
  deleteCollection(s, id) ? done(true) : missing;

const itemOf = (input: unknown) => {
  const { itemId } = record(input);
  return typeof itemId === "string" ? itemId : null;
};

export function putInCollection(
  s: Store,
  id: string,
  input: unknown,
  now = new Date(),
): Written<CollectionView> {
  if (!collection(s, id)) return missing;
  const itemId = itemOf(input);
  if (!itemId) return bad("itemId");
  if (!s.item(itemId)) return missing;
  return addToCollection(s, id, itemId, now) ? done(collectionView(s, id)!) : bad("full");
}

export function takeOutOfCollection(s: Store, id: string, input: unknown): Written<CollectionView> {
  if (!collection(s, id)) return missing;
  const itemId = itemOf(input);
  if (!itemId) return bad("itemId");
  removeFromCollection(s, id, itemId);
  return done(collectionView(s, id)!);
}
