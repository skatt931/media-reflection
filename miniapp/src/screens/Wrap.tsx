import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import type { Wrap as WrapData } from "../../../src/miniapp/wrap-types.ts";
import { ApiError, send } from "../api.ts";
import { monthName, monthNameOf, plural } from "../format.ts";
import { useAction, useBack, useResource } from "../hooks.ts";
import { BackBar, Bars, Empty, Failed, Problem } from "../parts.tsx";
import { albumHash, goBack } from "../router.ts";
import { deck, type Card } from "../wrap/cards.ts";
import { paletteFor } from "../wrap/palette.ts";
import { base64, cardJpeg, cardUrl, covers, embeddedFont, fontsReady } from "../wrap/render.ts";

const STEP_S = 7;
const CONFIRM_MS = 3000;
const month = (period: string) => Number(period.slice(5)) - 1;

type Built = { cards: Card[]; urls: string[]; css: string };

// The cards are drawn once per spec: fonts and covers go inside each SVG, then each is shown as an image.
function useCards(data: WrapData | undefined) {
  const [built, setBuilt] = useState<Built | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const key = data?.spec?.createdAt;
  const [drawn, setDrawn] = useState<string | undefined>();
  useEffect(() => {
    if (!data?.spec) return;
    let current = true;
    setFailed(false);
    (async () => {
      const [css, faces] = await Promise.all([
        embeddedFont(),
        covers([...data.facts.loved.slice(0, 6), ...data.facts.latest.slice(0, 6)]),
        fontsReady(),
      ]);
      const palette = paletteFor(faces.colors, data.spec!.seed);
      const cards = deck({ facts: data.facts, spec: data.spec!, palette, images: faces.images });
      const urls = cards.map((c) => cardUrl(c.svg, css));
      if (!current) return urls.forEach((url) => URL.revokeObjectURL(url));
      setBuilt({ cards, urls, css });
      setDrawn(key);
    })().catch(() => current && setFailed(true));
    return () => {
      current = false;
    };
    // A new spec (another «Ще раз») is a new set of cards; the facts alone do not redraw them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);
  // The image URLs live as long as their cards: the old ones stay on the screen, dimmed, while new ones are drawn.
  useEffect(() => () => built?.urls.forEach((url) => URL.revokeObjectURL(url)), [built]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  // The cards of the spec before stay on the screen, dimmed, until the new ones are drawn.
  return { built, fresh: !!key && drawn === key, failed, retry };
}

const still = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// The cards one at a time, like stories: bars on top, a tap on the left half goes back, on the right forward,
// arrow keys too. They move on by themselves until the first step by hand, the pause button, focus inside or
// a system asking for less motion; a finger on the card and a hidden app hold them.
function Story({ built, at, go, busy }: { built: Built; at: number; go: (n: number) => void; busy: boolean }) {
  const [auto, setAuto] = useState(() => !still());
  const [held, setHeld] = useState(false);
  const [hidden, setHidden] = useState(document.hidden);
  const count = built.cards.length;
  const last = at === count - 1;
  const running = auto && !last;
  const playing = running && !held && !hidden;

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const motion = () => media.matches && setAuto(false);
    const visible = () => setHidden(document.hidden);
    media.addEventListener("change", motion);
    document.addEventListener("visibilitychange", visible);
    return () => {
      media.removeEventListener("change", motion);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);

  const step = (n: number) => {
    setAuto(false);
    if (n >= 0 && n < count) go(n);
  };
  const keys = (e: KeyboardEvent) => {
    if (e.key === "ArrowLeft") step(at - 1);
    else if (e.key === "ArrowRight") step(at + 1);
    else return;
    e.preventDefault();
  };
  const card = built.cards[at];
  const said = `${at + 1} з ${count}. ${card.alt}`;

  return (
    <div
      className={busy ? "story busy" : "story"}
      data-noswipe
      onKeyDown={keys}
      onFocus={(e) => !(e.target as Element).closest(".storypause") && setAuto(false)}
      aria-busy={busy}
      style={{ "--play": playing ? "running" : "paused" } as CSSProperties}
    >
      <div className="storytop">
        <div className="storybars" aria-hidden="true">
          {built.cards.map((c, i) => (
            <span key={c.name} className={i < at || (i === at && !running) ? "done" : ""}>
              {i === at && running && (
                <i key={at} style={{ animationDuration: `${STEP_S}s` }} onAnimationEnd={() => go(at + 1)} />
              )}
            </span>
          ))}
        </div>
        <button
          className={auto ? "storypause" : "storypause play"}
          aria-label={auto ? "Зупинити автоперехід" : "Увімкнути автоперехід"}
          aria-disabled={last}
          onClick={() => !last && setAuto(!auto)}
        >
          <span aria-hidden="true" />
        </button>
      </div>
      <div
        className="storycard"
        onPointerDown={() => setHeld(true)}
        onPointerUp={() => setHeld(false)}
        onPointerCancel={() => setHeld(false)}
        onPointerLeave={() => setHeld(false)}
      >
        <img key={at} src={built.urls[at]} alt={said} draggable={false} />
        <button className="storyprev" aria-label="Попередня картка" aria-disabled={at === 0} onClick={() => step(at - 1)} />
        <button className="storynext" aria-label="Наступна картка" aria-disabled={last} onClick={() => step(at + 1)} />
      </div>
      {/* Read out only when the cards no longer move on by themselves. */}
      <p className="sr" aria-live={running ? "off" : "polite"}>
        {said}
      </p>
    </div>
  );
}

// «Історія листопада»: the month as cards to look through and send to the chat, from where they go to Photos.
export function Wrap({ period }: { period: string }) {
  const view = useResource<WrapData>(`/api/wraps/${period}`);
  const back = () => goBack(albumHash(period));
  useBack(true, back);
  const { built, fresh, failed, retry } = useCards(view.data);
  const make = useAction();
  const save = useAction();
  const [at, setAt] = useState(0);
  const [quoteOn, setQuoteOn] = useState(false);
  const [sent, setSent] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const confirmTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(confirmTimer.current), []);

  const generate = () =>
    make.run(async () => {
      const made = await send<WrapData>("POST", `/api/wraps/${period}`);
      view.set(made);
      setAt(0);
      setSent(null);
      setQuoteOn(false);
    });
  // There is no history of versions, so making another asks once more before the old one is gone.
  const again = () => {
    if (!confirming) {
      setConfirming(true);
      confirmTimer.current = window.setTimeout(() => setConfirming(false), CONFIRM_MS);
      return;
    }
    window.clearTimeout(confirmTimer.current);
    setConfirming(false);
    generate();
  };

  const sendCards = (b: Built) =>
    save.run(async () => {
      setSent(null);
      const chosen = b.cards.filter((c) => c.name !== "quote" || quoteOn);
      const images = await Promise.all(chosen.map(async (c) => base64(await cardJpeg(c.svg, b.css))));
      const answer = await send<{ sent: number }>("POST", `/api/wraps/${period}/photos`, { images });
      setSent(answer.sent);
    });

  const data = view.data;
  const title = `Історія ${monthNameOf(month(period))}`;
  const shown = built ? Math.min(at, built.cards.length - 1) : 0;
  const onQuote = built?.cards[shown]?.name === "quote";
  const hasQuote = built?.cards.some((c) => c.name === "quote");
  const waiting = make.busy || (!!data?.spec && !fresh && !failed);

  return (
    <main className="screen detail wrap">
      <div className="detailbar">
        <BackBar onBack={back} />
        {data?.spec && (
          <button
            className="textbtn"
            onClick={again}
            disabled={make.busy}
            aria-label={confirming ? "Зібрати заново: поточна історія зникне" : "Зібрати історію заново"}
          >
            {make.busy ? "Збираю…" : confirming ? "Точно? Стара зникне" : "Ще раз"}
          </button>
        )}
      </div>
      {data ? (
        data.spec ? (
          built ? (
            <>
              <h1 className="sr">{title}</h1>
              <Story built={built} at={shown} go={setAt} busy={waiting} />
              {hasQuote && (
                // Its place is kept on every card, so the button below does not jump.
                <button
                  className="quoteswitch"
                  role="switch"
                  aria-checked={quoteOn}
                  onClick={() => setQuoteOn(!quoteOn)}
                  style={onQuote ? undefined : { visibility: "hidden" }}
                  tabIndex={onQuote ? undefined : -1}
                >
                  <span className="knob" aria-hidden="true" />
                  Додати цитату до карток
                </button>
              )}
              <div className="wrapacts">
                <button className="go" onClick={() => sendCards(built)} disabled={save.busy || waiting || failed}>
                  {save.busy ? "Надсилаю…" : "Надіслати картки в чат"}
                </button>
                {/* One line under the button: the hint, then what was sent, so nothing above it moves. */}
                <p className={sent !== null ? "hint sent" : "hint"} role="status">
                  {sent !== null
                    ? `${sent} ${plural(sent, "картка", "картки", "карток")} у чаті. Відкрий їх у Telegram і збережи у Фото.`
                    : "Звідти збережеш їх у Фото."}
                </p>
                {save.failed && <Problem>Не вдалося надіслати картки. Спробуй ще раз.</Problem>}
                {make.failed && <Problem>Не вдалося зібрати історію заново.</Problem>}
                {failed && <Failed what="нові картки" retry={retry} />}
              </div>
            </>
          ) : failed ? (
            <Failed what="картки" retry={retry} />
          ) : (
            <div role="status">
              <span className="sr">Збираю картки…</span>
              <Bars className="storyload" rows={[100]} />
            </div>
          )
        ) : (
          <section className="wrapintro">
            <h1>{title}</h1>
            <p>
              Кілька карток про твій {monthName(month(period))}: скільки збережено, що стало улюбленим, про що був
              місяць і один несподіваний факт. Картки можна надіслати в чат і зберегти у Фото.
            </p>
            <button className="go" onClick={generate} disabled={make.busy}>
              {make.busy ? "Збираю…" : "Зібрати історію"}
            </button>
            {make.failed && <Problem>Не вдалося зібрати історію. Спробуй ще раз.</Problem>}
          </section>
        )
      ) : view.status === "error" ? (
        view.error instanceof ApiError && view.error.status === 404 ? (
          <Empty>Історія з’явиться, коли за місяць буде збережено щонайменше 10 матеріалів.</Empty>
        ) : (
          <Failed what="історію" retry={view.reload} />
        )
      ) : (
        <div role="status">
          <span className="sr">Завантажую…</span>
          <Bars className="reading" rows={[50, 90, 70]} />
        </div>
      )}
    </main>
  );
}
