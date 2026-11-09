import { useEffect, useMemo, useRef, useState } from "react";
import { ApiError, get } from "../api.ts";
import { Cover } from "./Cover.tsx";
import { FilterSheet } from "./FilterSheet.tsx";
import { materials, monthTitle, shortDate } from "./format.ts";
import { CloseIcon, FilterIcon, ReactionIcon, SearchIcon } from "./icons.tsx";
import {
  isFiltered,
  noFilters,
  type Card,
  type Filters,
  type Labels,
  type LibraryResponse,
} from "./types.ts";

function query(filters: Filters, q: string) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (filters.types.length) params.set("type", filters.types.join(","));
  if (filters.statuses.length) params.set("status", filters.statuses.join(","));
  if (filters.reactions.length) params.set("reaction", filters.reactions.join(","));
  if (filters.unreviewed) params.set("unreviewed", "1");
  const text = params.toString();
  return `/api/library${text ? `?${text}` : ""}`;
}

type Load = { state: "loading" } | { state: "failed" } | { state: "ready"; data: LibraryResponse };

function useLibrary(filters: Filters, q: string, attempt: number) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const first = useRef(true);
  useEffect(() => {
    const abort = new AbortController();
    // Typing waits a moment; a filter tap does not.
    const timer = setTimeout(
      () => {
        get<LibraryResponse>(query(filters, q), abort.signal).then(
          (data) => setLoad({ state: "ready", data }),
          (e) => {
            if (abort.signal.aborted) return;
            // Stale content stays on screen while a refresh fails only if there is some.
            setLoad((old) => (old.state === "ready" && !(e instanceof ApiError) ? old : { state: "failed" }));
          },
        );
      },
      first.current ? 0 : q ? 250 : 0,
    );
    first.current = false;
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [filters, q, attempt]);
  return load;
}

