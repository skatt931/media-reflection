import { randomBytes } from "node:crypto";
import type { Store } from "./store.ts";

// Hand-made sets of materials with a purpose of their own («Дизайн мого застосунку»). The tables are two
// plain ones: dropping them (and this file) removes the feature without touching the library.
type Row = Record<string, any>;

export const MAX_NAME = 60;
export const MAX_COLLECTIONS = 100;
export const MAX_MEMBERS = 500;

export type Named = { ok: true; id: string } | { ok: false; error: "name" | "exists" | "limit" | "missing" };

export function cleanName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // Zero-width and bidi control characters are dropped: they make two names look the same and differ.
  const name = value
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return name && name.length <= MAX_NAME ? name : null;
}

// Short, so a collection id and a material id fit together in Telegram's 64 bytes of callback data.
const newId = () => randomBytes(4).toString("hex");

const same = (a: string, b: string) => a.toLocaleLowerCase("uk") === b.toLocaleLowerCase("uk");

// The most recently touched first: adding to a collection brings it to the front.
export function collectionRows(s: Store): { id: string; name: string; created_at: string; count: number }[] {
  return s.all(
    `SELECT c.id, c.name, c.created_at,
       (SELECT COUNT(*) FROM collection_items m JOIN items i ON i.id=m.item_id WHERE m.collection_id=c.id) AS count,
       COALESCE((SELECT MAX(added_at) FROM collection_items m WHERE m.collection_id=c.id), c.created_at) AS touched
     FROM collections c ORDER BY touched DESC, c.rowid DESC`,
  ) as any;
}

export const collection = (s: Store, id: string): Row | undefined =>
  s.all("SELECT * FROM collections WHERE id=?", id)[0];

// Newest addition first; a material that was deleted is simply not there.
export const memberIds = (s: Store, id: string): string[] =>
  s
    .all(
      "SELECT m.item_id FROM collection_items m JOIN items i ON i.id=m.item_id WHERE m.collection_id=? ORDER BY m.added_at DESC, m.rowid DESC",
      id,
    )
    .map((r) => r.item_id as string);

export const collectionsOf = (s: Store, itemId: string): string[] =>
  s
    .all("SELECT collection_id FROM collection_items WHERE item_id=?", itemId)
    .map((r) => r.collection_id as string);

export function createCollection(s: Store, value: unknown, at = new Date()): Named {
  const name = cleanName(value);
  if (!name) return { ok: false, error: "name" };
  const all = collectionRows(s);
  if (all.some((c) => same(c.name, name))) return { ok: false, error: "exists" };
  if (all.length >= MAX_COLLECTIONS) return { ok: false, error: "limit" };
  const id = newId();
  s.run("INSERT INTO collections VALUES (?,?,?)", id, name, at.toISOString());
  return { ok: true, id };
}

export function renameCollection(s: Store, id: string, value: unknown): Named {
  if (!collection(s, id)) return { ok: false, error: "missing" };
  const name = cleanName(value);
  if (!name) return { ok: false, error: "name" };
  if (collectionRows(s).some((c) => c.id !== id && same(c.name, name))) return { ok: false, error: "exists" };
  s.run("UPDATE collections SET name=? WHERE id=?", name, id);
  return { ok: true, id };
}

// The materials stay in the library; only the set goes.
export function deleteCollection(s: Store, id: string) {
  if (!collection(s, id)) return false;
  s.transaction(() => {
    s.run("DELETE FROM collection_items WHERE collection_id=?", id);
    s.run("DELETE FROM collections WHERE id=?", id);
  });
  return true;
}

// Adding twice changes nothing. False when the collection or the material is not there, or the set is full.
export function addToCollection(s: Store, id: string, itemId: string, at = new Date()) {
  if (!collection(s, id) || !s.item(itemId)) return false;
  if (collectionsOf(s, itemId).includes(id)) return true;
  if (memberIds(s, id).length >= MAX_MEMBERS) return false;
  s.run("INSERT INTO collection_items VALUES (?,?,?)", id, itemId, at.toISOString());
  return true;
}

export function removeFromCollection(s: Store, id: string, itemId: string) {
  s.run("DELETE FROM collection_items WHERE collection_id=? AND item_id=?", id, itemId);
}

// The names of the collections a material is in, oldest collection first.
export const namesOf = (s: Store, itemId: string): string[] =>
  s
    .all(
      "SELECT c.name FROM collection_items m JOIN collections c ON c.id=m.collection_id WHERE m.item_id=? ORDER BY c.rowid",
      itemId,
    )
    .map((r) => r.name as string);
