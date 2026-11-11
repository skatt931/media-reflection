import { useState } from "react";
import type { CounterDetail } from "../../../src/miniapp/counter-types.ts";
import { send } from "../api.ts";
import { dayMonth, daysLabel, plural } from "../format.ts";
import { useAction, useResource } from "../hooks.ts";
import { Icon } from "../icons.tsx";
import { Bars, Problem, Sheet } from "../parts.tsx";

const NAME_LIMIT = 60;
const TAKEN = "Не вдалося зберегти. Можливо, така назва вже є.";

type Kind = "done" | "keep";

// A new counter: a name and which of the two kinds it is. A «keep» counter may start on an earlier day.
export function NewCounter({
  today,
  onClose,
  onDone,
}: {
  today: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [kind, setKind] = useState<Kind>("done");
  const [since, setSince] = useState(today);
  const { busy, failed, run } = useAction();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = name.trim();
    if (!value) return;
    const saved = await run(async () => {
      await send("POST", "/api/counters", {
        name: value,
        kind,
        ...(kind === "keep" && since ? { since } : {}),
      });
      return true;
    });
    if (saved) onDone();
  };
  return (
    <Sheet title="Новий лічильник" onClose={onClose} focus={false}>
      <div className="fbody">
        <form className="tagadd stacked" onSubmit={submit}>
          <label className="input">
            <input
              autoFocus
              value={name}
              maxLength={NAME_LIMIT}
              placeholder={kind === "done" ? "Напр. «Подзвонити мамі»" : "Напр. «Не курю»"}
              aria-label="Назва лічильника"
              enterKeyHint="done"
              autoComplete="off"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="opts kinds" role="group" aria-label="Вид лічильника">
            <button
              type="button"
              className="opt"
              aria-pressed={kind === "done"}
              onClick={() => setKind("done")}
            >
              Зробив
            </button>
            <button
              type="button"
              className="opt"
              aria-pressed={kind === "keep"}
              onClick={() => setKind("keep")}
            >
              Тримаюсь
            </button>
          </div>
          <p className="cn-hint">
            {kind === "done"
              ? "Скільки днів минуло з останнього разу. Дотик ✓ обнуляє число."
              : "Скільки днів ти вже не робиш цього. Число росте саме, «Зірвався» починає відлік спочатку."}
          </p>
          {kind === "keep" && (
            <label className="input dated">
              <span>Від</span>
              <input
                type="date"
                value={since}
                max={today}
                aria-label="Від якого дня"
                onChange={(e) => setSince(e.target.value)}
              />
            </label>
          )}
          {failed && <Problem>{TAKEN}</Problem>}
          <button className="go" type="submit" disabled={busy || !name.trim()}>
            {busy ? "Зберігаю…" : "Зберегти"}
          </button>
        </form>
      </div>
    </Sheet>
  );
}

type Ask = { what: "lapse" } | { what: "delete" } | { what: "mark"; date: string };

