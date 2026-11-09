import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Store } from "../src/store.ts";
import { JournalStore, exportIdeas, ideaExportName, journalSchemaVersion } from "../src/journal.ts";
import { handle, commands } from "../src/bot.ts";
import { localDate } from "../src/fields.ts";

const OWNER = 42;
let counter = 100;
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
    const id = out?.edit?.id ?? out?.react ?? ++next;
    sent.push({ id, text, keyboard, out });
    return id;
  };
  const services = { journal, transcribe };
  const say = (text: string | null, extra?: object) => {
    const u = message(text, extra);
    return handle(s, u, OWNER, send, undefined, services).then(() => u.update_id);
  };
  const tap = (data: string, messageId: number) =>
    handle(s, press(data, messageId), OWNER, send, undefined, services);
  const buttons = (m: { keyboard?: any }) =>
    (m.keyboard?.inline_keyboard ?? []).flat().map((b: any) => b.callback_data as string);
  return { s, journal, sent, say, tap, buttons, send };
}

function withFolder(run: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), "ideas-"));
  try {
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("/idea text saves at once and answers with a reaction on the message, not a new message", async () => {
  const { s, journal, sent, say } = setup();
  const update = await say("/idea Зробити нотатки голосом");
  const ideas = journal.all("SELECT * FROM ideas");
  assert.equal(ideas.length, 1);
  assert.equal(ideas[0].body, "Зробити нотатки голосом");
  assert.equal(ideas[0].source, "text");
  assert.equal(ideas[0].idea_date, localDate());
  assert.match(ideas[0].idea_time, /^\d\d:\d\d$/);
  assert.equal(ideas[0].update_id, update);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].text, "✓");
  assert.equal(sent[0].out.react, update);
  assert.equal(s.items().length, 0);
  assert.equal(s.context(), null);
});

test("a bare /idea waits for exactly one message, which becomes the idea", async () => {
  const { s, journal, sent, say } = setup();
  await say("/idea");
  assert.match(sent.at(-1)!.text, /Надішли ідею/);
  assert.equal(s.context().mode, "idea");
  await say("Ідея з посиланням https://example.com теж лишається ідеєю");
  assert.equal(journal.ideaCount(), 1);
  assert.equal(s.items().length, 0);
  assert.equal(s.context(), null);
  assert.equal(sent.at(-1)!.text, "✓");

  await say("Тепер це вже звичайний текст");
  assert.equal(journal.ideaCount(), 1);
  assert.equal(s.items().length, 1);
});

test("commands and menu buttons after a bare /idea do not become the idea", async () => {
  const { s, journal, say } = setup();
  await say("/idea");
  await say("Скасувати");
  assert.equal(s.context(), null);
  await say("/idea");
  await say("/list");
  await say("Бібліотека");
  assert.equal(journal.ideaCount(), 0);
});

test("a voice idea is transcribed at once, shown, saved as voice and reacted to", async () => {
  const calls: string[] = [];
  const { journal, sent, say } = setup(async (id) => (calls.push(id), "Ідея голосом"));
  await say("/idea");
  const update = await say(null, { voice: { file_id: "v1", file_size: 1000 } });
  assert.deepEqual(calls, ["v1"]);
  const idea = journal.all("SELECT * FROM ideas")[0];
  assert.equal(idea.body, "Ідея голосом");
  assert.equal(idea.source, "voice");
  assert.match(sent.at(-2)!.text, /^🎤 Ідея голосом/);
  assert.equal(sent.at(-1)!.out.react, update);
});

test("a voice note outside the idea mode is still a library entry, not an idea", async () => {
  const { s, journal, say } = setup(async () => "Книга «Атомні звички»");
  await say(null, { voice: { file_id: "v1", file_size: 1000 } });
  assert.equal(journal.ideaCount(), 0);
  assert.equal(s.items().length, 1);
});

test("a failed transcription keeps the idea mode and saves nothing; without Groq nothing is sent anywhere", async () => {
  const failing = setup(async () => null);
  await failing.say("/idea");
  await failing.say(null, { voice: { file_id: "v1", file_size: 1000 } });
  assert.equal(failing.journal.ideaCount(), 0);
  assert.equal(failing.s.context().mode, "idea");
  assert.match(failing.sent.at(-1)!.text, /Не вдалося розпізнати/);

  const bare = setup();
  await bare.say("/idea");
  await bare.say(null, { voice: { file_id: "v1", file_size: 1000 } });
  assert.equal(bare.journal.ideaCount(), 0);
  assert.match(bare.sent.at(-1)!.text, /потрібен Groq/);
});

