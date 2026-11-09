import { useEffect } from "react";
import type { LibraryItem } from "../../../src/miniapp/library-types.ts";
import { ApiError } from "../api.ts";
import { dayMonth } from "../format.ts";
import { useBack, useResource } from "../hooks.ts";
import { Icon, type IconName } from "../icons.tsx";
import { Cover } from "../library/Cover.tsx";
import { BackBar, Bars, Empty, Failed } from "../parts.tsx";
import { goBack, sectionHash } from "../router.ts";
import { openLink } from "../telegram.ts";

export function Material({ id }: { id: string }) {
  const item = useResource<LibraryItem>(`/api/library/${encodeURIComponent(id)}`);
  const back = () => goBack(sectionHash("media"));
  useBack(true, back);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [id]);
  const data = item.data;
  const text = data?.summary ?? data?.description;
  const status = data?.status ? data.labels.statuses[data.status] : null;

  return (
    <>
      <main className={data?.url ? "screen detail with-open" : "screen detail"}>
        <BackBar onBack={back} />
        {data ? (
          <article>
            {data.cover && <Cover id={data.id} title={data.title} has large />}
            <p className="kicker">
              {[data.labels.types[data.type] ?? data.type, data.source].filter(Boolean).join(" · ")}
            </p>
            <h1>{data.title}</h1>
            {data.creator && <p className="creator">{data.creator}</p>}
            <p className="facts">
              {data.reaction && (
                <span className={`rx ${data.reaction}`}>
                  <Icon name={data.reaction as IconName} size={18} />
                  {data.labels.reactions[data.reaction] ?? data.reaction}
                </span>
              )}
              <span className="when">
                {status ? `${status}, ${dayMonth(data.date)}` : `Збережено ${dayMonth(data.date)}`}
              </span>
            </p>
            {text && <p className="about">{text}</p>}
            {data.tags.length > 0 && (
              <ul className="tags">
                {data.tags.map((tag) => (
                  <li key={tag}>{tag}</li>
                ))}
              </ul>
            )}
            {data.entities.length > 0 && <p className="mentions">Згадано: {data.entities.join(", ")}</p>}
            <section className="thoughts">
              <h2>
                Враження
                {data.impressions.length > 0 && <span>{data.impressions.length}</span>}
              </h2>
              {data.impressions.length ? (
                data.impressions.map((note, i) => (
                  <div className="thought" key={i}>
                    <time dateTime={note.date}>{dayMonth(note.date)}</time>
                    <p>{note.body}</p>
                  </div>
                ))
              ) : (
                <Empty>Вражень ще немає.</Empty>
              )}
            </section>
          </article>
        ) : item.status === "error" ? (
          item.error instanceof ApiError && item.error.status === 404 ? (
            <Empty>Такого матеріалу немає. Можливо, його видалили.</Empty>
          ) : (
            <Failed what="матеріал" retry={item.reload} />
          )
        ) : (
          <Bars className="reading" rows={[100, 45, 90, 70, 100, 95, 60]} />
        )}
      </main>
      {data?.url && (
        <div className="openbar">
          <button className="open" onClick={() => openLink(data.url!)}>
            <Icon name="external" size={20} />
            Відкрити джерело
          </button>
        </div>
      )}
    </>
  );
}
