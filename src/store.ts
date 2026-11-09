import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync, existsSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { localDate, types } from "./fields.ts";
import { findUrl, normalizeUrl, typeFromUrl } from "./links.ts";
import type { Suggestion } from "./groq.ts";
import type { Metadata } from "./metadata.ts";

type Row = Record<string, any>;
// Bump to refetch page metadata (and covers) for items loaded by an older version.
export const metadataVersion = 2;
export const needsMetadata = (item: Row) => Boolean(item.url) && item.metadata_loaded !== metadataVersion;
export class Store {
  db: DatabaseSync;
  // Cover images live next to the database; null for in-memory stores.
  coverDir: string | null;
  // `readOnly` is for a second process (the MCP server): it opens the bot's file as it is, with no migrations
  // or clean-ups, and SQLite refuses any write.
  constructor(path: string, options: { readOnly?: boolean } = {}) {
    // The bot, the MCP server and the scripts open the same file; wait for a short lock instead of failing.
    if (options.readOnly) {
      this.db = new DatabaseSync(path, { readOnly: true, timeout: 5000 });
      this.coverDir = join(dirname(path), "covers");
      if (Number(this.all("PRAGMA user_version")[0].user_version) < 3)
        throw new Error("Медіатеку ще не відкривав бот цієї версії, читання без міграції неможливе.");
      return;
    }
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path, { timeout: 5000 });
    this.coverDir = path === ":memory:" ? null : join(dirname(path), "covers");
    if (path !== ":memory:") chmodSync(path, 0o600);
    const previousVersion = Number(this.all("PRAGMA user_version")[0].user_version);
    if (
      previousVersion < 3 &&
      path !== ":memory:" &&
      this.all("SELECT name FROM sqlite_master WHERE type='table' AND name='items'").length &&
      !existsSync(path + ".pre-v3.sqlite")
    ) {
      this.db.prepare("VACUUM INTO ?").run(path + ".pre-v3.sqlite");
      chmodSync(path + ".pre-v3.sqlite", 0o600);
    }
    this.db.exec(`PRAGMA foreign_keys=ON;
   CREATE TABLE IF NOT EXISTS items(id TEXT PRIMARY KEY, url TEXT UNIQUE, title TEXT NOT NULL, type TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS captures(update_id INTEGER PRIMARY KEY, item_id TEXT REFERENCES items(id), raw TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS reflections(update_id INTEGER PRIMARY KEY, item_id TEXT REFERENCES items(id), body TEXT NOT NULL, created_at TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS prompts(message_id INTEGER PRIMARY KEY, item_id TEXT REFERENCES items(id), state TEXT NOT NULL DEFAULT 'pending');
   CREATE TABLE IF NOT EXISTS updates(id INTEGER PRIMARY KEY);
   CREATE TABLE IF NOT EXISTS context(key TEXT PRIMARY KEY, value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS update_context(id INTEGER PRIMARY KEY,value TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS enrichment(update_id INTEGER PRIMARY KEY, item_id TEXT REFERENCES items(id), payload TEXT NOT NULL);
   CREATE TABLE IF NOT EXISTS vault_pending(vault TEXT NOT NULL,item_id TEXT NOT NULL,path TEXT NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(vault,item_id));
   CREATE TABLE IF NOT EXISTS vault_exports(vault TEXT NOT NULL,item_id TEXT NOT NULL,path TEXT NOT NULL,hash TEXT NOT NULL,PRIMARY KEY(vault,item_id));
   CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, item_id TEXT NOT NULL, field TEXT NOT NULL, old TEXT, new TEXT, at TEXT NOT NULL);`);
    if (!this.all("PRAGMA table_info(items)").some((c) => c.name === "details"))
      this.db.exec("ALTER TABLE items ADD COLUMN details TEXT NOT NULL DEFAULT '{}'");
    if (previousVersion < 3) {
      this.transaction(() => {
        for (const row of this.all("SELECT * FROM items")) {
          const detail = JSON.parse(row.details);
          const locked = new Set<string>(detail.manual_fields ?? []);
          if (row.title !== row.url) locked.add("title");
          for (const field of ["creator", "tags", "summary", "source", "entities"])
            if (Object.hasOwn(detail, field)) locked.add(field);
          if (detail.manual_type) locked.add("type");
          this.run(
            "UPDATE items SET details=? WHERE id=?",
            JSON.stringify({ ...detail, manual_fields: [...locked] }),
            row.id,
          );
        }
        this.db.exec("PRAGMA user_version=3");
      });
    }
    this.fixLegacyRows();
  }
  all(sql: string, ...args: any[]): Row[] {
    return this.db.prepare(sql).all(...args) as Row[];
  }
  run(sql: string, ...args: any[]) {
    return this.db.prepare(sql).run(...args);
  }
  transaction<T>(fn: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }
  // Idempotent clean-up of rows written by earlier versions.
  private fixLegacyRows() {
    for (const row of this.all("SELECT id,url,title,type FROM items WHERE url IS NOT NULL")) {
      const url = normalizeUrl(row.url);
      const type =
        row.type === "music"
          ? typeFromUrl(row.url) === "music_album"
            ? "music_album"
            : "music_track"
          : row.type === "unknown"
            ? typeFromUrl(row.url)
            : row.type;
      const free = url && url !== row.url && !this.all("SELECT 1 FROM items WHERE url=?", url).length;
      if (!free && type === row.type) continue;
      this.run(
        "UPDATE items SET url=?,title=?,type=? WHERE id=?",
        free ? url : row.url,
        free && row.title === row.url ? url : row.title,
        type,
        row.id,
      );
      this.fitStatusToType(row.id);
    }
    // Earlier versions stored multi-word tags with underscores.
    for (const row of this.all("SELECT id FROM items WHERE details LIKE '%\\_%' ESCAPE '\\'")) {
      const tags = this.item(row.id)!.tags ?? [];
      const fixed = normalizeTags(tags);
      if (JSON.stringify(fixed) !== JSON.stringify(tags)) this.patch(row.id, { tags: fixed });
    }
    // Earlier versions fed "Автор: невідомий" to the AI, which then saved it as the author.
    for (const row of this.all("SELECT id FROM items WHERE details LIKE '%невідомий%'")) {
      const item = this.item(row.id)!;
      if (item.creator === "невідомий" && !(item.manual_fields ?? []).includes("creator"))
        this.patch(row.id, { creator: null });
    }
  }
  // Drops bookkeeping that only matters while an update is still being retried.
  prune() {
    this.transaction(() => {
      this.run("DELETE FROM update_context WHERE id IN (SELECT id FROM updates)");
      this.run(
        "DELETE FROM context WHERE (key LIKE 'answer:%' OR key LIKE 'voice:%') AND CAST(substr(key,instr(key,':')+1) AS INTEGER) IN (SELECT id FROM updates)",
      );
      this.run("DELETE FROM updates WHERE id NOT IN (SELECT id FROM updates ORDER BY id DESC LIMIT 1000)");
      this.run(
        "DELETE FROM context WHERE (key LIKE 'pager:%' OR key LIKE 'slides:%') AND rowid NOT IN (SELECT rowid FROM context WHERE key LIKE 'pager:%' OR key LIKE 'slides:%' ORDER BY rowid DESC LIMIT 50)",
      );
    });
  }
  unpack(row: Row) {
    const { details, ...base } = row;
    return {
      ...base,
      status: "saved",
      reaction: null,
      consumed_on: null,
      creator: null,
      source: this.source(base.url),
      tags: [],
      ...JSON.parse(details ?? "{}"),
    };
  }
  source(url: string | null) {
    try {
      return new URL(url!).hostname.replace(/^www\./, "");
    } catch {
      return "manual";
    }
  }
  items(): Row[] {
    return this.all("SELECT * FROM items ORDER BY created_at DESC,rowid DESC").map((r) => this.unpack(r));
  }
  // Tags already in use, most frequent first, so the AI reuses them instead of inventing synonyms.
  tagVocabulary(max = 80) {
    const count = new Map<string, number>();
    for (const item of this.items())
      for (const tag of item.tags ?? []) count.set(tag, (count.get(tag) ?? 0) + 1);
    return [...count]
      .sort((a, b) => b[1] - a[1])
      .slice(0, max)
      .map(([tag]) => tag);
  }
  item(id: string): Row | undefined {
    const r = this.all("SELECT * FROM items WHERE id=?", id)[0];
    return r ? this.unpack(r) : undefined;
  }
  reflections(item: string) {
    return this.all("SELECT * FROM reflections WHERE item_id=? ORDER BY created_at,update_id", item);
  }
  captures(item: string) {
    return this.all("SELECT * FROM captures WHERE item_id=? ORDER BY created_at,update_id", item);
  }
  coverPath(item: Row) {
    return this.coverDir && typeof item.cover === "string" && existsSync(join(this.coverDir, item.cover))
      ? join(this.coverDir, item.cover)
      : null;
  }
  patch(id: string, patch: Row) {
    const r = this.all("SELECT * FROM items WHERE id=?", id)[0];
    if (!r) return;
    const { title, type, ...details } = patch;
    this.run(
      "UPDATE items SET title=?,type=?,details=? WHERE id=?",
      title ?? r.title,
      type ?? r.type,
      JSON.stringify({ ...JSON.parse(r.details), ...details }),
      id,
    );
  }
  // Manual edits. Changes of status, reaction and type are logged for later analytics.
  edit(id: string, patch: Row, at = new Date()) {
    const item = this.item(id);
    if (!item) return;
    for (const field of ["status", "reaction", "type"])
      if (Object.hasOwn(patch, field) && (patch[field] ?? null) !== (item[field] ?? null))
        this.run(
          "INSERT INTO events(item_id,field,old,new,at) VALUES (?,?,?,?,?)",
          id,
          field,
          item[field] ?? null,
          patch[field] ?? null,
          at.toISOString(),
        );
    const locked = new Set<string>(item.manual_fields ?? []);
    for (const field of Object.keys(patch)) locked.add(field);
    this.patch(id, {
      ...patch,
      manual_fields: [...locked],
      ...(Object.hasOwn(patch, "consumed_on") ? { date_source: patch.consumed_on ? "user" : null } : {}),
    });
    if (Object.hasOwn(patch, "type")) this.fitStatusToType(id);
  }
  applyAI(id: string, value: Suggestion | null) {
    const item = this.item(id);
    if (!item || !value) return;
    const locked = new Set<string>(item.manual_fields ?? []);
    if (item.manual_type) locked.add("type");
    const fromPage = new Set<string>(item.metadata_fields ?? []);
    const patch: Row = { ai_done: aiVersion };
    if (value.type && value.type !== "unknown" && Object.hasOwn(types, value.type) && !locked.has("type"))
      patch.type = value.type;
    // An empty AI answer (e.g. for a one-word reflection) must not erase earlier tags.
    if (value.tags?.length && !locked.has("tags")) patch.tags = normalizeTags(value.tags);
    if (value.entities?.length && !locked.has("entities")) patch.entities = value.entities.slice(0, 8);
    if (value.summary && !locked.has("summary")) patch.summary = value.summary;
    if (value.title && !locked.has("title") && !fromPage.has("title")) patch.title = value.title;
    if (value.creator && !locked.has("creator") && !fromPage.has("creator")) patch.creator = value.creator;
    this.patch(id, patch);
    this.fitStatusToType(id);
  }
  // Returns the id that holds the item afterwards: a fresh capture of a page that
  // is already saved under another URL (e.g. a Threads /share/ link) is merged into it.
  applyMetadata(id: string, meta: Metadata | null) {
    const item = this.item(id);
    if (!item) return id;
    if (!meta) return id;
    const canonical = meta.url ? normalizeUrl(meta.url) : null;
    if (canonical && canonical !== item.url) {
      const existing = this.all("SELECT id FROM items WHERE url=?", canonical)[0]?.id as string | undefined;
      const fresh =
        this.captures(id).length === 1 && !this.all("SELECT 1 FROM vault_exports WHERE item_id=?", id).length;
      if (existing && fresh) {
        this.transaction(() => {
          for (const table of ["captures", "reflections", "prompts", "enrichment"])
            this.run(`UPDATE ${table} SET item_id=? WHERE item_id=?`, existing, id);
          this.run("DELETE FROM items WHERE id=?", id);
        });
        return existing;
      }
      if (!existing) this.run("UPDATE items SET url=? WHERE id=?", canonical, id);
    }
    const locked = new Set<string>(item.manual_fields ?? []);
    const patch: Row = { metadata_loaded: metadataVersion, metadata_fields: [] as string[] };
    if (meta.title && !locked.has("title")) {
      patch.title = meta.title;
      patch.metadata_fields.push("title");
    }
    if (meta.creator && !locked.has("creator")) {
      patch.creator = meta.creator;
      patch.metadata_fields.push("creator");
    }
    if (meta.description) patch.description = meta.description;
    if (meta.site) patch.site = meta.site;
    if (meta.image) patch.image_url = meta.image;
    this.patch(id, patch);
    return id;
  }
  value(key: string) {
    return this.all("SELECT value FROM context WHERE key=?", key)[0]?.value as string | undefined;
  }
  setValue(key: string, value: string) {
    this.run("INSERT OR REPLACE INTO context VALUES (?,?)", key, value);
  }
  context(): any {
    const value = this.value("active");
    return value ? JSON.parse(value) : null;
  }
  requestContext(id: number) {
    const current = this.context();
    const active = current?.expires < Date.now() ? null : current;
    this.run("INSERT OR IGNORE INTO update_context VALUES (?,?)", id, JSON.stringify(active));
    return JSON.parse(this.all("SELECT value FROM update_context WHERE id=?", id)[0].value);
  }
  addReflection(update: number, id: string, body: string, at = new Date()) {
    this.transaction(() => {
      this.run("INSERT OR IGNORE INTO reflections VALUES (?,?,?,?)", update, id, body, at.toISOString());
      this.run("UPDATE prompts SET state='answered' WHERE item_id=?", id);
    });
  }
  removeReflection(update: number) {
    const row = this.all("SELECT * FROM reflections WHERE update_id=?", update)[0];
    if (row) this.run("DELETE FROM reflections WHERE update_id=?", update);
    return row;
  }
  setContext(value: any) {
    this.setValue("active", JSON.stringify(value));
  }
  saveAI(update: number, item: string, payload: unknown) {
    this.run("INSERT OR IGNORE INTO enrichment VALUES (?,?,?)", update, item, JSON.stringify(payload));
  }
  ai(update: number) {
    const r = this.all("SELECT payload FROM enrichment WHERE update_id=?", update)[0];
    return r ? JSON.parse(r.payload) : undefined;
  }
  offset() {
    return Number(this.all("SELECT COALESCE(MAX(id),-1)+1 AS n FROM updates")[0].n);
  }
  seen(id: number) {
    return this.all("SELECT id FROM updates WHERE id=?", id).length > 0;
  }
  done(id: number) {
    this.run("INSERT OR IGNORE INTO updates VALUES (?)", id);
  }
  lastCapture() {
    return this.all(
      "SELECT item_id,created_at FROM captures ORDER BY created_at DESC,update_id DESC LIMIT 1",
    )[0];
  }
  // note=false: text next to the link is not the user's own (e.g. a forwarded post).
  capture(update: number, raw: string, capturedAt = new Date(), note = true) {
    const previous = this.all("SELECT item_id FROM captures WHERE update_id=?", update)[0];
    if (previous) return previous.item_id as string;
    const found = findUrl(raw);
    const url = found ? normalizeUrl(found) : null;
    const id = (url ? this.all("SELECT id FROM items WHERE url=?", url)[0]?.id : null) ?? randomUUID();
    const now = capturedAt.toISOString();
    this.transaction(() => {
      this.run(
        "INSERT OR IGNORE INTO items(id,url,title,type,created_at,details) VALUES (?,?,?,?,?,?)",
        id,
        url,
        url ?? raw.slice(0, 160),
        typeFromUrl(url),
        now,
        JSON.stringify(
          typeFromUrl(url) === "resource"
            ? { status: null }
            : { status: "consumed", consumed_on: localDate(capturedAt), date_source: "capture" },
        ),
      );
      this.run("INSERT INTO captures VALUES (?,?,?,?)", update, id, raw, now);
      const text = note && url && found ? raw.replace(found, "").trim() : "";
      if (text) this.run("INSERT INTO reflections VALUES (?,?,?,?)", update, id, text, now);
    });
    return id as string;
  }
  // A resource (a site kept for reuse) is not something you "watched on a date": it has no
  // status of its own. The automatic «Ознайомився» + save date is dropped or restored when
  // the type changes; anything the user set by hand stays.
  fitStatusToType(id: string) {
    const i = this.item(id);
    if (!i) return;
    if (i.type === "resource" && i.status === "consumed" && i.date_source === "capture")
      this.patch(id, { status: null, consumed_on: null, date_source: null });
    else if (i.type !== "resource" && i.status === null)
      this.patch(id, {
        status: "consumed",
        consumed_on: localDate(new Date(i.created_at)),
        date_source: "capture",
      });
  }
  // Things to reflect on: no reflection yet, not skipped or snoozed, already seen
  // (not «На потім») and not a resource.
  unreflected(today = localDate()) {
    return this.all(
      `SELECT * FROM items i WHERE NOT EXISTS(SELECT 1 FROM reflections r WHERE r.item_id=i.id) AND NOT EXISTS(SELECT 1 FROM prompts p WHERE p.item_id=i.id AND p.state IN ('answered','skipped')) ORDER BY created_at,rowid`,
    )
      .map((r) => this.unpack(r))
      .filter((i) => !i.snooze_until || i.snooze_until <= today)
      .filter((i) => i.type !== "resource" && i.status !== "saved");
  }
  // Seen items with no written thought, whatever the reaction and the type (resources and videos included):
  // unlike `unreflected`, a reaction alone does not take an item out of this set.
  unthought() {
    return this.all(
      "SELECT * FROM items i WHERE NOT EXISTS(SELECT 1 FROM reflections r WHERE r.item_id=i.id) ORDER BY created_at,rowid",
    )
      .map((r) => this.unpack(r))
      .filter((i) => i.status !== "saved");
  }
  // The vault note is cleaned up by the next export (see exportVault).
  deleteItem(id: string) {
    const item = this.item(id);
    if (!item) return;
    const cover = this.coverPath(item);
    this.transaction(() => {
      for (const table of ["captures", "reflections", "prompts", "enrichment", "vault_pending", "events"])
        this.run(`DELETE FROM ${table} WHERE item_id=?`, id);
      this.run("DELETE FROM items WHERE id=?", id);
    });
    if (cover) rmSync(cover, { force: true });
  }
  link(message: number, item: string) {
    this.run("INSERT OR IGNORE INTO prompts(message_id,item_id) VALUES (?,?)", message, item);
  }
  prompt(message: number) {
    return this.all("SELECT * FROM prompts WHERE message_id=?", message)[0];
  }
  snapshot() {
    return {
      schema_version: 3,
      items: this.items(),
      captures: this.all("SELECT * FROM captures"),
      reflections: this.all("SELECT * FROM reflections"),
      ai_enrichments: this.all("SELECT * FROM enrichment").map((r): Row => ({
        ...r,
        payload: JSON.parse(r.payload),
      })),
    };
  }
  close() {
    this.db.close();
  }
}

// Bumped when the AI prompt changes enough that /enrich should redo older items.
export const aiVersion = 2;
export const aiCurrent = (item: Row) => item.ai_done === aiVersion;
// Tags are stored as plain words ("штучний інтелект"); Obsidian gets them with underscores.
export function normalizeTags(values: string[]) {
  return [
    ...new Set(
      values
        .map((t) =>
          t
            .toLowerCase()
            .replace(/[^\p{L}\p{N}/'’-]+/gu, " ")
            .trim()
            .replace(/^[/-]+|[/-]+$/g, ""),
        )
        .filter((t) => t && /\p{L}/u.test(t)),
    ),
  ].slice(0, 20);
}
