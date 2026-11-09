import { useEffect, useState } from "react";
import { ApiError, get } from "../api.ts";
import { openLink } from "../telegram.ts";
import { Cover } from "./Cover.tsx";
import { longDate } from "./format.ts";
import { ExternalIcon, ReactionIcon } from "./icons.tsx";
import type { Detail as DetailData } from "./types.ts";

type Load =
  { state: "loading" } | { state: "failed" } | { state: "missing" } | { state: "ready"; item: DetailData };

export function Detail({ id }: { id: string }) {
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const abort = new AbortController();
    setLoad({ state: "loading" });
    window.scrollTo(0, 0);
    get<DetailData>(`/api/library/${encodeURIComponent(id)}`, abort.signal).then(
      (item) => setLoad({ state: "ready", item }),
      (e) => {
        if (!abort.signal.aborted)
          setLoad({ state: e instanceof ApiError && e.status === 404 ? "missing" : "failed" });
      },
    );
    return () => abort.abort();
  }, [id, attempt]);

  if (load.state === "loading")
    return (
      <main className="screen detail">
        <p className="empty">Завантаження…</p>
      </main>
    );
  if (load.state === "missing")
    return (
      <main className="screen detail">
        <div className="state">
          <p>Матеріал не знайдено. Можливо, його видалили.</p>
          <a className="button" href="#/media">
            До медіатеки
          </a>
        </div>
      </main>
    );
  if (load.state === "failed")
    return (
      <main className="screen detail">
        <div className="state">
          <p>Не вдалося завантажити матеріал.</p>
          <button className="button" onClick={() => setAttempt((n) => n + 1)}>
            Спробувати ще раз
          </button>
        </div>
      </main>
    );

  const { item } = load;
  const { labels } = item;
  const text = item.summary ?? item.description;
  const by = item.creator;
  const when = item.status
    ? `${labels.statuses[item.status] ?? item.status}, ${longDate(item.date)}`
    : `Збережено ${longDate(item.date)}`;
  return (
    <>
      <main className={item.url ? "screen detail with-action" : "screen detail"}>
        {item.cover && <Cover id={item.id} title={item.title} has large />}
        <p className="kicker">
          {[labels.types[item.type] ?? item.type, item.source].filter(Boolean).join(" · ")}
        </p>
        <h1>{item.title}</h1>
        {by && <p className="by">{by}</p>}
        <div className="verdict">
          {item.reaction && (
            <p className={`reaction-line ${item.reaction}`}>
              <ReactionIcon reaction={item.reaction} filled={item.reaction === "loved"} />
              <strong>{labels.reactions[item.reaction] ?? item.reaction}</strong>
            </p>
          )}
          <p className="when">{when}</p>
        </div>
        {text && <p className="summary">{text}</p>}
        {item.tags.length > 0 && (
          <ul className="tags">
            {item.tags.map((tag) => (
              <li key={tag}>{tag}</li>
            ))}
          </ul>
        )}
        {item.entities.length > 0 && <p className="entities">Згадано: {item.entities.join(", ")}</p>}
        <section className="impressions">
          <h2>
            <span>Враження</span>
            {item.impressions.length > 0 && <span>{item.impressions.length}</span>}
          </h2>
          {item.impressions.length === 0 ? (
            <p className="empty">Вражень ще немає.</p>
          ) : (
            <ol>
              {item.impressions.map((note, i) => (
                <li key={i}>
                  <time dateTime={note.date}>{longDate(note.date)}</time>
                  <p>{note.body}</p>
                </li>
              ))}
            </ol>
          )}
        </section>
      </main>
      {item.url && (
        <div className="action">
          <button className="button wide" onClick={() => openLink(item.url!)}>
            <ExternalIcon />
            Відкрити джерело
          </button>
        </div>
      )}
    </>
  );
}
