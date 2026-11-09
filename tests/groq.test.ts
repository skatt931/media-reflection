import { test } from "node:test";
import assert from "node:assert/strict";
import { createGroq } from "../src/groq.ts";
test("Groq request uses strict output, bounded context and validates returned suggestions", async () => {
  const requests: any[] = [];
  const transport: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push(body);
    const asking = body.response_format.json_schema.name === "media_question";
    return Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify(
              asking
                ? { angle: "про нудьгу", question: "  Коли востаннє ти навмисно понудьгував?  " }
                : {
                    tags: ["Тема", "тема", "Друге", "Третє", "4", "5", "6", "Зайве"],
                    type: "book",
                  },
            ),
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
  const enrichment = requests.find((r) => r.response_format.json_schema.name === "media_enrichment");
  assert.equal(enrichment.model, "openai/gpt-oss-120b");
  assert.equal(enrichment.response_format.json_schema.strict, true);
  assert.ok(!("question" in enrichment.response_format.json_schema.schema.properties));
  const context = JSON.parse(enrichment.messages[1].content);
  assert.equal(context.title.length, 300);
  assert.equal(context.notes.length, 3);
  assert.equal(context.notes[2].length, 1000);
  assert.deepEqual(result?.tags, ["тема", "друге", "третє", "4", "5", "6"]);
  assert.equal(result?.question, "Коли востаннє ти навмисно понудьгував?");
});
test("follow-up question sees the material and the user's answers, and is skipped when not allowed", async () => {
  const requests: any[] = [];
  const transport: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push(body);
    const asking = body.response_format.json_schema.name === "media_question";
    return Response.json({
      choices: [
        {
          message: {
            content: JSON.stringify(
              asking ? { angle: "a", question: "Питання?" } : { tags: [], type: null, summary: null },
            ),
          },
        },
      ],
    });
  };
  const ai = createGroq("test-key", undefined, transport)!;
  const base = {
    title: "Подкаст про нудьгу",
    type: "podcast",
    creator: "Автор",
    summary: "Про користь нудьги.",
    description: "Опис епізоду",
    notes: ["Нудьга потрібна для творчості"],
  };
  const result = await ai(base);
  const question = requests.find((r) => r.response_format.json_schema.name === "media_question");
  assert.equal(result?.question, "Питання?");
  assert.deepEqual(JSON.parse(question.messages[1].content), {
    title: "Подкаст про нудьгу",
    type: "podcast",
    creator: "Автор",
    source: null,
    summary: "Про користь нудьги.",
    description: "Опис епізоду",
    notes: ["Нудьга потрібна для творчості"],
  });
  assert.ok(question.temperature > 0.2);

  requests.length = 0;
  assert.equal((await ai({ ...base, allowQuestion: false }))?.question, null);
  assert.equal((await ai({ ...base, notes: [] }))?.question, null);
  assert.ok(requests.every((r) => r.response_format.json_schema.name === "media_enrichment"));
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
