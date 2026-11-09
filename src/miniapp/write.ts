import { localDate, localTime, reactions, statuses, types, validDate } from "../fields.ts";
import { sha256, type JournalStore } from "../journal.ts";
import { normalizeTags, type Store } from "../store.ts";

// What the Mini App may change. Everything is checked here, not in the screens: the server trusts nothing it
// gets. A refusal says which field was wrong, never why in detail.
export type Written<T> = { ok: true; value: T } | { ok: false; status: 400 | 404; error: string };

const bad = (error: string): Written<never> => ({ ok: false, status: 400, error });
const missing: Written<never> = { ok: false, status: 404, error: "not_found" };
const done = <T>(value: T): Written<T> => ({ ok: true, value });

export const MAX_DIARY = 100_000;
export const MAX_NOTE = 4_000;
export const MAX_TAGS = 20;
// A retry of a request that did arrive (a lost answer, a double tap) must not write the same text twice.
const REPEAT_WINDOW = 2 * 60 * 1000;

const record = (input: unknown): Record<string, unknown> =>
  input && typeof input === "object" && !Array.isArray(input) ? (input as Record<string, unknown>) : {};

function text(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const body = value.replace(/\r\n?/g, "\n").trim();
  return body && body.length <= max ? body : null;
}

const ago = (now: Date) => new Date(now.getTime() - REPEAT_WINDOW).toISOString();

// A new diary entry, like one finished in the bot: it goes to Obsidian with the next weekly copy.
export function addDiaryEntry(
  journal: JournalStore,
  input: unknown,
  now = new Date(),
): Written<{ id: number }> {
  const { date, body: raw } = record(input);
  const body = text(raw, MAX_DIARY);
  if (!body) return bad("body");
  if (typeof date !== "string" || !validDate(date) || date > localDate(now)) return bad("date");
  const same = journal.all(
    "SELECT id FROM journal_entries WHERE source='bot' AND entry_date=? AND body_sha256=? AND created_at>? ORDER BY id DESC LIMIT 1",
    date,
    sha256(body),
    ago(now),
  )[0];
  if (same) return done({ id: same.id as number });
  const result = journal.add({ date, body, source: "bot" });
  return done({ id: Number(result.lastInsertRowid) });
}

export function addIdea(journal: JournalStore, input: unknown, now = new Date()): Written<{ id: number }> {
  const body = text(record(input).body, MAX_NOTE);
  if (!body) return bad("body");
  const same = journal.all(
    "SELECT id FROM ideas WHERE body_sha256=? AND created_at>? ORDER BY id DESC LIMIT 1",
    sha256(body),
    ago(now),
  )[0];
  if (same) return done({ id: same.id as number });
  const id = journal.addIdea({ body, source: "text", date: localDate(now), time: localTime(now) });
  return id === null ? bad("body") : done({ id });
}

export function resolveIdea(
  journal: JournalStore,
  id: number,
  resolved: boolean,
  now = new Date(),
): Written<true> {
  return journal.setIdeaResolved(id, resolved ? now : null) ? done(true) : missing;
}

const flag = (value: unknown, allowed: Record<string, string>) =>
  typeof value === "string" && Object.hasOwn(allowed, value);

// The same edits the bot makes, through the same `Store.edit`: what is set by hand is locked, so the AI never
// overwrites it. One field at a time is the normal call; several are applied together.
export function editItem(store: Store, id: string, input: unknown, now = new Date()): Written<true> {
  const item = store.item(id);
  if (!item) return missing;
  const body = record(input);
  const patch: Record<string, unknown> = {};
  if ("type" in body) {
    if (!flag(body.type, types)) return bad("type");
    patch.type = body.type;
  }
  if ("status" in body) {
    if (!flag(body.status, statuses)) return bad("status");
    patch.status = body.status;
    if (body.status === "saved") Object.assign(patch, { consumed_on: null, date_source: null });
    // Seen or finished with no date yet: today, as «Ознайомився» does in the bot.
    else if (["consumed", "finished"].includes(body.status as string) && !item.consumed_on)
      patch.consumed_on = localDate(now);
  }
  if ("reaction" in body) {
    if (body.reaction !== null && !flag(body.reaction, reactions)) return bad("reaction");
    patch.reaction = body.reaction;
  }
  if ("tags" in body) {
    if (
      !Array.isArray(body.tags) ||
      body.tags.length > MAX_TAGS ||
      !body.tags.every((t) => typeof t === "string")
    )
      return bad("tags");
    patch.tags = normalizeTags(body.tags as string[]);
  }
  if (!Object.keys(patch).length) return bad("empty");
  store.transaction(() => {
    store.edit(id, patch, now);
    // A reaction answers the reflection prompt, so the item leaves «Без вражень».
    if (patch.reaction)
      store.run("UPDATE prompts SET state='answered' WHERE item_id=? AND state='pending'", id);
  });
  return done(true);
}

// Telegram update ids are positive, so a negative id never meets one. Nothing is sent to the AI: the text is
// the owner's own, stored as it is.
export function addImpression(store: Store, id: string, input: unknown, now = new Date()): Written<true> {
  if (!store.item(id)) return missing;
  const body = text(record(input).body, MAX_NOTE);
  if (!body) return bad("body");
  if (
    store.all("SELECT 1 FROM reflections WHERE item_id=? AND body=? AND created_at>?", id, body, ago(now))
      .length
  )
    return done(true);
  let update = -Math.floor(now.getTime());
  while (store.all("SELECT 1 FROM reflections WHERE update_id=?", update).length) update--;
  store.addReflection(update, id, body, now);
  return done(true);
}
