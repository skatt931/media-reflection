import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { Store } from "./store.ts";
import { localDate } from "./fields.ts";
import { personalMarker, renderNote, safeName } from "./vault.ts";
import { zip, type ZipFile } from "./zip.ts";

// Telegram lets a bot send files up to 50 MB; stay well below it.
const MAX_BYTES = 40 * 1024 * 1024;
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
export type ExportPackage = {
  name: string;
  // null when there is nothing new to send.
  zip: Buffer | null;
  notes: number;
  covers: number;
  // New items that did not fit into this archive; the next export takes them.
  left: number;
  // Already exported items whose note would look different now. They are not sent again.
  changed: string[];
  // Already exported items that were deleted in the bot.
  deleted: string[];
  // Marks what the archive contains as delivered. Call it only after Telegram has accepted the file.
  commit(): void;
};

// New notes and covers since the previous export, as one archive that unpacks into the vault.
// Notes exported earlier are never sent again; ones that changed afterwards are only recorded (`export_changes`).
export function buildExport(s: Store, now = new Date()): ExportPackage {
  const at = now.toISOString();
  const done = new Map(s.all("SELECT * FROM export_notes").map((row) => [row.item_id as string, row]));
  const files: ZipFile[] = [];
  const delivered: { id: string; path: string; hash: string; cover: string | null; title: string }[] = [];
  const changed: string[] = [];
  const deleted: string[] = [];
  let notes = 0;
  let covers = 0;
  let left = 0;
  let size = 0;
  const live = new Set<string>();
  const record = (id: string, kind: string, digest: string, title: string) =>
    s.run("INSERT OR IGNORE INTO export_changes VALUES (?,?,?,?,?)", id, kind, digest, title, at);
  for (const item of s.items()) {
    live.add(item.id);
    const source = s.coverPath(item);
    const cover = source && item.cover === basename(item.cover) ? (item.cover as string) : null;
    const generated = renderNote(s, item.id, cover && `Медіатека/Обкладинки/${cover}`);
    const digest = hash(generated);
    const row = done.get(item.id);
    if (row && row.hash !== digest) {
      changed.push(item.title);
      record(item.id, "changed", digest, item.title);
    }
    const newCover = cover && row?.cover !== cover ? cover : null;
    if (row && !newCover) continue;
    const entry: ZipFile[] = [];
    const path = row?.path ?? `${safeName(item.title)} — ${item.id}.md`;
    if (!row)
      entry.push({
        name: `Медіатека/Матеріали/${path}`,
        data: generated + personalMarker + "\n## Мої доповнення\n\n",
      });
    if (newCover) entry.push({ name: `Медіатека/Обкладинки/${newCover}`, data: readFileSync(source!) });
    const bytes = entry.reduce((sum, file) => sum + Buffer.byteLength(file.data), 0);
    if (files.length && size + bytes > MAX_BYTES) {
      left++;
      continue;
    }
    size += bytes;
    files.push(...entry);
    if (!row) notes++;
    if (newCover) covers++;
    // A note that was delivered earlier keeps its old hash, so a later change stays visible.
    delivered.push({
      id: item.id,
      path,
      hash: row?.hash ?? digest,
      cover: newCover ?? row?.cover ?? null,
      title: item.title,
    });
  }
  for (const row of done.values()) {
    if (live.has(row.item_id)) continue;
    deleted.push(row.title);
    record(row.item_id, "deleted", "", row.title);
  }
  return {
    name: `media-reflection-${localDate(now)}.zip`,
    zip: files.length ? zip(files, now) : null,
    notes,
    covers,
    left,
    changed,
    deleted,
    commit() {
      s.transaction(() => {
        for (const d of delivered)
          s.run(
            "INSERT INTO export_notes VALUES (?,?,?,?,?,?) ON CONFLICT(item_id) DO UPDATE SET cover=excluded.cover",
            d.id,
            d.path,
            d.hash,
            d.cover,
            d.title,
            at,
          );
      });
    },
  };
}
