import { test } from "node:test";
import assert from "node:assert/strict";
import {
  diaryEntry,
  diaryList,
  ideaList,
  snippet,
  wordCount,
  type DiaryRow,
  type IdeaRow,
} from "../src/miniapp/data.ts";

const diary: DiaryRow[] = [
  { id: 1, entry_date: "2026-06-25", body: "Їздив за місто, велосипед тримав добре." },
  {
    id: 2,
    entry_date: "2026-11-01",
    body: "Тиждень був насичений.\n\nУ вівторок полагодив велосипеда й  повернувся пізно.",
  },
  { id: 3, entry_date: "2026-11-01", body: "Другий запис того ж дня." },
  { id: 4, entry_date: "2026-09-14", body: "Три години в лісі без жодної мети." },
];

test("diary list: newest day first, the later record first within a day", () => {
  assert.deepEqual(
    diaryList(diary).entries.map((e) => e.id),
    [3, 2, 4, 1],
  );
});

test("diary list: excerpt is one line of text, long text is cut at a word with an ellipsis", () => {
  const { entries } = diaryList(diary);
  assert.equal(
    entries.find((e) => e.id === 2)!.excerpt,
    "Тиждень був насичений. У вівторок полагодив велосипеда й повернувся пізно.",
  );
  const long = "слово ".repeat(200).trim();
  const [cut] = diaryList([{ id: 9, entry_date: "2026-01-01", body: long }]).entries;
  assert.ok(cut.excerpt.endsWith("слово…"));
  assert.ok(cut.excerpt.length <= 245);
  assert.equal(cut.words, 200);
});

test("diary search: a word matches other endings, every word of the query must be present", () => {
  assert.deepEqual(
    diaryList(diary, "велосипед").entries.map((e) => e.id),
    [2, 1],
  );
  assert.deepEqual(
    diaryList(diary, "велосипеда вівторок").entries.map((e) => e.id),
    [2],
  );
  assert.deepEqual(
    diaryList(diary, "ВЕЛОСИПЕД").entries.map((e) => e.id),
    [2, 1],
  );
  assert.deepEqual(diaryList(diary, "парашут").entries, []);
  assert.equal(diaryList(diary, "   ").entries.length, 4);
});

test("diary search: the snippet starts near the hit and the terms are returned for highlighting", () => {
  const body = "а ".repeat(80) + "велосипед стояв біля дверей " + "б ".repeat(80);
  const text = snippet(body, ["велоси"]);
  assert.ok(text.startsWith("…"));
  assert.ok(text.includes("велосипед"));
  const result = diaryList([{ id: 1, entry_date: "2026-01-01", body }], "велосипед");
  assert.deepEqual(result.terms, ["велоси"]);
  assert.ok(result.entries[0].excerpt.includes("велосипед"));
});

test("diary entry: full text as written, neighbours in the list order", () => {
  const entry = diaryEntry(diary, 2)!;
  assert.equal(entry.body, diary[1].body);
  assert.equal(entry.words, 10);
  assert.deepEqual(entry.newer, { id: 3, date: "2026-11-01" });
  assert.deepEqual(entry.older, { id: 4, date: "2026-09-14" });
  assert.equal(diaryEntry(diary, 3)!.newer, null);
  assert.equal(diaryEntry(diary, 1)!.older, null);
  assert.equal(diaryEntry(diary, 99), null);
});

test("long queries are cut, not rejected", () => {
  assert.equal(diaryList(diary, "а".repeat(5000)).entries.length, 0);
});

const ideas: IdeaRow[] = [
  { id: 1, idea_date: "2026-11-05", idea_time: "18:44", body: "Записати підсумок тижня голосовим." },
  { id: 2, idea_date: "2026-11-07", idea_time: "09:30", body: "Купити змазку для ланцюга." },
];

test("ideas: newest first, search by words", () => {
  assert.deepEqual(
    ideaList(ideas).ideas.map((i) => i.id),
    [2, 1],
  );
  assert.deepEqual(ideaList(ideas).ideas[0], {
    id: 2,
    date: "2026-11-07",
    time: "09:30",
    body: "Купити змазку для ланцюга.",
  });
  assert.deepEqual(
    ideaList(ideas, "підсумки").ideas.map((i) => i.id),
    [1],
  );
  assert.deepEqual(ideaList(ideas, "підсумки").terms, ["підсу"]);
});

test("word count ignores extra whitespace", () => {
  assert.equal(wordCount(" a \n\n b   c "), 3);
  assert.equal(wordCount(""), 0);
});
