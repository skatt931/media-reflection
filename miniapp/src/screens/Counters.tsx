import { useCallback, useEffect, useRef, useState } from "react";
import type { CounterDetail, CounterItem, CounterList } from "../../../src/miniapp/counter-types.ts";
import { send } from "../api.ts";
import { useAction, useResource } from "../hooks.ts";
import { daysLabel } from "../format.ts";
import { Icon } from "../icons.tsx";
import { CounterSheet, NewCounter } from "./CounterSheets.tsx";

const OPEN_KEY = "counters:open";
const MOMENT_MS = 1400;

const remembered = () => {
  try {
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
};

const figure = (c: CounterItem) => (c.days === null ? "—" : String(c.days));
const spoken = (c: CounterItem) => `${c.name} — ${c.days === null ? "ще немає відміток" : daysLabel(c.days)}`;

// The quiet row under the title of «Ідеї»: names with numbers in one line, opened in place into a list. Nothing
// here asks for attention; it is only there when the app is open.
export function Counters() {
  const list = useResource<CounterList>("/api/counters");
  const [open, setOpen] = useState(remembered);
  const [sheet, setSheet] = useState<string | "new" | null>(null);
  const [moment, setMoment] = useState<string | null>(null);
  const action = useAction();
  const latest = useRef(list.data);
  latest.current = list.data;
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    try {
      localStorage.setItem(OPEN_KEY, next ? "1" : "0");
    } catch {
      // No storage: the row still opens, it just starts closed next time.
    }
  };

  // What a write answered replaces that counter in the list; the list is then checked against the server.
  const patch = useCallback(
    (detail: CounterDetail | null, id?: string) => {
      const data = latest.current;
      if (data && detail)
        list.set({ ...data, counters: data.counters.map((c) => (c.id === detail.id ? detail : c)) });
      else if (data && id) list.set({ ...data, counters: data.counters.filter((c) => c.id !== id) });
      list.reload();
    },
    [list],
  );

  const tick = (c: CounterItem) =>
    action.run(async () => {
      const today = latest.current?.today;
      if (!today) return;
      const detail = await send<CounterDetail>(
        "POST",
        `/api/counters/${c.id}/${c.markedToday ? "unmark" : "mark"}`,
        {
          date: today,
        },
      );
      patch(detail);
      if (!c.markedToday) {
        setMoment(c.id);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setMoment(null), MOMENT_MS);
      }
    });

  const data = list.data;
  if (!data)
    return list.status === "error" ? (
      <p className="cn-fail" role="alert">
        Лічильники не завантажились. <button onClick={list.reload}>Повторити</button>
      </p>
    ) : (
      <div className="counters cn-wait" aria-hidden="true" />
    );

  const shown = data.counters.filter((c) => !c.hidden);
  const hiddenDiary = data.counters.find((c) => c.hidden);
  // With nothing to count the row stays open: it is where a hidden diary is brought back and a first counter made.
  const expanded = open || !shown.length;
  const showDiary = () =>
    action.run(async () => {
      patch(await send<CounterDetail>("POST", "/api/counters/diary/hidden", { hidden: false }));
    });

  return (
    <section className="counters" aria-label="Лічильники">
      <div className="cn-head">
        {shown.length ? (
          <button
            className="cn-toggle"
            aria-expanded={expanded}
            aria-controls="cn-body"
            aria-label={expanded ? "Лічильники" : `Лічильники: ${shown.map(spoken).join(", ")}`}
            onClick={toggle}
          >
            {expanded ? (
              <span className="cn-title">Лічильники</span>
            ) : (
              <span className="cn-strip">
                {shown.map((c) => (
                  <span className="cn-item" key={c.id}>
                    <span className="cn-n">{c.name}</span>
                    <b className={c.kind === "keep" ? "g" : undefined}>{figure(c)}</b>
                  </span>
                ))}
              </span>
            )}
            <Icon name="down" size={18} />
          </button>
        ) : (
          <p className="cn-toggle cn-empty">
            <span className="cn-title">Лічильники</span>
            <span>поки порожньо</span>
          </p>
        )}
        {expanded && (
          <button className="cn-add" aria-label="Новий лічильник" onClick={() => setSheet("new")}>
            <Icon name="plus" size={20} />
          </button>
        )}
      </div>
      <div id="cn-body" className={expanded ? "cn-fold" : "cn-fold shut"} inert={!expanded}>
        <div>
          <ul className="cn-list">
            {shown.map((c) => (
              <li key={c.id} className={moment === c.id ? "cn-row moment" : "cn-row"}>
                <button className="cn-open" aria-label={spoken(c)} onClick={() => setSheet(c.id)}>
                  <span className="cn-name">{c.name}</span>
                  <span className={c.kind === "keep" ? "cn-num g" : "cn-num"}>
                    <b key={c.days} className={moment === c.id ? "roll" : undefined}>
                      {figure(c)}
                    </b>
                    {c.days !== null && <i>дн.</i>}
                  </span>
                </button>
                {c.kind === "done" ? (
                  <button
                    className="cn-done"
                    aria-pressed={c.markedToday}
                    aria-label={`Зробив сьогодні: ${c.name}`}
                    disabled={action.busy}
                    onClick={() => tick(c)}
                  >
                    <span>
                      <Icon name="tick" size={16} />
                    </span>
                  </button>
                ) : (
                  <span className="cn-none" aria-hidden="true" />
                )}
              </li>
            ))}
          </ul>
          {hiddenDiary && (
            <button className="cn-more" disabled={action.busy} onClick={showDiary}>
              Показати «{hiddenDiary.name}»
            </button>
          )}
          {action.failed && (
            <p className="cn-fail" role="alert">
              Не вдалося зберегти зміну. Спробуй ще раз.
            </p>
          )}
        </div>
      </div>
      {sheet === "new" && (
        <NewCounter
          today={data.today}
          onClose={() => setSheet(null)}
          onDone={() => {
            setSheet(null);
            if (!open) toggle();
            list.reload();
          }}
        />
      )}
      {sheet && sheet !== "new" && (
        <CounterSheet
          id={sheet}
          today={data.today}
          onClose={() => setSheet(null)}
          onChanged={(detail) => patch(detail)}
          onDeleted={() => {
            patch(null, sheet);
            setSheet(null);
          }}
        />
      )}
    </section>
  );
}