test("a replayed update never saves the idea twice", () => {
  const journal = new JournalStore(":memory:");
  const idea = { body: "Текст", source: "text" as const, date: "2026-11-09", time: "10:00", update: 5 };
  assert.ok(journal.addIdea(idea));
  assert.equal(journal.addIdea(idea), null);
  assert.equal(journal.ideaCount(), 1);
});

test("ideas stay out of the library, the diary and the digest counts", async () => {
  const { s, journal, say } = setup();
  await say("/idea Одна");
  await say("/idea Дві");
  assert.equal(s.items().length, 0);
  assert.equal(s.unreflected().length, 0);
  assert.equal(journal.all("SELECT count(*) AS n FROM journal_entries")[0].n, 0);
  assert.equal(journal.lastEntryDate(), null);
});

test("/ideas pages from the newest idea with arrows that wrap around", async () => {
  const { sent, say, tap, buttons } = setup();
  await say("/idea Перша");
  await say("/idea Друга");
  await say("/idea Третя");
  await say("/ideas");
  const card = sent.at(-1)!;
  assert.match(card.text, /^Ідеї · 1\/3\n\d\d\.\d\d\.\d\d \d\d:\d\d\n\nТретя$/);
  const [left, right] = buttons(card);
  await tap(right, card.id);
  assert.match(sent.at(-1)!.text, /^Ідеї · 2\/3[\s\S]*Друга$/);
  assert.equal(sent.at(-1)!.out.edit.id, card.id);
  await tap(buttons(sent.at(-1)!)[1], card.id);
  assert.match(sent.at(-1)!.text, /^Ідеї · 3\/3[\s\S]*Перша$/);
  await tap(buttons(sent.at(-1)!)[1], card.id);
  assert.match(sent.at(-1)!.text, /^Ідеї · 1\/3[\s\S]*Третя$/);
  await tap(left, card.id);
  assert.match(sent.at(-1)!.text, /^Ідеї · 3\/3[\s\S]*Перша$/);
});

test("a single idea has no arrows, a voice idea is marked, an empty list says so", async () => {
  const { sent, say, buttons } = setup(async () => "Голосом");
  await say("/ideas");
  assert.match(sent.at(-1)!.text, /Ідей поки немає/);
  await say("/idea");
  await say(null, { voice: { file_id: "v", file_size: 1 } });
  await say("/ideas");
  assert.match(sent.at(-1)!.text, /^Ідеї · 1\/1\n\d\d\.\d\d\.\d\d \d\d:\d\d 🎤\n\nГолосом$/);
  assert.deepEqual(
    buttons(sent.at(-1)!).map((b: string) => b.split(":").slice(0, 2).join(":")),
    ["idea:done"],
  );
});

test("an idea is resolved with one tap, not deleted, and the next older one is shown", async () => {
  const { journal, sent, say, tap, buttons } = setup();
  await say("/idea Стара");
  await say("/idea Нова");
  await say("/ideas");
  const card = sent.at(-1)!;
  // No delete anywhere on the card.
  assert.ok(buttons(card).every((b: string) => !/del|rm/.test(b)));
  const notice = await tap(
    buttons(card).find((b: string) => b.startsWith("idea:done:"))!,
    card.id,
  );
  assert.equal(notice, "Вирішено");
  assert.equal(journal.all("SELECT count(*) AS n FROM ideas")[0].n, 2);
  assert.match(sent.at(-1)!.text, /^Ідеї · 1\/1[\s\S]*Стара$/);
  assert.ok(buttons(sent.at(-1)!).includes("idea:list:resolved"));
  assert.match(sent.at(-1)!.keyboard.inline_keyboard.flat().at(-1).text, /^Вирішені \(1\)$/);

  // The last open idea resolved: the list says so and still offers the resolved ones.
  await tap(
    buttons(sent.at(-1)!).find((b: string) => b.startsWith("idea:done:"))!,
    card.id,
  );
  assert.equal(sent.at(-1)!.text, "Усі ідеї вирішені.");
  assert.deepEqual(buttons(sent.at(-1)!), ["idea:list:resolved"]);
  await say("/ideas");
  assert.equal(sent.at(-1)!.text, "Усі ідеї вирішені.");
});