// The details of one counter: when, the history, and the things that need a second look (a lapse, a mark taken
// back, deleting). The diary has only a switch.
export function CounterSheet({
  id,
  today,
  onClose,
  onChanged,
  onDeleted,
}: {
  id: string;
  today: string;
  onClose: () => void;
  onChanged: (detail: CounterDetail | null) => void;
  onDeleted: () => void;
}) {
  const path = `/api/counters/${id}`;
  const view = useResource<CounterDetail>(path);
  const { busy, failed, run } = useAction();
  const [ask, setAsk] = useState<Ask | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const d = view.data;

  const write = (action: string, body: unknown) =>
    run(async () => {
      const next = await send<CounterDetail | null>("POST", `${path}/${action}`, body);
      if (next) view.set(next);
      onChanged(next);
      setAsk(null);
      return true;
    });

  const rename = (e: React.FormEvent) => {
    e.preventDefault();
    const value = (renaming ?? "").trim();
    if (!value) return;
    run(async () => {
      const next = await send<CounterDetail>("PATCH", path, { name: value });
      view.set(next);
      onChanged(next);
      setRenaming(null);
      return true;
    });
  };

  const remove = () =>
    run(async () => {
      await send("POST", `${path}/delete`);
      onDeleted();
      return true;
    });

  if (!d)
    return (
      <Sheet title="Лічильник" onClose={onClose}>
        {view.status === "error" ? (
          <Problem>Не вдалося завантажити лічильник.</Problem>
        ) : (
          <Bars rows={[40, 70, 55]} />
        )}
      </Sheet>
    );

  const keep = d.kind === "keep";
  const auto = d.kind === "auto";
  const marked = new Set(d.marks);
  // From the server's own «today», so the device's time zone cannot shift the day.
  const [year, month, day] = today.split("-").map(Number);
  const yDate = new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);

  const since =
    d.since === null
      ? "Ще немає відміток"
      : auto
        ? `Останній запис: ${dayMonth(d.since)}`
        : keep
          ? `Відлік з ${dayMonth(d.since)}`
          : `Востаннє: ${dayMonth(d.since)}`;

  return (
    <Sheet title={d.name} onClose={onClose}>
      <div className="fbody cn-sheet">
        <div className="cn-big">
          <b className={keep ? "g" : undefined}>{d.days ?? "—"}</b>
          {d.days !== null && <span>{plural(d.days, "день", "дні", "днів")}</span>}
        </div>
        <p className="cn-sub">{since}</p>
        {keep && d.record !== null && <p className="cn-sub">Найдовше: {daysLabel(d.record)}</p>}

        {auto && (
          <>
            <p className="cn-hint">Рахується сам, з дати останнього запису. Тексту щоденника тут немає.</p>
            <div className="opts">
              <button
                type="button"
                className="opt"
                aria-pressed={!d.hidden}
                disabled={busy}
                onClick={() => write("hidden", { hidden: !d.hidden })}
              >
                {!d.hidden && <Icon name="tick" size={17} />}
                Показувати в рядку
              </button>
            </div>
          </>
        )}

        {!auto && !keep && (
          <div className="opts">
            <button
              type="button"
              className="opt"
              aria-pressed={marked.has(today)}
              disabled={busy || marked.has(today)}
              onClick={() => write("mark", { date: today })}
            >
              {marked.has(today) && <Icon name="tick" size={17} />}
              Зробив сьогодні
            </button>
            <button
              type="button"
              className="opt"
              aria-pressed={marked.has(yDate)}
              disabled={busy || marked.has(yDate)}
              onClick={() => write("mark", { date: yDate })}
            >
              {marked.has(yDate) && <Icon name="tick" size={17} />}
              Зробив учора
            </button>
          </div>
        )}

        {keep &&
          (ask?.what === "lapse" ? (
            <div className="cn-ask" role="group" aria-label="Почати відлік спочатку?">
              <span>Почати відлік спочатку?</span>
              <button disabled={busy} onClick={() => write("mark", { date: today })}>
                Так
              </button>
              <button disabled={busy} onClick={() => setAsk(null)}>
                Ні
              </button>
            </div>
          ) : (
            <div className="opts">
              <button type="button" className="opt" disabled={busy} onClick={() => setAsk({ what: "lapse" })}>
                Зірвався
              </button>
            </div>
          ))}

        {!auto && d.marks.length > 0 && (
          <section className="cn-marks">
            <h3>{keep ? "Зриви" : "Відмітки"}</h3>
            <ul>
              {d.marks.map((date) => (
                <li key={date}>
                  <span>{dayMonth(date)}</span>
                  {ask?.what === "mark" && ask.date === date ? (
                    <span className="cn-ask inline" role="group" aria-label="Прибрати відмітку?">
                      <button disabled={busy} onClick={() => write("unmark", { date })}>
                        Прибрати
                      </button>
                      <button disabled={busy} onClick={() => setAsk(null)}>
                        Ні
                      </button>
                    </span>
                  ) : (
                    <button
                      className="cn-x"
                      aria-label={`Прибрати відмітку ${dayMonth(date)}`}
                      disabled={busy}
                      onClick={() => setAsk({ what: "mark", date })}
                    >
                      <Icon name="close" size={18} />
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}

        {failed && <Problem>Не вдалося зберегти зміну. Спробуй ще раз.</Problem>}

        {!auto &&
          (renaming !== null ? (
            <form className="tagadd" onSubmit={rename}>
              <label className="input">
                <input
                  autoFocus
                  value={renaming}
                  maxLength={NAME_LIMIT}
                  aria-label="Нова назва"
                  enterKeyHint="done"
                  autoComplete="off"
                  onChange={(e) => setRenaming(e.target.value)}
                />
              </label>
              <button type="submit" disabled={busy || !renaming.trim()}>
                Зберегти
              </button>
              <button type="button" className="cn-cancel" disabled={busy} onClick={() => setRenaming(null)}>
                Скасувати
              </button>
            </form>
          ) : (
            <div className="cn-foot">
              <button className="textbtn" onClick={() => setRenaming(d.name)}>
                Змінити назву
              </button>
              {ask?.what === "delete" ? (
                <span className="cn-ask inline" role="group" aria-label="Видалити лічильник?">
                  <span>Видалити з історією?</span>
                  <button className="danger" disabled={busy} onClick={remove}>
                    Видалити
                  </button>
                  <button disabled={busy} onClick={() => setAsk(null)}>
                    Ні
                  </button>
                </span>
              ) : (
                <button className="textbtn danger" onClick={() => setAsk({ what: "delete" })}>
                  Видалити
                </button>
              )}
            </div>
          ))}
      </div>
      <button className="go" onClick={onClose}>
        Готово
      </button>
    </Sheet>
  );
}
