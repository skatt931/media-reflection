import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/store.ts";
import { JournalStore, parseDiaryDate } from "../src/journal.ts";
import { handle, weekly, diaryAutosave, commands } from "../src/bot.ts";
import { addDays, localDate } from "../src/fields.ts";

const OWNER = 42;
let counter = 0;
const message = (text: string | null, extra: object = {}) => ({
  update_id: ++counter,
  message: { message_id: counter, from: { id: OWNER }, chat: { id: OWNER, type: "private" }, text, ...extra },
});
const press = (data: string, messageId: number) => ({
  update_id: ++counter,
  callback_query: {
    from: { id: OWNER },
    data,
    message: { message_id: messageId, chat: { id: OWNER, type: "private" } },
  },
});

function setup(transcribe?: (fileId: string) => Promise<string | null>) {
  const s = new Store(":memory:");
  const journal = new JournalStore(":memory:");
  const sent: { id: number; text: string; keyboard?: any; out?: any }[] = [];
  let next = 1000;
  const send = async (text: string, keyboard?: any, out?: any) => {
    const id = out?.edit?.id ?? ++next;
    sent.push({ id, text, keyboard, out });
    return id;
  };
  const services = { journal, transcribe };
  const say = (text: string | null, extra?: object) =>
    handle(s, message(text, extra), OWNER, send, undefined, services);
  const tap = (data: string, messageId: number) =>
    handle(s, press(data, messageId), OWNER, send, undefined, services);
  const buttons = (m: { keyboard?: any }) =>
    (m.keyboard?.inline_keyboard ?? []).flat().map((b: any) => b.callback_data as string);
  return { s, journal, sent, say, tap, buttons, services, send };
}

test("parseDiaryDate takes the forms a person types and rejects the rest", () => {
  assert.equal(parseDiaryDate("5.11.26"), "2026-11-05");
  assert.equal(parseDiaryDate(" 05.11.2026 "), "2026-11-05");
  assert.equal(parseDiaryDate("2026-11-05"), "2026-11-05");
  assert.equal(parseDiaryDate("31.02.26"), null);
  assert.equal(parseDiaryDate("вчора"), null);
  assert.equal(parseDiaryDate("2026-13-01"), null);
});

test("/diary collects several messages into one entry dated today; the library is untouched", async () => {
  const { s, journal, sent, say, buttons } = setup();
  await say("/diary");
  assert.match(sent.at(-1)!.text, /Щоденник · \d\d\.\d\d\.\d\d \(сьогодні\)/);
  assert.deepEqual(buttons(sent.at(-1)!), ["diary:done", "diary:date", "diary:cancel"]);
  await say("Перша частина про день.");
  await say("Друга частина, https://example.com теж текст.");
  assert.equal(s.items().length, 0);
  assert.match(sent.at(-1)!.text, /Повідомлень: 2, символів: \d+/);
  await say("/done");
  const entries = journal.all("SELECT * FROM journal_entries");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].source, "bot");
  assert.equal(entries[0].entry_date, localDate());
  assert.equal(entries[0].body, "Перша частина про день.\n\nДруга частина, https://example.com теж текст.");
  assert.equal(journal.draft(), undefined);
  assert.equal(s.items().length, 0);
  assert.equal(s.context(), null);
  assert.match(sent.at(-1)!.text, /Збережено запис за/);
});

test("the Done button saves the entry and turns its own message into the confirmation", async () => {
  const { journal, sent, say, tap } = setup();
  await say("/diary Текст одразу з командою");
  await say("ще рядок");
  const status = sent.at(-1)!;
  await tap("diary:done", status.id);
  assert.equal(
    journal.all("SELECT body FROM journal_entries")[0].body,
    "Текст одразу з командою\n\nще рядок",
  );
  assert.equal(sent.at(-1)!.out.edit.id, status.id);
  assert.match(sent.at(-1)!.text, /Збережено запис/);
});

test("only the newest status message keeps its buttons", async () => {
  const { sent, say } = setup();
  await say("/diary");
  const first = sent.at(-1)!.id;
  await say("текст");
  const stripped = sent.find((m) => m.out?.markupOnly && m.out.edit.id === first);
  assert.ok(stripped);
  assert.equal(stripped.keyboard, undefined);
});

test("a replayed update never appends twice", () => {
  const journal = new JournalStore(":memory:");
  journal.startDraft("2026-11-05", 10);
  assert.equal(journal.appendDraft(10, "це повідомлення відкрило режим"), true);
  assert.equal(journal.appendDraft(10, "це повідомлення відкрило режим"), false);
  assert.equal(journal.appendDraft(9, "старіше"), false);
  assert.equal(journal.draft()!.body, "це повідомлення відкрило режим");
});

