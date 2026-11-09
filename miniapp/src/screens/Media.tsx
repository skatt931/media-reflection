import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Shelf } from "../../../src/miniapp/album-types.ts";
import type { CollectionList } from "../../../src/miniapp/collection-types.ts";
import type { Labels, LibraryCard, LibraryList, Thought } from "../../../src/miniapp/library-types.ts";
import { Cover } from "../library/Cover.tsx";
import { Mosaic } from "../library/Mosaic.tsx";
import {
  capital,
  dayMonth,
  materialsLabel,
  monthKey,
  monthName,
  parts,
  plural,
  shortDate,
} from "../format.ts";
import { useBack, useDebounced, useResource, useScrollMemory } from "../hooks.ts";
import { usePane } from "../stage/pane.ts";
import { Icon, type IconName } from "../icons.tsx";
import { Bars, Empty, Failed, Marked } from "../parts.tsx";
import { albumHash, collectionHash, materialHash } from "../router.ts";
import { CollectionName } from "./CollectionSheet.tsx";
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

const SLIDE_MS = 200;
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Your own last words about the material, two lines of them. Where there is more, «Ще» says so and a tap opens
// the rest in place: the card keeps its top and only grows downward. The card itself still opens the material.
function Note({ thought, terms }: { thought: Thought; terms: string[] }) {
  const pane = usePane();
  // «closing» keeps the full text while the box shrinks; the two lines (and their ellipsis) return at the end.
  const [phase, setPhase] = useState<"closed" | "open" | "closing">("closed");
  const [cut, setCut] = useState(false);
  const clip = useRef<HTMLSpanElement>(null);
  const text = useRef<HTMLSpanElement>(null);
  const from = useRef(0);
  const timer = useRef(0);
  const closed = phase === "closed";

  useLayoutEffect(() => {
    const node = text.current;
    if (!node || !closed) return;
    const measure = () => setCut(node.scrollHeight > node.clientHeight + 1);
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(node);
    return () => watch.disconnect();
  }, [thought.body, closed]);

  // The box slides between the height it had and the height it is going to have.
  useLayoutEffect(() => {
    const box = clip.current;
    const words = text.current;
    if (!box || !words || closed) return;
    const opening = phase === "open";
    const target = opening ? box.scrollHeight : parseFloat(getComputedStyle(words).lineHeight) * 2;
    const done = () => {
      box.style.height = "";
      if (!opening) setPhase("closed");
    };
    if (reduced()) return done();
    box.style.height = `${from.current}px`;
    box.getBoundingClientRect();
    box.style.height = `${target}px`;
    timer.current = window.setTimeout(done, SLIDE_MS + 40);
    return () => {
      window.clearTimeout(timer.current);
      box.style.height = "";
    };
  }, [phase, closed]);

  const toggleOpen = () => {
    const box = clip.current;
    if (!box) return;
    from.current = box.offsetHeight;
    if (!closed) {
      // The card is still above the top of the screen when the text is read to the end: keep it in sight.
      const scroller = pane?.ref.current;
      const card = box.closest(".item");
      if (scroller && card) {
        const heading = card.closest("section")?.querySelector(".month");
        const edge = heading?.getBoundingClientRect().bottom ?? scroller.getBoundingClientRect().top;
        const lost = edge - card.getBoundingClientRect().top;
        if (lost > 0) scroller.scrollTop -= lost;
      }
    }
    setPhase(phase === "open" ? "closing" : "open");
  };

  const open = phase === "open";
  const hint = cut || !closed;
  return (
    <button
      type="button"
      className={hint ? "note more" : "note"}
      aria-expanded={hint ? open : undefined}
      onClick={() => hint && toggleOpen()}
    >
      <span ref={clip} className="clip">
        <span ref={text} className={closed ? "words" : "words full"}>
          <Marked text={thought.body} terms={terms} />
        </span>
      </span>
      {hint && (
        <span className="foot">
          {!closed && <time dateTime={thought.date}>{dayMonth(thought.date)}</time>}
          <span className="toggle" data-open={open}>
            {open ? "Згорнути" : "Ще"}
            <Icon name="down" size={16} />
          </span>
        </span>
      )}
    </button>
  );
}

export function Item({ card, labels, terms = [] }: { card: LibraryCard; labels: Labels; terms?: string[] }) {
  const by = card.creator ?? card.source;
  const status = card.status ? labels.statuses[card.status] : null;
  const last = status
    ? `${status} · ${shortDate(card.date)}`
    : card.tags.length
      ? card.tags.join(" · ")
      : shortDate(card.date);
  return (
    <div className="item" data-card={card.id}>
      <Cover id={card.id} title={card.title} has={card.cover} />
      <div className="body">
        <h3>
          <a href={materialHash(card.id)}>{card.title}</a>
        </h3>
        <p className="by">{[labels.types[card.type] ?? card.type, by].filter(Boolean).join(" · ")}</p>
        {card.thought && <Note thought={card.thought} terms={terms} />}
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
    </div>
  );
}

// Collections as a low shelf: a small mosaic, the name and the count, in one row you can scroll. A new one starts
// from the plus beside the heading.
function Collections({ list, onNew }: { list: CollectionList; onNew: () => void }) {
  return (
    <section className="colls" aria-label="Добірки">
      <div className="colls-head">
        <h2 className="sub">Добірки</h2>
        <button className="colls-new" aria-label="Нова добірка" onClick={onNew}>
          <Icon name="plus" size={20} />
        </button>
      </div>
      <div className="strip" data-noswipe>
        {list.collections.map((c) => (
          <a key={c.id} className="coll" href={collectionHash(c.id)}>
            <Mosaic tiles={c.tiles} />
            <span className="said">
              <b>{c.name}</b>
              <small>{materialsLabel(c.count)}</small>
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}

// The month's album: the newest one sits above the list, a tap opens it.
function AlbumBar({ shelf }: { shelf: Shelf }) {
  const album = shelf.albums[0];
  if (!album) return null;
  const word = capital(monthName(Number(album.period.slice(5)) - 1));
  const facts = [
    album.loved ? `${album.loved} ${plural(album.loved, "улюблений", "улюблених", "улюблених")}` : null,
    album.thoughts ? `${album.thoughts} ${plural(album.thoughts, "думка", "думки", "думок")}` : null,
  ].filter(Boolean);
  return (
    <a className="albumbar" href={albumHash(album.period)}>
      <Mosaic tiles={album.tiles} fill={!album.done} />
      <span className="said">
        <b>Мій {word.toLowerCase()}</b>
        <small>{facts.length ? facts.join(" · ") : album.done ? "Альбом місяця" : "Наповнюється"}</small>
      </span>
      <Icon name="next" size={20} />
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
              <Item key={card.id} card={card} labels={data.labels} terms={data.terms} />
            ))}
          </section>
        );
      })}
    </>
  );
}

export function Media() {
  const collections = useResource<CollectionList>("/api/collections");
  const shelf = useResource<Shelf>("/api/albums");
  const [naming, setNaming] = useState(false);
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

      {!narrowed && !!data?.total && shelf.data && <AlbumBar shelf={shelf.data} />}
      {!narrowed && !!data?.total && collections.data && collections.data.collections.length > 0 && (
        <Collections list={collections.data} onNew={() => setNaming(true)} />
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

      {naming && (
        <CollectionName
          onClose={() => setNaming(false)}
          onDone={() => {
            setNaming(false);
            collections.reload();
          }}
        />
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