function toggle(list: string[], value: string) {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

function Row({ card, labels }: { card: Card; labels: Labels }) {
  const by = card.creator ?? card.source;
  const status = card.status ? labels.statuses[card.status] : null;
  const last = status
    ? `${status} · ${shortDate(card.date)}`
    : card.tags.length
      ? card.tags.join(" · ")
      : shortDate(card.date);
  return (
    <li>
      <a className="row" href={`#/media/${encodeURIComponent(card.id)}`}>
        <Cover id={card.id} title={card.title} has={card.cover} />
        <span className="row-text">
          <span className="row-title">{card.title}</span>
          <span className="row-meta">
            {[labels.types[card.type] ?? card.type, by].filter(Boolean).join(" · ")}
          </span>
          <span className="row-meta row-foot">
            <span>{last}</span>
            {card.reaction ? (
              <span className={`reaction ${card.reaction}`} title={labels.reactions[card.reaction]}>
                <ReactionIcon reaction={card.reaction} />
              </span>
            ) : card.unreviewed ? (
              <span>Без вражень</span>
            ) : null}
          </span>
        </span>
      </a>
    </li>
  );
}

function Groups({ items, labels }: { items: Card[]; labels: Labels }) {
  const groups = useMemo(() => {
    const result: { month: string; items: Card[] }[] = [];
    for (const item of items) {
      const month = item.date.slice(0, 7);
      const last = result.at(-1);
      if (last?.month === month) last.items.push(item);
      else result.push({ month, items: [item] });
    }
    return result;
  }, [items]);
  return (
    <>
      {groups.map((group) => (
        <section key={group.month} className="group">
          <h2>
            <span>{monthTitle(group.items[0].date)}</span>
            <span>{materials(group.items.length)}</span>
          </h2>
          <ul>
            {group.items.map((card) => (
              <Row key={card.id} card={card} labels={labels} />
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

export function Library({ hidden }: { hidden: boolean }) {
  const [filters, setFilters] = useState<Filters>(noFilters);
  const [text, setText] = useState("");
  const [searching, setSearching] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const q = text.trim();
  const load = useLibrary(filters, q, attempt);
  const scroll = useRef(0);

  // The list stays mounted under a material, so filters and position survive going back.
  useEffect(() => {
    if (hidden) scroll.current = window.scrollY;
    else window.scrollTo(0, scroll.current);
  }, [hidden]);

  const data = load.state === "ready" ? load.data : null;
  // One month already says its count in its own heading.
  const manyMonths = new Set(data?.items.map((i) => i.date.slice(0, 7))).size > 1;
  const narrowed = q !== "" || isFiltered(filters);

  return (
    <main className="screen" hidden={hidden}>
      {searching ? (
        <form className="searchbar" role="search" onSubmit={(e) => e.preventDefault()}>
          <label>
            <SearchIcon />
            <input
              autoFocus
              type="search"
              enterKeyHint="search"
              placeholder="Назва, автор, тема, думка"
              aria-label="Пошук у медіатеці"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            {text && (
              <button type="button" className="clear" aria-label="Очистити" onClick={() => setText("")}>
                <CloseIcon />
              </button>
            )}
          </label>
          <button
            type="button"
            className="link"
            onClick={() => {
              setText("");
              setSearching(false);
            }}
          >
            Скасувати
          </button>
        </form>
      ) : (
        <header className="head">
          <h1>Медіатека</h1>
          <div className="tools">
            <button aria-label="Пошук" onClick={() => setSearching(true)}>
              <SearchIcon />
            </button>
            <button
              aria-label="Фільтри"
              className={isFiltered(filters) ? "on" : ""}
              onClick={() => setSheet(true)}
            >
              <FilterIcon />
            </button>
          </div>
        </header>
      )}

      {data && data.total > 0 && (
        <div className="chips" role="group" aria-label="Швидкі фільтри">
          <button className="chip" aria-pressed={!isFiltered(filters)} onClick={() => setFilters(noFilters)}>
            Усе <small>{data.total}</small>
          </button>
          {data.counts.saved > 0 && (
            <button
              className="chip"
              aria-pressed={filters.statuses.includes("saved")}
              onClick={() => setFilters({ ...filters, statuses: toggle(filters.statuses, "saved") })}
            >
              {data.labels.statuses.saved} <small>{data.counts.saved}</small>
            </button>
          )}
          {data.counts.unreviewed > 0 && (
            <button
              className="chip"
              aria-pressed={filters.unreviewed}
              onClick={() => setFilters({ ...filters, unreviewed: !filters.unreviewed })}
            >
              Без вражень <small>{data.counts.unreviewed}</small>
            </button>
          )}
          {Object.entries(data.counts.types)
            .sort((a, b) => b[1] - a[1])
            .map(([type, count]) => (
              <button
                key={type}
                className="chip"
                aria-pressed={filters.types.includes(type)}
                onClick={() => setFilters({ ...filters, types: toggle(filters.types, type) })}
              >
                {data.labels.types[type] ?? type} <small>{count}</small>
              </button>
            ))}
        </div>
      )}

      {load.state === "loading" && <p className="empty">Завантаження…</p>}
      {load.state === "failed" && (
        <div className="state">
          <p>Не вдалося завантажити медіатеку.</p>
          <button className="button" onClick={() => setAttempt((n) => n + 1)}>
            Спробувати ще раз
          </button>
        </div>
      )}
      {data && narrowed && manyMonths && <p className="found">{materials(data.items.length)}</p>}
      {data && data.items.length > 0 && <Groups items={data.items} labels={data.labels} />}
      {data && data.items.length === 0 && (
        <div className="state">
          {data.total === 0 ? (
            <p>Медіатека порожня. Надішли боту посилання, і матеріал з’явиться тут.</p>
          ) : (
            <>
              <p>Нічого не знайдено.</p>
              <button
                className="button"
                onClick={() => {
                  setFilters(noFilters);
                  setText("");
                  setSearching(false);
                }}
              >
                Скинути пошук і фільтри
              </button>
            </>
          )}
        </div>
      )}

      {sheet && data && (
        <FilterSheet
          filters={filters}
          counts={data.counts}
          labels={data.labels}
          shown={data.items.length}
          onChange={setFilters}
          onClose={() => setSheet(false)}
        />
      )}
    </main>
  );
}