test("the draft survives a restart", () => {
  const dir = mkdtempSync(join(tmpdir(), "diary-"));
  try {
    let journal = new JournalStore(join(dir, "journal.sqlite"));
    journal.startDraft("2026-11-05", 1);
    journal.appendDraft(2, "частина 1");
    journal.appendDraft(3, "частина 2");
    journal.close();
    journal = new JournalStore(join(dir, "journal.sqlite"));
    assert.equal(journal.draft()!.body, "частина 1\n\nчастина 2");
    assert.equal(journal.draft()!.parts, 2);
    journal.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("the date can be yesterday, a typed date, and a future or garbled date is refused", async () => {
  const { journal, sent, say, tap, buttons } = setup();
  await say("/diary");
  let status = sent.at(-1)!;
  await tap("diary:date", status.id);
  assert.deepEqual(buttons(sent.at(-1)!), [
    "diary:setdate:today",
    "diary:setdate:yesterday",
    "diary:customdate",
    "diary:back",
  ]);
  await tap("diary:setdate:yesterday", status.id);
  assert.equal(journal.draft()!.entry_date, addDays(localDate(), -1));
  assert.match(sent.at(-1)!.text, /Щоденник · \d\d\.\d\d\.\d\d\n/);

  await tap("diary:customdate", status.id);
  await say("не дата");
  assert.match(sent.at(-1)!.text, /Не схоже на дату/);
  await say("01.01.2999");
  assert.match(sent.at(-1)!.text, /ще не настала/);
  await say("05.11.26");
  assert.equal(journal.draft()!.entry_date, "2026-11-05");
  assert.equal(journal.draft()!.body, "");
  assert.equal(sent.at(-1)!.out.edit.id, status.id);

  await say("Згадав про той день");
  await say("/done");
  const entry = journal.all("SELECT * FROM journal_entries")[0];
  assert.equal(entry.entry_date, "2026-11-05");
  assert.equal(entry.body, "Згадав про той день");
});

test("an unfinished entry is saved by itself after an hour of silence, not before", async () => {
  const { s, journal, sent, say, send } = setup();
  await say("/diary");
  await say("Забув натиснути «Готово»");
  await diaryAutosave(s, journal, send, new Date(Date.now() + 59 * 60000));
  assert.equal(journal.all("SELECT * FROM journal_entries").length, 0);
  assert.ok(journal.draft());
  await diaryAutosave(s, journal, send, new Date(Date.now() + 61 * 60000));
  assert.equal(journal.all("SELECT body FROM journal_entries")[0].body, "Забув натиснути «Готово»");
  assert.equal(journal.draft(), undefined);
  assert.equal(s.context(), null);
  assert.match(sent.at(-1)!.text, /Година без нових повідомлень/);
  assert.deepEqual(sent.at(-1)!.keyboard.inline_keyboard[0][0].callback_data.startsWith("diary:undo:"), true);
});

test("an empty draft left for an hour is dropped without a message or an entry", async () => {
  const { s, journal, sent, say, send } = setup();
  await say("/diary");
  const before = sent.length;
  await diaryAutosave(s, journal, send, new Date(Date.now() + 2 * 3600000));
  assert.equal(journal.all("SELECT * FROM journal_entries").length, 0);
  assert.equal(journal.draft(), undefined);
  assert.equal(sent.length, before);
});

test("leaving the diary keeps the text, and /diary picks it up again", async () => {
  const { s, journal, sent, say } = setup();
  await say("/diary");
  await say("Половина думки");
  await say("/cancel");
  assert.match(sent.at(-1)!.text, /не загублено/);
  assert.equal(s.context(), null);
  await say("https://example.com/page");
  assert.equal(s.items().length, 1);
  assert.equal(journal.draft()!.body, "Половина думки");
  await say("/diary");
  assert.match(sent.at(-1)!.text, /Повідомлень: 1/);
  await say("друга половина");
  await say("/done");
  assert.equal(journal.all("SELECT body FROM journal_entries")[0].body, "Половина думки\n\nдруга половина");
});

test("menu buttons and commands work while the diary is open without becoming diary text", async () => {
  const { journal, sent, say } = setup();
  await say("/diary");
  await say("текст");
  await say("/help");
  assert.match(sent.at(-1)!.text, /Сюди можна кидати/);
  assert.equal(journal.draft()!.body, "текст");
});

test("discarding the draft needs a confirmation", async () => {
  const { journal, sent, say, tap, buttons } = setup();
  await say("/diary");
  await say("не треба");
  const status = sent.at(-1)!;
  await tap("diary:cancel", status.id);
  assert.deepEqual(buttons(sent.at(-1)!), ["diary:discard", "diary:back"]);
  assert.ok(journal.draft());
  await tap("diary:back", status.id);
  assert.ok(journal.draft());
  await tap("diary:cancel", status.id);
  await tap("diary:discard", status.id);
  assert.equal(journal.draft(), undefined);
  assert.equal(journal.all("SELECT * FROM journal_entries").length, 0);
});

test("a saved entry can be removed after a confirmation; imported notes cannot", async () => {
  const { journal, sent, say, tap, buttons } = setup();
  journal.add({ date: "2026-01-01", body: "Імпортований", source: "import", sourceName: "01.01.26.md" });
  const imported = Number(journal.all("SELECT id FROM journal_entries")[0].id);
  await say("/diary");
  await say("Помилковий запис");
  await say("/done");
  const saved = sent.at(-1)!;
  const [undo] = buttons(saved);
  assert.match(undo, /^diary:undo:\d+$/);
  await tap(undo, saved.id);
  assert.match(sent.at(-1)!.text, /Видалити запис/);
  assert.equal(journal.all("SELECT * FROM journal_entries").length, 2);
  const [yes, keep] = buttons(sent.at(-1)!);
  await tap(keep, saved.id);
  assert.match(sent.at(-1)!.text, /Збережено запис/);
  assert.equal(journal.all("SELECT * FROM journal_entries").length, 2);
  await tap(undo, saved.id);
  await tap(yes, saved.id);
  assert.match(sent.at(-1)!.text, /видалено/);
  assert.deepEqual(
    journal.all("SELECT id FROM journal_entries").map((r) => Number(r.id)),
    [imported],
  );
  await tap(`diary:remove:${imported}`, saved.id);
  assert.match(sent.at(-1)!.text, /Цього запису вже немає/);
  assert.equal(journal.all("SELECT * FROM journal_entries").length, 1);
});

test("a voice note is transcribed only after the explicit choice", async () => {
  const calls: string[] = [];
  const { journal, sent, say, tap, buttons } = setup(async (fileId) => {
    calls.push(fileId);
    return "розпізнаний текст";
  });
  await say("/diary");
  await say(null, { voice: { file_id: "F1", file_size: 1000 } });
  assert.deepEqual(calls, []);
  const prompt = sent.at(-1)!;
  assert.match(prompt.text, /Groq/);
  assert.deepEqual(buttons(prompt), ["diary:voice:yes", "diary:voice:no"]);
  await tap("diary:voice:yes", prompt.id);
  assert.deepEqual(calls, ["F1"]);
  assert.equal(journal.draft()!.body, "розпізнаний текст");

  await say(null, { voice: { file_id: "F2", file_size: 1000 } });
  const second = sent.at(-1)!;
  await tap("diary:voice:no", second.id);
  assert.deepEqual(calls, ["F1"]);
  assert.equal(journal.draft()!.body, "розпізнаний текст");
  assert.match(sent.at(-1)!.text, /пропущено/);
});

test("a failed transcription keeps the choice available and adds nothing", async () => {
  let ok = false;
  const { journal, sent, say, tap } = setup(async () => (ok ? "вдалося" : null));
  await say("/diary");
  await say(null, { voice: { file_id: "F1", file_size: 1000 } });
  const prompt = sent.at(-1)!;
  const notice = await tap("diary:voice:yes", prompt.id);
  assert.match(notice!, /Не вдалося/);
  assert.equal(journal.draft()!.body, "");
  ok = true;
  await tap("diary:voice:yes", prompt.id);
  assert.equal(journal.draft()!.body, "вдалося");
});

test("without Groq a voice note in the diary is refused and never sent anywhere", async () => {
  const { journal, sent, say } = setup();
  await say("/diary");
  await say(null, { voice: { file_id: "F1", file_size: 1000 } });
  assert.match(sent.at(-1)!.text, /потрібен Groq/);
  assert.equal(journal.draft()!.body, "");
});

test("without the journal /diary says so and saves nothing", async () => {
  const s = new Store(":memory:");
  const sent: string[] = [];
  await handle(s, message("/diary"), OWNER, async (t) => (sent.push(t), 1), undefined, {});
  assert.match(sent.at(-1)!, /не підключено/);
  assert.equal(s.context(), null);
});

test("the weekly digest gets one diary line only when it is sent, with the days since the last entry", async () => {
  const s = new Store(":memory:");
  const journal = new JournalStore(":memory:");
  const sent: string[] = [];
  const send = async (t: string) => (sent.push(t), 7);
  s.capture(1, "https://example.com/a", new Date("2026-11-03T10:00:00Z"));
  journal.add({ date: "2026-11-02", body: "x", source: "import", sourceName: "02.11.26.md" });
  await weekly(s, send, new Date("2026-11-06T18:00:00Z"), "fri 18:00", journal);
  assert.match(sent[0], /\nОстанній запис щоденника — 4 дні тому\.$/);

  const bare = new Store(":memory:");
  bare.capture(1, "https://example.com/a", new Date("2026-11-03T10:00:00Z"));
  await weekly(bare, send, new Date("2026-11-06T18:00:00Z"), "fri 18:00", new JournalStore(":memory:"));
  assert.doesNotMatch(sent[1], /щоденника/);

  const quiet = new Store(":memory:");
  await weekly(quiet, send, new Date("2026-11-06T18:00:00Z"), "fri 18:00", journal);
  assert.equal(sent.length, 2);
});

test("the command menu and help know the diary", async () => {
  assert.ok(commands.some((c) => c.command === "diary"));
  const { sent, tap } = setup();
  await tap("help:diary", 5);
  assert.match(sent.at(-1)!.text, /^Щоденник\n\n\/diary/);
});
