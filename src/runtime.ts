import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Store } from "./store.ts";
import { createGroq, createJSONRequest } from "./groq.ts";
import { createSearch } from "./search.ts";
import { fetchImage, fetchMetadata } from "./metadata.ts";
import { createTranscriber } from "./voice.ts";
import { buildExport } from "./export-package.ts";
import type { Services } from "./bot.ts";

export function createRuntime(
  store: Store,
  env: NodeJS.ProcessEnv = process.env,
  transport: typeof fetch = fetch,
) {
  const services: Services = {
    ask: createSearch(store, createJSONRequest(env.GROQ_API_KEY, env.GROQ_MODEL, transport)),
    metadata: (url) => fetchMetadata(url, transport),
    cover: async (id, url) => {
      if (!store.coverDir) return null;
      const image = await fetchImage(url, transport);
      if (!image) return null;
      mkdirSync(store.coverDir, { recursive: true, mode: 0o700 });
      const name = `${id}.${image.ext}`;
      writeFileSync(join(store.coverDir, name), image.bytes, { mode: 0o600 });
      return name;
    },
    transcribe: createTranscriber(
      env.GROQ_API_KEY,
      env.TELEGRAM_BOT_TOKEN,
      env.VOICE_LANGUAGE ?? "uk",
      transport,
    ),
    export: () => buildExport(store),
  };
  return { ai: createGroq(env.GROQ_API_KEY, env.GROQ_MODEL, transport), services };
}
