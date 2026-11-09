import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { send } from "../api.ts";
import { today } from "../format.ts";
import { useAction, useBack, useDraft } from "../hooks.ts";
import { Icon } from "../icons.tsx";
import { BackBar, Problem } from "../parts.tsx";
import { entryHash, goBack, replaceHash, sectionHash } from "../router.ts";
import { confirmAction, guardClosing } from "../telegram.ts";

export const DIARY_LIMIT = 100_000;

// A new diary entry. The text is kept as a draft on this device until it is saved.
export function Compose() {
  const [body, setBody, clearBody] = useDraft("draft:diary");
  const [date, setDate] = useState(today);
  const { busy, failed, run } = useAction();
  const field = useRef<HTMLTextAreaElement>(null);
  const dirty = body.trim().length > 0;

  const leave = useCallback(async () => {
    if (dirty && !(await confirmAction("Вийти без збереження? Текст лишиться чернеткою на цьому пристрої.")))
      return;
    goBack(sectionHash("diary"));
  }, [dirty]);
  useBack(true, leave);
  useEffect(() => {
    guardClosing(dirty);
    return () => guardClosing(false);
  }, [dirty]);
  useEffect(() => {
    field.current?.focus({ preventScroll: true });
  }, []);
  // The field grows with the text, so the page scrolls instead of the field.
  useLayoutEffect(() => {
    const el = field.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [body]);

  const save = async () => {
    const saved = await run(() => send<{ id: number }>("POST", "/api/diary", { date, body }));
    if (!saved) return;
    clearBody();
    guardClosing(false);
    // The entry replaces the form in the history, so "back" returns to the list, not to an empty form.
    replaceHash(entryHash(saved.id));
  };

  return (
    <>
      <main className="screen compose">
        <BackBar onBack={leave} />
        <header className="top">
          <h1>Новий запис</h1>
        </header>
        <label className="label" htmlFor="entry-date">
          Дата
        </label>
        <div className="input datefield">
          <Icon name="calendar" size={20} />
          <input
            id="entry-date"
            type="date"
            value={date}
            max={today()}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        <label className="label" htmlFor="entry-body">
          Запис
        </label>
        <textarea
          id="entry-body"
          ref={field}
          className="write serif page"
          maxLength={DIARY_LIMIT}
          value={body}
          placeholder="Що сьогодні було?"
          onChange={(e) => setBody(e.target.value)}
        />
        {failed && <Problem>Не вдалося зберегти. Текст лишився, спробуй ще раз.</Problem>}
      </main>
      <div className="openbar">
        <button className="open" disabled={!dirty || !date || busy} onClick={save}>
          {busy ? "Зберігаю…" : "Зберегти запис"}
        </button>
      </div>
    </>
  );
}
