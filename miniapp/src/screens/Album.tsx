import type { Album as AlbumData, Shelf } from "../../../src/miniapp/album-types.ts";
import type { Tile } from "../../../src/miniapp/collection-types.ts";
import { ApiError } from "../api.ts";
import { capital, dayMonth, monthName, parts, plural, records } from "../format.ts";
import { useBack, useResource, useScrollMemory } from "../hooks.ts";
import { Icon } from "../icons.tsx";
import { Cover } from "../library/Cover.tsx";
import { Mosaic } from "../library/Mosaic.tsx";
import { BackBar, Bars, Empty, Failed } from "../parts.tsx";
import { albumHash, albumsHash, entryHash, goBack, materialHash, sectionHash } from "../router.ts";

const monthWord = (period: string) => monthName(Number(period.slice(5)) - 1);
const year = (period: string) => period.slice(0, 4);

function Loved({ album }: { album: AlbumData }) {
  const open = Math.max(0, album.slots - album.loved.length);
  return (
    <section className="chapter">
      <h2 className="sub">Улюблене</h2>
      <div className="wall">
        {album.loved.map((tile: Tile) => (
          <a key={tile.id} href={materialHash(tile.id)} aria-label={tile.title}>
            <Cover id={tile.id} title={tile.title} has={tile.cover} />
          </a>
        ))}
        {Array.from({ length: open }, (_, i) => (
          <span key={i} className="slot" aria-hidden="true">
            {i === 0 && <Icon name="loved" size={22} />}
          </span>
        ))}
      </div>
      {!album.done && (
        <p className="hint">
          {album.loved.length
            ? "Наступне улюблене займе вільне місце."
            : "Познач матеріал улюбленим, і його обкладинка з’явиться тут."}
        </p>
      )}
    </section>
  );
}

// «Мій листопад»: what the month left, put together from your own marks and words.
export function Album({ period }: { period: string }) {
  const view = useResource<AlbumData>(`/api/albums/${period}`);
  const back = () => goBack(sectionHash("media"));
  useBack(true, back);
  useScrollMemory(view.status === "ok");
  const data = view.data;
  const counts = data?.counts;

  return (
    <main className="screen detail album">
      <div className="detailbar">
        <BackBar onBack={back} />
        <a className="textbtn" href={albumsHash}>
          Усі місяці
        </a>
      </div>
      {data && counts ? (
        <>
          <header className="albumhead">
            <p className="kicker">
              {data.done ? `${year(period)} · альбом місяця` : `${year(period)} · наповнюється`}
            </p>
            <h1>Мій {monthWord(period)}</h1>
            <p className="tally">
              {[
                `${counts.saved} ${plural(counts.saved, "матеріал", "матеріали", "матеріалів")}`,
                counts.loved
                  ? `${counts.loved} ${plural(counts.loved, "улюблений", "улюблених", "улюблених")}`
                  : null,
                counts.thoughts
                  ? `${counts.thoughts} ${plural(counts.thoughts, "думка", "думки", "думок")}`
                  : null,
                counts.diary ? records(counts.diary) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </header>

          {(data.loved.length > 0 || !data.done) && <Loved album={data} />}

          {data.quotes.length > 0 && (
            <section className="chapter">
              <h2 className="sub">Твоїми словами</h2>
              {data.quotes.map((quote) => (
                <a key={quote.id} className="quote" href={materialHash(quote.id)}>
                  <p>{quote.body}</p>
                  <small>
                    {quote.title} · {dayMonth(quote.date)}
                  </small>
                </a>
              ))}
            </section>
          )}

          {data.diary.length > 0 && (
            <section className="chapter">
              <h2 className="sub">Щоденник</h2>
              {data.diary.map((note) => (
                <a key={note.id} className="row" href={entryHash(note.id)}>
                  <div className="day">
                    <b>{parts(note.date).day}</b>
                    <span>
                      {capital(monthName(parts(note.date).month))
                        .slice(0, 3)
                        .toLowerCase()}
                    </span>
                  </div>
                  <p>{note.excerpt}</p>
                </a>
              ))}
            </section>
          )}

          <nav className="neighbours" aria-label="Інші місяці">
            {data.older ? (
              <a href={albumHash(data.older)}>
                <Icon name="back" size={18} />
                {capital(monthWord(data.older))}
              </a>
            ) : (
              <span />
            )}
            {data.newer && (
              <a href={albumHash(data.newer)}>
                {capital(monthWord(data.newer))}
                <Icon name="next" size={18} />
              </a>
            )}
          </nav>
        </>
      ) : view.status === "error" ? (
        view.error instanceof ApiError && view.error.status === 404 ? (
          <Empty>За цей місяць альбому ще немає.</Empty>
        ) : (
          <Failed what="альбом" retry={view.reload} />
        )
      ) : (
        <Bars className="reading" rows={[40, 70, 100, 100, 90, 70]} />
      )}
    </main>
  );
}

// The shelf: the open month first, the finished ones behind it, a year at a time.
export function Albums() {
  const shelf = useResource<Shelf>("/api/albums");
  const back = () => goBack(sectionHash("media"));
  useBack(true, back);
  useScrollMemory(shelf.status === "ok");
  const years = [...new Set(shelf.data?.albums.map((a) => year(a.period)))];

  return (
    <main className="screen detail">
      <div className="detailbar">
        <BackBar onBack={back} />
      </div>
      <header className="top">
        <h1>Мої місяці</h1>
      </header>
      {shelf.data ? (
        shelf.data.albums.length ? (
          years.map((y) => (
            <section key={y}>
              <h2 className="month">{y}</h2>
              <div className="shelf">
                {shelf
                  .data!.albums.filter((a) => year(a.period) === y)
                  .map((a) => (
                    <a key={a.period} className="shelfcard" href={albumHash(a.period)}>
                      <Mosaic tiles={a.tiles} fill={!a.done} />
                      <b>{capital(monthWord(a.period))}</b>
                      <small>
                        {[
                          a.done ? null : "Зараз",
                          a.loved
                            ? `${a.loved} ${plural(a.loved, "улюблений", "улюблених", "улюблених")}`
                            : `${a.saved} ${plural(a.saved, "матеріал", "матеріали", "матеріалів")}`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </small>
                    </a>
                  ))}
              </div>
            </section>
          ))
        ) : (
          <Empty>Альбомів ще немає. Вони з’являються з першими збереженими матеріалами.</Empty>
        )
      ) : shelf.status === "error" ? (
        <Failed what="полицю" retry={shelf.reload} />
      ) : (
        <Bars className="rows" rows={[90, 70, 85]} />
      )}
    </main>
  );
}
