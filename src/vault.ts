import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  renameSync,
  unlinkSync,
  readdirSync,
  realpathSync,
  copyFileSync,
  constants,
} from "node:fs";
import { join, resolve, relative, isAbsolute, dirname, basename } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { Store } from "./store.ts";
import { types, statuses, reactions, localDate } from "./fields.ts";
import { review, reviewMarkdown, periods, periodTitle, displayTitle } from "./stats.ts";
export const personalMarker = "<!-- media-reflection:personal -->";
const hash = (text: string) => createHash("sha256").update(text).digest("hex");
const safeName = (text: string) =>
  text
    .replace(/[\x00-\x1f<>:"/\\|?*\[\]#^]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 65) || "Матеріал";
const label = (text: string) => text.replace(/[\[\]|\r\n]/g, " ");
export type ExportReport = {
  created: number;
  updated: number;
  unchanged: number;
  conflicts: string[];
  overviewConflict: boolean;
  removed: number;
  // Notes of items deleted in the bot that were kept because they have manual edits.
  kept: string[];
};
function securePath(root: string, path: string) {
  const rel = relative(root, path);
  if (rel.startsWith("..") || isAbsolute(rel)) throw Error("Шлях поза vault.");
  let current = root;
  for (const part of rel.split("/").filter(Boolean)) {
    current = join(current, part);
    if (lstatSync(current, { throwIfNoEntry: false })?.isSymbolicLink())
      throw Error("Символічні посилання (symlink) у шляху експорту заборонені.");
  }
}
function renderNote(s: Store, id: string, cover: string | null) {
  const item = s.item(id)!;
  const properties = {
    media_reflection_id: id,
    тип: types[item.type] ?? item.type,
    автор: item.creator ?? null,
    джерело: item.source,
    посилання: item.url,
    стан: statuses[item.status] ?? item.status,
    дата: item.consumed_on,
    дата_джерело: item.date_source ?? null,
    додано: localDate(new Date(item.created_at)),
    враження: reactions[item.reaction] ?? null,
    // Obsidian tags cannot contain spaces.
    tags: (item.tags ?? []).map((t: string) => t.replace(/\s+/g, "_")),
    сутності: item.entities ?? [],
    ...(cover ? { обкладинка: `[[${cover}]]` } : {}),
  };
  const frontmatter = Object.entries(properties)
    .map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
    .join("\n");
  const notes = s
    .reflections(id)
    .map((r) => `### ${localDate(new Date(r.created_at))}\n\n${r.body}`)
    .join("\n\n");
  const captures = s.captures(id);
  const history =
    captures.length > 1
      ? "\n\n## Історія додавань\n\n" +
        captures.map((c) => `- ${localDate(new Date(c.created_at))} — збережено в Telegram`).join("\n")
      : "";
  const summary =
    typeof item.summary === "string" && item.summary
      ? "\n\n## Про матеріал · AI\n\n" + item.summary.replace(/</g, "&lt;").replace(/```/g, "\\`\\`\\`")
      : "";
  const escape = (text: string) => text.replace(/</g, "&lt;").replace(/```/g, "\\`\\`\\`");
  const header =
    (cover ? `\n![[${cover}|400]]\n` : "") +
    (typeof item.description === "string" && item.description && item.description !== item.title
      ? `\n> ${escape(item.description).replace(/\n/g, "\n> ")}\n`
      : "");
  const generated = `---\n${frontmatter}\n---\n\n# ${item.title}\n\n[[Медіатека/Медіатека|← Медіатека]]\n${header}\n## Мої враження\n\n${notes || "—"}${summary}${history}\n\n`;
  return generated.replaceAll(personalMarker, "&lt;!-- media-reflection:personal -->");
}
export function exportVault(s: Store, vault: string): ExportReport {
  if (!vault || !isAbsolute(vault)) throw Error("Вкажи абсолютний OBSIDIAN_VAULT_PATH.");
  if (!existsSync(vault) || !lstatSync(vault).isDirectory() || !existsSync(join(vault, ".obsidian")))
    throw Error("Obsidian vault не знайдено. Перевір OBSIDIAN_VAULT_PATH.");
  const root = realpathSync(vault);
  const library = join(root, "Медіатека");
  const materials = join(library, "Матеріали");
  const covers = join(library, "Обкладинки");
  const summaries = join(library, "Підсумки");
  securePath(root, library);
  securePath(root, materials);
  securePath(root, covers);
  securePath(root, summaries);
  mkdirSync(materials, { recursive: true, mode: 0o700 });
  // Copies the cover once; returns its vault-relative path for embedding.
  const coverFor = (item: Record<string, any>) => {
    const source = s.coverPath(item);
    if (!source) return null;
    const target = join(covers, item.cover);
    if (dirname(target) !== covers) return null;
    mkdirSync(covers, { recursive: true, mode: 0o700 });
    securePath(root, target);
    if (!existsSync(target)) copyFileSync(source, target, constants.COPYFILE_EXCL);
    return relative(root, target);
  };
  const report: ExportReport = {
    created: 0,
    updated: 0,
    unchanged: 0,
    conflicts: [],
    overviewConflict: false,
    removed: 0,
    kept: [],
  };
  const links = new Map<string, string>();
  function write(
    id: string,
    path: string,
    generated: string,
  ): "created" | "updated" | "unchanged" | "conflict" {
    securePath(root, path);
    const pending = s.all("SELECT * FROM vault_pending WHERE vault=? AND item_id=?", root, id)[0];
    if (pending && pending.path === relative(root, path) && existsSync(path)) {
      const content = readFileSync(path, "utf8");
      const split = content.indexOf(personalMarker);
      if (split >= 0 && hash(content.slice(0, split)) === pending.hash) {
        s.run("INSERT OR REPLACE INTO vault_exports VALUES (?,?,?,?)", root, id, pending.path, pending.hash);
        s.run("DELETE FROM vault_pending WHERE vault=? AND item_id=?", root, id);
      }
    }
    const manifest = s.all("SELECT * FROM vault_exports WHERE vault=? AND item_id=?", root, id)[0];
    let personal = "\n## Мої доповнення\n\n";
    let old: string | undefined;
    if (existsSync(path)) {
      old = readFileSync(path, "utf8");
      const split = old.indexOf(personalMarker);
      if (!manifest || split < 0 || hash(old.slice(0, split)) !== manifest.hash) return "conflict";
      personal = old.slice(split + personalMarker.length);
      if (old.slice(0, split) === generated) return "unchanged";
    }
    const content = generated + personalMarker + personal;
    const temp = join(dirname(path), `.media-reflection-${randomUUID()}.tmp`);
    try {
      writeFileSync(temp, content, { mode: 0o600, flag: "wx" });
      // Recheck immediately before replacing a file edited while the export was rendering.
      securePath(root, path);
      if (existsSync(path) && (old === undefined || readFileSync(path, "utf8") !== old)) return "conflict";
      s.run(
        "INSERT OR REPLACE INTO vault_pending VALUES (?,?,?,?)",
        root,
        id,
        relative(root, path),
        hash(generated),
      );
      renameSync(temp, path);
      s.run(
        "INSERT OR REPLACE INTO vault_exports VALUES (?,?,?,?)",
        root,
        id,
        relative(root, path),
        hash(generated),
      );
      s.run("DELETE FROM vault_pending WHERE vault=? AND item_id=?", root, id);
    } finally {
      if (existsSync(temp)) unlinkSync(temp);
    }
    return old === undefined ? "created" : "updated";
  }
  for (const item of s.items()) {
    const manifest = s.all("SELECT * FROM vault_exports WHERE vault=? AND item_id=?", root, item.id)[0];
    const filename = `${safeName(item.title)} — ${item.id}.md`;
    const path = manifest ? resolve(root, manifest.path) : join(materials, filename);
    // A manifest is not allowed to redirect writes outside this app's materials folder.
    if (relative(materials, path).startsWith("..") || dirname(path) !== materials)
      throw Error("Некоректний шлях у manifest експорту.");
    const result = write(item.id, path, renderNote(s, item.id, coverFor(item)));
    if (result === "conflict") report.conflicts.push(item.title);
    else report[result]++;
    if (existsSync(path))
      links.set(item.id, `[[Матеріали/${label(path.slice(materials.length + 1, -3))}|${label(item.title)}]]`);
  }
  // Items deleted in the bot: drop their notes unless they were edited by hand.
  const live = new Set(s.items().map((i) => i.id));
  for (const row of s.all("SELECT * FROM vault_exports WHERE vault=? AND substr(item_id,1,2)<>'__'", root)) {
    if (live.has(row.item_id)) continue;
    const path = resolve(root, row.path);
    if (dirname(path) !== materials) continue;
    let removed = !existsSync(path);
    if (!removed) {
      securePath(root, path);
      const content = readFileSync(path, "utf8");
      const split = content.indexOf(personalMarker);
      const personal = split < 0 ? "" : content.slice(split + personalMarker.length);
      removed =
        split >= 0 &&
        hash(content.slice(0, split)) === row.hash &&
        !personal.replace("## Мої доповнення", "").trim();
      if (removed) {
        unlinkSync(path);
        report.removed++;
      } else report.kept.push(basename(path, ".md"));
    }
    if (removed && existsSync(covers))
      for (const file of readdirSync(covers))
        if (file.startsWith(`${row.item_id}.`)) unlinkSync(join(covers, file));
    s.run("DELETE FROM vault_exports WHERE vault=? AND item_id=?", root, row.item_id);
  }
  const rows = s.items().filter((i) => links.has(i.id));
  const open = new Set(s.unreflected().map((i) => i.id));
  const sections = [
    ["Останні додавання", rows.slice(0, 15)],
    ["На потім", rows.filter((i) => i.status === "saved")],
    ["Улюблене", rows.filter((i) => i.reaction === "loved")],
    ["Сподобалося", rows.filter((i) => i.reaction === "positive")],
    ["Ресурси", rows.filter((i) => i.type === "resource")],
    ["Без вражень", rows.filter((i) => open.has(i.id))],
  ] as const;
  // Month and year reviews; a past month that did not change is left as is.
  const { months, years } = periods(s);
  const summaryLinks: string[] = [];
  for (const period of [...years, ...months].sort().reverse()) {
    const r = review(s, period, (i) => links.get(i.id) ?? `«${label(displayTitle(i))}»`);
    if (!r) continue;
    mkdirSync(summaries, { recursive: true, mode: 0o700 });
    const result = write(`__review:${period}`, join(summaries, `${period}.md`), reviewMarkdown(r));
    if (result === "conflict") report.conflicts.push(`Підсумки/${period}`);
    summaryLinks.push(`[[Підсумки/${period}|${periodTitle(period)}]]`);
  }
  const overview =
    "# Медіатека\n\nОновлюється командою «Експорт» у боті.\n\n" +
    (summaryLinks.length ? `Підсумки: ${summaryLinks.join(" · ")}\n\n` : "") +
    sections
      .map(
        ([title, items]) =>
          `## ${title}\n\n${items.length ? items.map((i) => `- ${links.get(i.id)} · ${types[i.type] ?? i.type} · ${localDate(new Date(i.created_at))}`).join("\n") : "Поки порожньо."}`,
      )
      .join("\n\n") +
    "\n\n";
  report.overviewConflict = write("__overview__", join(library, "Медіатека.md"), overview) === "conflict";
  return report;
}
