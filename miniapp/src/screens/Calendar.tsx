import { useEffect, useMemo, useRef, useState } from "react";
import type { DiaryItem } from "../../../src/miniapp/data.ts";
import {
  capital,
  isoDate,
  monthAbbr,
  monthKey,
  monthName,
  pad,
  parseDate,
  records,
  today,
} from "../format.ts";
import { useBack } from "../hooks.ts";
import { Icon } from "../icons.tsx";

const weekdays = ["пн", "вт", "ср", "чт", "пт", "сб", "нд"];

// Months from the first entry to this one, as [year, month] pairs.
function monthsBetween(first: string, last: string) {
  const out: [number, number][] = [];
  let year = Number(first.slice(0, 4));
  let month = Number(first.slice(5, 7)) - 1;
  const endYear = Number(last.slice(0, 4));
  const endMonth = Number(last.slice(5, 7)) - 1;
  while (year < endYear || (year === endYear && month <= endMonth)) {
    out.push([year, month]);
    if (++month === 12) [year, month] = [year + 1, 0];
  }
  return out;
}

// A sheet over the diary: where the entries are, and a tap on a day goes to its entry.
export function Calendar({
  entries,
  onPick,
  onClose,
}: {
  entries: DiaryItem[];
  onPick: (id: number) => void;
  onClose: () => void;
}) {
  const now = today();
  const byDay = useMemo(() => {
    const map = new Map<string, number>();
    // The list runs newest first, so the first one seen for a day is its latest entry.
    for (const entry of entries) if (!map.has(entry.date)) map.set(entry.date, entry.id);
    return map;
  }, [entries]);
  const perMonth = useMemo(() => {
    const map = new Map<string, number>();
    for (const entry of entries) map.set(monthKey(entry.date), (map.get(monthKey(entry.date)) ?? 0) + 1);
    return map;
  }, [entries]);
  const first = entries.at(-1)?.date ?? now;
  const months = monthsBetween(first < now ? first : now, now);
  const [shown, setShown] = useState<[number, number]>(months.at(-1)!);
  const [year, month] = shown;
  const at = months.findIndex(([y, m]) => y === year && m === month);

  useBack(true, onClose);
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    sheet.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const chips = useRef<HTMLDivElement>(null);
  useEffect(() => {
    chips.current
      ?.querySelector('[aria-pressed="true"]')
      ?.scrollIntoView({ inline: "center", block: "nearest" });
  }, [at]);

  const lead = (new Date(year, month, 1).getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const key = `${year}-${pad(month + 1)}`;
  const count = perMonth.get(key) ?? 0;

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Календар" tabIndex={-1} ref={sheet}>
        <div className="grab" aria-hidden="true" />
        <div className="sheet-top">
          <h2>
            {capital(monthName(month))} {year}
          </h2>
          <div className="acts">
            <button aria-label="Раніше" disabled={at <= 0} onClick={() => setShown(months[at - 1])}>
              <Icon name="back" size={20} />
            </button>
            <button
              aria-label="Пізніше"
              disabled={at >= months.length - 1}
              onClick={() => setShown(months[at + 1])}
            >
              <Icon name="next" size={20} />
            </button>
          </div>
        </div>
        <div className="ribbon" ref={chips}>
          {months.map(([y, m]) => (
            <button
              key={`${y}-${m}`}
              className="chip"
              aria-pressed={y === year && m === month}
              onClick={() => setShown([y, m])}
            >
              <b>{monthAbbr[m]}</b>
              <small>{perMonth.get(`${y}-${pad(m + 1)}`) ?? "—"}</small>
            </button>
          ))}
        </div>
        <div className="cal">
          {weekdays.map((w) => (
            <div key={w} className="wd">
              {w}
            </div>
          ))}
          {Array.from({ length: lead }, (_, i) => (
            <div key={`lead-${i}`} />
          ))}
          {Array.from({ length: days }, (_, i) => {
            const iso = isoDate(parseDate(`${key}-${pad(i + 1)}`));
            const id = byDay.get(iso);
            const cls = `c${id ? " has" : ""}${iso === now ? " today" : ""}${iso > now ? " future" : ""}`;
            return id ? (
              <button key={iso} className={cls} onClick={() => onPick(id)}>
                <span>{i + 1}</span>
              </button>
            ) : (
              <div key={iso} className={cls}>
                <span>{i + 1}</span>
              </div>
            );
          })}
        </div>
        <div className="sheet-foot">
          <span>{count ? `${records(count)} у цьому місяці` : "У цьому місяці записів немає"}</span>
          <button onClick={() => setShown(months.at(-1)!)}>Сьогодні</button>
        </div>
      </div>
    </>
  );
}
