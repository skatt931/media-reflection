import type { DiaryEntry } from "../../../src/miniapp/data.ts";
import { ApiError } from "../api.ts";
import { dayMonth, dayMonthPlain, parts, weekdayFull, wordsLabel } from "../format.ts";
import { useBack, useResource } from "../hooks.ts";
import { Icon } from "../icons.tsx";
import { BackBar, Bars, Empty, Failed } from "../parts.tsx";
import { entryHash, goBack, sectionHash } from "../router.ts";

export function Entry({ id }: { id: number }) {
  const entry = useResource<DiaryEntry>(`/api/diary/${id}`);
  const back = () => goBack(sectionHash("diary"));
  useBack(true, back);
  const data = entry.data;

  return (
    <main className="screen">
      <BackBar onBack={back} />
      {data ? (
        <article className="reader">
          <p className="kicker">
            {weekdayFull(data.date)}, {parts(data.date).year}
          </p>
          <h1>{dayMonthPlain(data.date)}</h1>
          {data.body.trim() ? (
            data.body.split(/\n{2,}/).map((paragraph, i) => <p key={i}>{paragraph.trim()}</p>)
          ) : (
            <p className="empty">Запис порожній.</p>
          )}
          <footer className="end">
            {data.words > 0 && <p className="count">{wordsLabel(data.words)}</p>}
            <nav aria-label="Сусідні записи">
              {data.older && (
                <a href={entryHash(data.older.id)}>
                  <Icon name="back" size={18} />
                  <span>
                    Старіший запис<small>{dayMonth(data.older.date)}</small>
                  </span>
                </a>
              )}
              {data.newer && (
                <a href={entryHash(data.newer.id)} className="newer">
                  <span>
                    Новіший запис<small>{dayMonth(data.newer.date)}</small>
                  </span>
                  <Icon name="next" size={18} />
                </a>
              )}
            </nav>
          </footer>
        </article>
      ) : entry.status === "error" ? (
        entry.error instanceof ApiError && entry.error.status === 404 ? (
          <Empty>Такого запису немає.</Empty>
        ) : (
          <Failed what="запис" retry={entry.reload} />
        )
      ) : (
        <Bars className="reading" rows={[45, 100, 95, 100, 70, 100, 90, 60]} />
      )}
    </main>
  );
}
