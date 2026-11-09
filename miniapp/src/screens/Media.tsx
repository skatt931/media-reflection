import { useEffect, useMemo, useRef, useState } from "react";
import type { LibraryCard, LibraryList } from "../../../src/miniapp/library-types.ts";
import { Cover } from "../library/Cover.tsx";
import { capital, materialsLabel, monthKey, monthName, parts, shortDate } from "../format.ts";
import { useBack, useDebounced, useResource, useScrollMemory } from "../hooks.ts";
import { Icon, type IconName } from "../icons.tsx";
import { Bars, Empty, Failed } from "../parts.tsx";
import { materialHash } from "../router.ts";
import { FilterSheet, isFiltered, noFilters, toggle, type Filters } from "./Filters.tsx";

function path(filters: Filters, q: string) {
  const params = new URLSearchParams();
  if (q) params.set("q", q);
  if (filters.types.length) params.set("type", filters.types.join(","));
  if (filters.statuses.length) params.set("status", filters.statuses.join(","));
  if (filters.reactions.length) params.set("reaction", filters.reactions.join(","));
  if (filters.unreviewed) params.set("unreviewed", "1");
  if (filters.noThought) params.set("nothought", "1");
  const text = params.toString();
  return `/api/library${text ? `?${text}` : ""}`;
}

// Filters and the search word survive a trip into a material (the list is a different screen).
let remembered = { filters: noFilters, text: "" };

export function Reaction({ reaction, label }: { reaction: string; label: string }) {
  return (
    <span className={`rx ${reaction}`} title={label}>
      <Icon name={reaction as IconName} size={18} />
    </span>
  );
}

function Item({ card, data }: { card: LibraryCard; data: LibraryList }) {
  const { labels } = data;
  const by = card.creator ?? card.source;
  const status = card.status ? labels.statuses[card.status] : null;
  const last = status
    ? `${status} · ${shortDate(card.date)}`
    : card.tags.length
      ? card.tags.join(" · ")
      : shortDate(card.date);
  return (
    <a className="item" href={materialHash(card.id)}>
      <Cover id={card.id} title={card.title} has={card.cover} />
      <div className="body">
        <h3>{card.title}</h3>
        <p className="by">{[labels.types[card.type] ?? card.type, by].filter(Boolean).join(" · ")}</p>
        <p className="st">
          <span>{last}</span>
          {card.reaction ? (
            <span className="marks">
              {card.noThought && <span className="none">Без думки</span>}
              <Reaction reaction={card.reaction} label={labels.reactions[card.reaction] ?? card.reaction} />
            </span>
          ) : card.unreviewed ? (
            <span className="none">Без вражень</span>
          ) : card.noThought ? (
            <span className="none">Без думки</span>
          ) : null}
        </p>
      </div>
    </a>
  );
}

function Months({ data }: { data: LibraryList }) {
  const groups = useMemo(() => {
    const out: { key: string; items: LibraryCard[] }[] = [];
    for (const card of data.items) {
      const key = monthKey(card.date);
      if (out.at(-1)?.key === key) out.at(-1)!.items.push(card);
      else out.push({ key, items: [card] });
    }
    return out;
  }, [data.items]);
  return (
    <>
      {groups.map(({ key, items }) => {
        const { month, year } = parts(items[0].date);
        return (
          <section key={key}>
            <h2 className="month">
              {capital(monthName(month))} {year}
              <span>{materialsLabel(items.length)}</span>
            </h2>
            {items.map((card) => (
              <Item key={card.id} card={card} data={data} />
            ))}
          </section>
        );
      })}
    </>
  );
}