test("resolved ideas are listed apart, the most recently resolved first, and can be brought back", async () => {
  const { journal, sent, say, tap, buttons } = setup();
  await say("/idea Перша");
  await say("/idea Друга");
  await say("/idea Третя");
  const [first, second, third] = journal.ideaIds().reverse();
  journal.setIdeaResolved(first, new Date("2026-11-01T10:00:00Z"));
  journal.setIdeaResolved(second, new Date("2026-11-05T10:00:00Z"));
  await say("/ideas");
  const open = sent.at(-1)!;
  assert.match(open.text, /^Ідеї · 1\/1[\s\S]*Третя$/);
  await tap("idea:list:resolved", open.id);
  assert.match(sent.at(-1)!.text, /^Вирішені · 1\/2[\s\S]*Друга$/);
  const arrows = buttons(sent.at(-1)!);
  await tap(arrows[1], open.id);
  assert.match(sent.at(-1)!.text, /^Вирішені · 2\/2[\s\S]*Перша$/);
  await tap(buttons(sent.at(-1)!)[1], open.id);
  assert.match(sent.at(-1)!.text, /^Вирішені · 1\/2[\s\S]*Друга$/);

  const undo = buttons(sent.at(-1)!).find((b: string) => b.startsWith("idea:undo:"))!;
  const notice = await tap(undo, open.id);
  assert.equal(notice, "Повернено");
  assert.equal(journal.idea(second).resolved_at, null);
  assert.match(sent.at(-1)!.text, /^Ідеї · \d\/2[\s\S]*Друга$/);

  await tap("idea:list:open", open.id);
  assert.match(sent.at(-1)!.text, /^Ідеї · 1\/2[\s\S]*Третя$/);
  // From a resolved card there is a way back to the open list.
  await tap(`idea:open:${first}`, open.id);
  assert.ok(buttons(sent.at(-1)!).includes("idea:list:open"));
});

test("a stale button for a missing idea does not crash", async () => {
  const { journal, sent, say, tap } = setup();
  await say("/idea Одна");
  await tap("idea:done:999", 7);
  assert.match(sent.at(-1)!.text, /вже немає/);
  await tap("idea:undo:999", 7);
  assert.match(sent.at(-1)!.text, /вже немає/);
  await tap("idea:open:999", 7);
  assert.match(sent.at(-1)!.text, /Одна/);
  // A live idea cannot be deleted, even by a stale or forged button.
  await tap("idea:rm:1", 7);
  await tap("idea:rmyes:1", 7);
  await tap("idea:del:1", 7);
  assert.equal(journal.ideaCount(), 1);
});

test("a resolved idea is deleted only after a confirmation; a live one never", async () => {
  const { journal, sent, say, tap, buttons } = setup();
  await say("/idea Випадкова");
  await say("/idea Жива");
  const [slip, live] = journal.ideaIds().reverse();
  assert.equal(journal.deleteResolvedIdea(live), false);
  journal.setIdeaResolved(slip, new Date("2026-11-05T10:00:00Z"));
  await say("/ideas");
  const open = sent.at(-1)!;
  // The open card offers no delete; resolving comes first.
  assert.ok(buttons(open).every((b: string) => !b.startsWith("idea:rm")));
  await tap("idea:list:resolved", open.id);
  assert.ok(buttons(sent.at(-1)!).includes(`idea:rm:${slip}`));

  // «Видалити» only asks; nothing is lost yet, and «Ні» goes back to the card.
  await tap(`idea:rm:${slip}`, open.id);
  assert.match(sent.at(-1)!.text, /^Видалити назавжди\?[\s\S]*Випадкова$/);
  assert.deepEqual(buttons(sent.at(-1)!), [`idea:rmyes:${slip}`, `idea:open:${slip}`]);
  assert.equal(journal.ideaCount(), 2);
  await tap(`idea:open:${slip}`, open.id);
  assert.match(sent.at(-1)!.text, /^Вирішені · 1\/1[\s\S]*Випадкова$/);

  await tap(`idea:rm:${slip}`, open.id);
  const notice = await tap(`idea:rmyes:${slip}`, open.id);
  assert.equal(notice, "Видалено");
  assert.equal(journal.idea(slip), undefined);
  assert.equal(journal.ideaCount(), 1);
  // No resolved ideas are left, so the open list is shown.
  assert.match(sent.at(-1)!.text, /Жива/);

  // A second tap on the same confirmation finds nothing and does not crash.
  await tap(`idea:rmyes:${slip}`, open.id);
  assert.match(sent.at(-1)!.text, /вже немає/);
  assert.equal(journal.ideaCount(), 1);
});

