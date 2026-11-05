import { test } from "node:test";
import assert from "node:assert/strict";
import { createGroq } from "../src/groq.ts";
test("Groq request uses strict output, bounded context and validates returned suggestions", async () => {
  let request: any;
  const transport: typeof fetch = async (_url, init) => {
    request = JSON.parse(String(init?.body));
    return Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify({
              question: "Що зачепило?",
              tags: ["Тема", "тема", "Друге", "Третє", "Зайве"],
              type: "book",
            }),
          },
        },
      ],
    });
  };
  const ai = createGroq("test-key", "openai/gpt-oss-120b", transport)!;
  const result = await ai({
    title: "a".repeat(500),
    type: "unknown",
    notes: ["old", "one", "two", "x".repeat(2000)],
  });
  assert.equal(request.model, "openai/gpt-oss-120b");
  assert.equal(request.response_format.json_schema.strict, true);
  const context = JSON.parse(request.messages[1].content);
  assert.equal(context.title.length, 300);
  assert.equal(context.notes.length, 3);
  assert.equal(context.notes[2].length, 1000);
  assert.deepEqual(result?.tags, ["тема", "друге", "третє"]);
});
test("missing key, HTTP limit, malformed response and network failure degrade safely", async () => {
  assert.equal(createGroq(undefined), undefined);
  for (const response of [
    () => Promise.resolve(new Response("", { status: 429 })),
    () => Promise.resolve(Response.json({ choices: [{ message: { content: "bad" } }] })),
    () => Promise.reject(Error("network")),
  ]) {
    const ai = createGroq("test-key", undefined, response)!;
    assert.equal(await ai({ title: "test", type: "unknown", notes: [] }), null);
  }
});