export function Media() {
  const [filters, setFilters] = useState(remembered.filters);
  const [text, setText] = useState(remembered.text);
  const [searching, setSearching] = useState(remembered.text !== "");
  const [sheet, setSheet] = useState(false);
  const q = useDebounced(text.trim(), 250);
  const list = useResource<LibraryList>(path(filters, q));
  const field = useRef<HTMLInputElement>(null);
  useScrollMemory(list.status === "ok");
  useEffect(() => {
    remembered = { filters, text };
  }, [filters, text]);
  const closeSearch = () => {
    setText("");
    setSearching(false);
  };
  useBack(searching && !sheet, closeSearch);

  const data = list.data;
  const types = Object.entries(data?.counts.types ?? {}).sort((a, b) => b[1] - a[1]);
  const manyMonths = new Set(data?.items.map((c) => monthKey(c.date))).size > 1;
  const narrowed = q !== "" || isFiltered(filters);
  const pending = list.status === "loading";

  return (
    <main className="screen">
      {searching ? (
        <form className="field" role="search" onSubmit={(e) => e.preventDefault()}>
          <label className="input">
            <Icon name="search" size={20} />
            <input
              ref={field}
              autoFocus
              type="search"
              value={text}
              placeholder="Назва, автор, тема, думка"
              aria-label="Пошук у медіатеці"
              enterKeyHint="search"
              autoComplete="off"
              onChange={(e) => setText(e.target.value)}
            />
            {text && (
              <button type="button" aria-label="Очистити" onClick={() => setText("")}>
                <Icon name="clear" size={20} />
              </button>
            )}
          </label>
          <button type="button" className="cancel" onClick={closeSearch}>
            Скасувати
          </button>
        </form>
      ) : (
        <header className="top">
          <h1>Медіатека</h1>
          {!!data?.total && (
            <div className="acts">
              <button aria-label="Пошук" onClick={() => setSearching(true)}>
                <Icon name="search" />
              </button>
              <button aria-label="Фільтри" aria-pressed={isFiltered(filters)} onClick={() => setSheet(true)}>
                <Icon name="filter" />
              </button>
            </div>
          )}
        </header>
      )}

      {!!data?.total && (
        <div className="views" role="group" aria-label="Швидкі фільтри">
          <button className="view" aria-pressed={!isFiltered(filters)} onClick={() => setFilters(noFilters)}>
            Усе <small>{data.total}</small>
          </button>
          {data.counts.saved > 0 && (
            <button
              className="view"
              aria-pressed={filters.statuses.includes("saved")}
              onClick={() => setFilters({ ...filters, statuses: toggle(filters.statuses, "saved") })}
            >
              {data.labels.statuses.saved} <small>{data.counts.saved}</small>
            </button>
          )}
          {data.counts.unreviewed > 0 && (
            <button
              className="view"
              aria-pressed={filters.unreviewed}
              onClick={() => setFilters({ ...filters, unreviewed: !filters.unreviewed })}
            >
              Без вражень <small>{data.counts.unreviewed}</small>
            </button>
          )}
          {data.counts.noThought > 0 && (
            <button
              className="view"
              aria-pressed={filters.noThought}
              onClick={() => setFilters({ ...filters, noThought: !filters.noThought })}
            >
              Без думки <small>{data.counts.noThought}</small>
            </button>
          )}
          {types.map(([type, count]) => (
            <button
              key={type}
              className="view"
              aria-pressed={filters.types.includes(type)}
              onClick={() => setFilters({ ...filters, types: toggle(filters.types, type) })}
            >
              {data.labels.types[type] ?? type} <small>{count}</small>
            </button>
          ))}
        </div>
      )}

      {data ? (
        data.total === 0 ? (
          <Empty>Медіатека порожня. Надішли боту посилання, і матеріал з’явиться тут.</Empty>
        ) : (
          <div aria-busy={pending}>
            {narrowed && (manyMonths || data.items.length === 0) && (
              <p className="found" role="status">
                {data.items.length ? materialsLabel(data.items.length) : "Нічого не знайдено."}
              </p>
            )}
            {data.items.length === 0 && narrowed && (
              <button
                className="again"
                onClick={() => {
                  setFilters(noFilters);
                  closeSearch();
                }}
              >
                Скинути пошук і фільтри
              </button>
            )}
            <Months data={data} />
          </div>
        )
      ) : list.status === "error" ? (
        <Failed what="медіатеку" retry={list.reload} />
      ) : (
        <Bars className="rows" rows={[90, 70, 85, 60, 90, 75]} />
      )}

      {sheet && data && (
        <FilterSheet
          filters={filters}
          types={types.map(([type]) => type)}
          labels={data.labels}
          shown={data.items.length}
          onChange={setFilters}
          onClose={() => setSheet(false)}
        />
      )}
    </main>
  );
}
