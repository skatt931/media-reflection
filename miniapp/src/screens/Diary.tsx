import { useMemo, useState } from "react";
import type { DiaryItem, DiaryList } from "../../../src/miniapp/data.ts";
import { capital, monthAbbr, monthKey, monthName, parts, records, weekdayShort } from "../format.ts";
import { useResource, useScrollMemory } from "../hooks.ts";
import { Icon } from "../icons.tsx";
import { Bars, Empty, Failed, Marked } from "../parts.tsx";
import { composeHash, entryHash, searchHash } from "../router.ts";
import { Calendar } from "./Calendar.tsx";

// In a month's list the line under the day is its weekday; in search results, which cross months, its month.
export function DiaryRow({
  entry,
  terms = [],
  withMonth = false,
  ...rest
}: {
  entry: DiaryItem;
  terms?: string[];
  withMonth?: boolean;
  id?: string;
}) {
  const { day, month, year } = parts(entry.date);
  return (
    <a className="row" href={entryHash(entry.id)} {...rest}>
      <span className="day">
        <b>{String(day).padStart(2, "0")}</b>
        <span>
          {withMonth
            ? `${monthAbbr[month]}${year === new Date().getFullYear() ? "" : ` ${year}`}`
            : weekdayShort(entry.date)}
        </span>
      </span>
      {entry.excerpt ? (
        <p>
          <Marked text={entry.excerpt} terms={terms} />
        </p>
      ) : (
        <p className="blank">Запис порожній</p>
      )}
    </a>
  );
}

function Months({ entries }: { entries: DiaryItem[] }) {
  const groups = useMemo(() => {
    const out: { key: string; items: DiaryItem[] }[] = [];
    for (const entry of entries) {
      const key = monthKey(entry.date);
      if (out.at(-1)?.key === key) out.at(-1)!.items.push(entry);
      else out.push({ key, items: [entry] });
    }
    return out;
  }, [entries]);
  return (
    <>
      {groups.map(({ key, items }) => {
        const { month, year } = parts(items[0].date);
        return (
          <section key={key}>
            <h2 className="month">
              {capital(monthName(month))} {year}
              <span>{records(items.length)}</span>
            </h2>
            {items.map((entry) => (
              <DiaryRow key={entry.id} entry={entry} id={`entry-${entry.id}`} />
            ))}
          </section>
        );
      })}
    </>
  );
}

export function Diary() {
  const list = useResource<DiaryList>("/api/diary");
  const [calendar, setCalendar] = useState(false);
  useScrollMemory(list.status === "ok");
  const entries = list.data?.entries;

  const jump = (id: number) => {
    setCalendar(false);
    document.getElementById(`entry-${id}`)?.scrollIntoView({ block: "start" });
  };

  return (
    <main className="screen">
      <header className="top">
        <h1>Щоденник</h1>
        <div className="acts">
          {!!entries?.length && (
            <>
              <a href={searchHash("diary")} aria-label="Пошук">
                <Icon name="search" />
              </a>
              <button aria-label="Календар" aria-pressed={calendar} onClick={() => setCalendar(true)}>
                <Icon name="calendar" />
              </button>
            </>
          )}
          <a href={composeHash} aria-label="Новий запис">
            <Icon name="plus" />
          </a>
        </div>
      </header>
      {entries ? (
        entries.length ? (
          <Months entries={entries} />
        ) : (
          <Empty>Записів поки немає. Натисни + угорі або почни командою /diary у боті.</Empty>
        )
      ) : list.status === "error" ? (
        <Failed what="щоденник" retry={list.reload} />
      ) : (
        <Bars className="rows" rows={[90, 70, 85, 60, 90, 75]} />
      )}
      {calendar && entries && <Calendar entries={entries} onPick={jump} onClose={() => setCalendar(false)} />}
    </main>
  );
}
