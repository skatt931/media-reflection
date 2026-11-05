import { Store } from "../src/store.ts";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
process.umask(0o077);
const store = new Store(process.env.DB_PATH ?? "./data/media.sqlite");
try {
  const snapshot = store.snapshot();
  const path = resolve("exports", new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(path, { recursive: true, mode: 0o700 });
  writeFileSync(join(path, "library.json"), JSON.stringify(snapshot, null, 2), { mode: 0o600 });
  for (const item of snapshot.items) {
    const notes = snapshot.reflections.filter((r) => r.item_id === item.id);
    const frontmatter = Object.entries({
      schema_version: 3,
      id: item.id,
      url: item.url,
      title: item.title,
      type: item.type,
      source: item.source,
      creator: item.creator,
      status: item.status,
      consumed_on: item.consumed_on,
      reaction: item.reaction,
      tags: item.tags,
      created_at: item.created_at,
      summary: item.summary ?? null,
      entities: item.entities ?? [],
      date_source: item.date_source ?? null,
    })
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`)
      .join("\n");
    const enrichment = snapshot.ai_enrichments
      .filter((r) => r.item_id === item.id)
      .map((r) => r.payload)
      .filter(Boolean);
    const aiSection = enrichment.length
      ? "\n\n## AI-дані (не власні враження)\n\n" + enrichment.map((e) => JSON.stringify(e)).join("\n\n")
      : "";
    const body = notes.map((r) => `## ${r.created_at}\n\n${r.body}`).join("\n\n");
    writeFileSync(
      join(path, `${item.id}.md`),
      `---\n${frontmatter}\n---\n\n# ${item.title}\n\n${body || "Рефлексії ще немає."}${aiSection}\n`,
      { mode: 0o600 },
    );
  }
  console.log(`Експортовано ${snapshot.items.length} записів: ${path}`);
} finally {
  store.close();
}
