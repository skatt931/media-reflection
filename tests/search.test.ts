import { test } from "node:test";
import assert from "node:assert/strict";
import { Store } from "../src/store.ts";
import { createSearch, retrieve } from "../src/search.ts";
test("expanded names and filters find actual media; ranking respects own reactions", () => {
  const s = new Store(":memory:");
  const a = s.capture(1, "Witcher interview");
  const b = s.capture(2, "Відьмак огляд");
  s.edit(a, { type: "video", reaction: "positive" });
  s.edit(b, { type: "article", reaction: "negative" });
  const plan = {
    terms: ["Відьмак", "Witcher"],
    types: ["video"],
    reaction: null,
    status: null,
    from: null,
    to: null,
    best: true,
    limit: 5,
  };
  assert.deepEqual(
    retrieve(s, plan).map((i) => i.id),
    [a],
  );
  s.close();
});
test("❤️ counts as liked in filters and ranks above 👍", () => {
  const s = new Store(":memory:");
  const good = s.capture(1, "Відьмак добре");
  const loved = s.capture(2, "Відьмак найкраще");
  const meh = s.capture(3, "Відьмак так собі");
  s.edit(good, { reaction: "positive" });
  s.edit(loved, { reaction: "loved" });
  s.edit(meh, { reaction: "mixed" });
  const plan = {
    terms: ["Відьмак"],
    types: [],
    reaction: null,
    status: null,
    from: null,
    to: null,
    best: true,
    limit: 5,
  };
  assert.deepEqual(
    retrieve(s, plan).map((i) => i.id),
    [loved, good, meh],
  );
  assert.deepEqual(
    retrieve(s, { ...plan, reaction: "positive" }).map((i) => i.id),
    [loved, good],
  );
  assert.deepEqual(
    retrieve(s, { ...plan, reaction: "loved" }).map((i) => i.id),
    [loved],
  );
  s.close();
});
test("natural search uses prior query, limits snippets and rejects invented references", async () => {
  const s = new Store(":memory:");
  const id = s.capture(1, "Відьмак");
  s.edit(id, { summary: "Про Witcher", type: "video" });
  s.addReflection(2, id, "Текст ".repeat(600));
  const requests: any[] = [];
  const request = async (name: string, _instruction: string, input: any) => {
    requests.push({ name, input });
    return name === "library_query"
      ? {
          terms: ["Witcher", "Відьмак"],
          types: ["video"],
          reaction: null,
          status: null,
          from: null,
          to: null,
          best: false,
          limit: 5,
        }
      : { text: "Знайшов відео.", ids: ["invented"] };
  };
  const ask = createSearch(s, request);
  const result = await ask("А тільки відео?", ["Чи є щось про Відьмака?"]);
  assert.deepEqual(result.ids, [id]);
  assert.deepEqual(requests[0].input.history, ["Чи є щось про Відьмака?"]);
  assert.ok(JSON.stringify(requests[1].input).length < 3000);
  assert.ok(!JSON.stringify(requests[1].input).includes("TELEGRAM"));
  s.close();
});
test("query API outage falls back to local results without mutating the library", async () => {
  const s = new Store(":memory:");
  const id = s.capture(1, "Blender освітлення");
  const ask = createSearch(s, async () => null);
  const result = await ask("Blender", []);
  assert.deepEqual(result.ids, [id]);
  assert.equal(s.snapshot().captures.length, 1);
  s.close();
});
test("general saved-content question does not mean to-watch status or unknown type", async () => {
  const s = new Store(":memory:");
  const id = s.capture(1, "Відьмак: розбір персонажів");
  s.edit(id, { type: "video" });
  const request = async (name: string) =>
    name === "library_query"
      ? {
          best: false,
          from: null,
          to: null,
          limit: 5,
          reaction: null,
          status: "saved",
          terms: ["Witcher", "Відьмак"],
          types: ["unknown"],
        }
      : { text: "Знайшов.", ids: [id] };
  const result = await createSearch(s, request)("Чи зберігав я щось про Witcher?", []);
  assert.equal(result.plan.status, null);
  assert.deepEqual(result.plan.types, []);
  assert.deepEqual(result.ids, [id]);
  s.close();
});