test("without the journal database /idea and /ideas say so and save nothing", async () => {
  const s = new Store(":memory:");
  const sent: string[] = [];
  const send = async (t: string) => (sent.push(t), 7);
  await handle(s, message("/idea щось"), OWNER, send);
  await handle(s, message("/ideas"), OWNER, send);
  assert.deepEqual(sent, ["Ідеї не підключено.", "Ідеї не підключено."]);
  assert.equal(s.items().length, 0);
});

test("only the owner can write ideas", async () => {
  const { journal, sent } = setup();
  const s = new Store(":memory:");
  const stranger = {
    ...message("/idea чужа"),
    message: { ...message("/idea чужа").message, from: { id: 1 } },
  };
  await handle(s, stranger, OWNER, async () => 1, undefined, { journal });
  assert.equal(journal.ideaCount(), 0);
  assert.equal(sent.length, 0);
});

test("the command menu and help know the ideas", async () => {
  assert.ok(commands.some((c) => c.command === "idea"));
  assert.ok(commands.some((c) => c.command === "ideas"));
  const { sent, tap } = setup();
  await tap("help:ideas", 5);
  assert.match(sent.at(-1)!.text, /^Ідеї\n\n\/idea текст/);
});

test("the journal database migrates to the ideas table without touching the diary", () => {
  withFolder((dir) => {
    const path = join(dir, "journal.sqlite");
    const old = new JournalStore(path);
    old.add({ date: "2026-11-05", body: "Запис", source: "bot" });
    old.db.exec("DROP TABLE ideas; PRAGMA user_version=3");
    old.close();
    const store = new JournalStore(path);
    assert.equal(Number(store.all("PRAGMA user_version")[0].user_version), journalSchemaVersion);
    assert.equal(store.all("SELECT body FROM journal_entries")[0].body, "Запис");
    assert.equal(store.ideaCount(), 0);
    store.close();
    new DatabaseSync(path).close();
  });
});

test("idea file names carry the local date and minute without a colon", () => {
  assert.equal(ideaExportName("2026-11-05", "14:30"), "05.11.26 14-30.md");
  assert.equal(ideaExportName("2026-11-05", "14:30", 2), "05.11.26 14-30 (2).md");
});

test("export writes one note per idea, text as is, and never rewrites a file", () => {
  withFolder((dir) => {
    const store = new JournalStore(":memory:");
    const out = join(dir, "ideas-export");
    store.addIdea({ body: "Перша\n\nз абзацом", source: "text", date: "2026-11-05", time: "14:30" });
    store.addIdea({ body: "Друга тієї ж хвилини", source: "voice", date: "2026-11-05", time: "14:30" });
    const report = exportIdeas(store, out);
    assert.deepEqual(report.written, ["05.11.26 14-30.md", "05.11.26 14-30 (2).md"]);
    assert.equal(readFileSync(join(out, "05.11.26 14-30.md"), "utf8"), "Перша\n\nз абзацом");

    writeFileSync(join(out, "05.11.26 14-30.md"), "Змінено руками");
    const again = exportIdeas(store, out);
    assert.deepEqual([again.named, again.written], [[], []]);
    assert.equal(readFileSync(join(out, "05.11.26 14-30.md"), "utf8"), "Змінено руками");
    store.close();
  });
});

test("dry run of the ideas export names and writes nothing", () => {
  withFolder((dir) => {
    const store = new JournalStore(":memory:");
    store.addIdea({ body: "Ідея", source: "text", date: "2026-11-05", time: "09:05" });
    const out = join(dir, "ideas-export");
    assert.deepEqual(exportIdeas(store, out, true).written, ["05.11.26 09-05.md"]);
    assert.equal(existsSync(out), false);
    assert.equal(store.all("SELECT export_name FROM ideas")[0].export_name, null);
    store.close();
  });
});

test("a deleted idea's file is retired and its name is not given again", () => {
  withFolder((dir) => {
    const store = new JournalStore(":memory:");
    const id = store.addIdea({ body: "Стара", source: "text", date: "2026-11-05", time: "14:30" })!;
    exportIdeas(store, dir);
    store.removeIdea(id);
    store.addIdea({ body: "Нова", source: "text", date: "2026-11-05", time: "14:30" });
    const report = exportIdeas(store, dir);
    assert.deepEqual(report.retired, ["05.11.26 14-30.md"]);
    assert.deepEqual(report.written, ["05.11.26 14-30 (2).md"]);
    assert.equal(readFileSync(join(dir, ".deleted", "05.11.26 14-30.md"), "utf8"), "Стара");
    assert.deepEqual(
      readdirSync(dir).filter((n) => n.endsWith(".md")),
      ["05.11.26 14-30 (2).md"],
    );
    store.close();
  });
});
