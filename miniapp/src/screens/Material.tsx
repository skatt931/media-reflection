import { useState } from "react";
import type { LibraryItem } from "../../../src/miniapp/library-types.ts";
import { ApiError, send } from "../api.ts";
import { dayMonth } from "../format.ts";
import { useBack, useResource } from "../hooks.ts";
import { Icon, type IconName } from "../icons.tsx";
import { Cover } from "../library/Cover.tsx";
import { BackBar, Bars, Empty, Failed } from "../parts.tsx";
import { goBack, sectionHash } from "../router.ts";
import { openLink } from "../telegram.ts";
import { EditSheet } from "./EditSheet.tsx";
import { TextSheet } from "./TextSheet.tsx";

const IMPRESSION_LIMIT = 4_000;

export function Material({ id }: { id: string }) {
  const item = useResource<LibraryItem>(`/api/library/${encodeURIComponent(id)}`);
  const [editing, setEditing] = useState(false);
  const [noting, setNoting] = useState(false);
  const back = () => goBack(sectionHash("media"));
  useBack(true, back);
  const data = item.data;
  const text = data?.summary ?? data?.description;
  const status = data?.status ? data.labels.statuses[data.status] : null;

  return (
    <>
      <main className={data?.url ? "screen detail with-open" : "screen detail"}>
        <div className="detailbar">
          <BackBar onBack={back} />
          {data && (
            <button className="textbtn" onClick={() => setEditing(true)}>
              <Icon name="edit" size={18} />
              Змінити
            </button>
          )}
        </div>
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
              <div className="thead">
                <h2>
                  Враження
                  {data.impressions.length > 0 && <span>{data.impressions.length}</span>}
                </h2>
                <button className="textbtn" onClick={() => setNoting(true)}>
                  <Icon name="plus" size={18} />
                  Додати
                </button>
              </div>
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
      {data && editing && <EditSheet item={data} onChange={item.set} onClose={() => setEditing(false)} />}
      {data && noting && (
        <TextSheet
          title="Нове враження"
          placeholder="Що думаєш про це?"
          draftKey={`draft:impression:${data.id}`}
          limit={IMPRESSION_LIMIT}
          serif
          onClose={() => setNoting(false)}
          save={async (body) =>
            item.set(
              await send<LibraryItem>("POST", `/api/library/${encodeURIComponent(data.id)}/impressions`, {
                body,
              }),
            )
          }
        />
      )}
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
