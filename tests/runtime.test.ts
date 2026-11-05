import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.ts";
import { handle } from "../src/bot.ts";
import { createRuntime } from "../src/runtime.ts";
test("production runtime connects Groq search, enrichment and public provider metadata", async () => {
  const s = new Store(":memory:");
  const id = s.capture(1, "Відьмак");
  s.edit(id, { type: "video" });
  const stages: string[] = [];
  const transport: typeof fetch = async (url, init) => {
    if (String(url).startsWith("https://www.youtube.com/oembed")) {
      stages.push("oembed");
      return Response.json({ title: "Світло у Blender", author_name: "Автор" });
    }
    const body = JSON.parse(String(init?.body));
    const stage = body.response_format.json_schema.name;
    stages.push(stage);
    const result =
      stage === "library_query"
        ? {
            terms: ["Відьмак"],
            types: [],
            reaction: null,
            status: null,
            from: null,
            to: null,
            best: false,
            limit: 5,
          }
        : stage === "library_answer"
          ? { text: "Знайшов.", ids: [id] }
          : {
              question: null,
              type: "video",
              tags: ["blender"],
              entities: ["Blender"],
              summary: "Про світло",
              title: null,
              creator: null,
            };
    return Response.json({ choices: [{ message: { content: JSON.stringify(result) } }] });
  };
  const runtime = createRuntime(s, { GROQ_API_KEY: "test-key" }, transport);
  let n = 100;
  const send = async () => n++;
  const message = (id: number, text: string) => ({
    update_id: id,
    message: { message_id: id, from: { id: 42 }, chat: { id: 42, type: "private" }, text },
  });
  await handle(s, message(2, "/ask Відьмак"), 42, send, runtime.ai, runtime.services);
  await handle(s, message(3, "https://youtu.be/abcdefgh"), 42, send, runtime.ai, runtime.services);
  assert.ok(stages.includes("library_query"));
  assert.ok(stages.includes("library_answer"));
  assert.ok(stages.includes("oembed"));
  assert.ok(stages.includes("media_enrichment"));
  assert.equal(s.items().find((i) => i.url)?.title, "Світло у Blender");
  s.close();
});
