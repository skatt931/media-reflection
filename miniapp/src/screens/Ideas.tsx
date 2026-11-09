import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { IdeaItem, IdeaList } from "../../../src/miniapp/data.ts";
import { send } from "../api.ts";
import { dayHeading, ideasLabel, shortDate } from "../format.ts";
import { useAction, useResource, useScrollMemory } from "../hooks.ts";
import { Icon } from "../icons.tsx";
import { Bars, Empty, Failed, Marked, Problem, UndoBar } from "../parts.tsx";
import { searchHash } from "../router.ts";
import { TextSheet } from "./TextSheet.tsx";

export const IDEA_LIMIT = 4_000;

// `pending` is the one whose request is in flight: its button shows the work instead of the icon.
type Toggle = { resolved: boolean; busy: boolean; pending: boolean; onClick: () => void };
const SLIDE_MS = 220;
const reduced = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

// A row (or a whole day) folds away to nothing, or unfolds when it arrives, instead of making the rest jump.
function Fold({ shut, appear = false, children }: { shut: boolean; appear?: boolean; children: ReactNode }) {
  const [closed, setClosed] = useState(appear);
  useEffect(() => {
    if (!appear) return;
    let second = 0;
    const first = requestAnimationFrame(() => (second = requestAnimationFrame(() => setClosed(false))));
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [appear]);
  return (
    <div className={shut || closed ? "fold shut" : "fold"}>
      <div>{children}</div>
    </div>
  );
}
// A resolved idea can also be deleted, after one more tap that asks again.
type Remove = { asking: boolean; busy: boolean; ask: () => void; cancel: () => void; confirm: () => void };

// With `toggle` the idea carries its button: «вирішено» for an open one, «повернути» for a resolved one.
// `stamp` replaces the time on the left (resolved ideas are not grouped by day).
export function Idea({
  idea,
  terms = [],
  stamp,
  toggle,
  remove,
}: {
  idea: IdeaItem;
  terms?: string[];
  stamp?: string;
  toggle?: Toggle;
  remove?: Remove;
}) {
  return (
    <div className={remove ? "idea has-action has-two" : toggle ? "idea has-action" : "idea"}>
      <time>{stamp ?? idea.time}</time>
      <p>
        <Marked text={idea.body} terms={terms} />
      </p>
      {toggle && (
        <button
          className="idea-act"
          disabled={toggle.busy}
          aria-busy={toggle.pending || undefined}
          aria-label={toggle.resolved ? "Повернути до ідей" : "Позначити вирішеною"}
          onClick={toggle.onClick}
        >
          {toggle.pending ? (
            <span className="spin" />
          ) : (
            <Icon name={toggle.resolved ? "undo" : "check"} size={22} />
          )}
        </button>
      )}
      {remove && (
        <button
          className="idea-act"
          disabled={remove.busy}
          aria-label="Видалити назавжди"
          onClick={remove.ask}
        >
          <Icon name="trash" size={22} />
        </button>
      )}
      {remove?.asking && (
        <div className="idea-ask" role="alertdialog" aria-label="Видалити ідею назавжди?">
          <span>Видалити назавжди?</span>
          <button className="danger" disabled={remove.busy} onClick={remove.confirm}>
            Видалити
          </button>
          <button disabled={remove.busy} onClick={remove.cancel}>
            Скасувати
          </button>
        </div>
      )}
    </div>
  );
}

export function Ideas() {
  const list = useResource<IdeaList>("/api/ideas");
  const [adding, setAdding] = useState(false);
  const action = useAction();
  const [asking, setAsking] = useState<number | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [leaving, setLeaving] = useState<number | null>(null);
  const [restored, setRestored] = useState<number | null>(null);
  const [undo, setUndo] = useState<IdeaItem | null>(null);
  useScrollMemory(list.status === "ok");
  const ideas = list.data?.ideas;
  const resolved = list.data?.resolved ?? [];
  const days = useMemo(() => {
    const out: { date: string; items: IdeaItem[] }[] = [];
    for (const idea of ideas ?? []) {
      if (out.at(-1)?.date === idea.date) out.at(-1)!.items.push(idea);
      else out.push({ date: idea.date, items: [idea] });
    }
    return out;
  }, [ideas]);

  const latest = useRef(list.data);
  latest.current = list.data;
  // The row folds away only once the server has taken the change; then the list is updated by hand (the answer
  // of a reload would arrive a moment later) and checked against the server in the background.
  const move = async (idea: IdeaItem, resolve: boolean) => {
    if (leaving === idea.id || pending !== null) return;
    setPending(idea.id);
    setUndo(null);
    const sent = await action.run(async () => {
      await send("POST", `/api/ideas/${idea.id}/${resolve ? "resolve" : "restore"}`);
      return true;
    });
    if (!sent) return setPending(null);
    if (resolve) {
      setLeaving(idea.id);
      if (!reduced()) await wait(SLIDE_MS);
    } else setRestored(idea.id);
    const data = latest.current;
    if (data) {
      const others = (rows: IdeaItem[]) => rows.filter((row) => row.id !== idea.id);
      list.set({
        ...data,
        ideas: resolve ? others(data.ideas) : [idea, ...others(data.ideas)].sort((a, b) => b.id - a.id),
        resolved: resolve ? [idea, ...others(data.resolved)] : others(data.resolved),
      });
    }
    setLeaving(null);
    setPending(null);
    if (resolve) setUndo(idea);
    list.reload();
  };
  const remove = (idea: IdeaItem): Remove => ({
    asking: asking === idea.id,
    busy: action.busy,
    ask: () => setAsking(idea.id),
    cancel: () => setAsking(null),
    confirm: () =>
      action.run(async () => {
        await send("POST", `/api/ideas/${idea.id}/delete`);
        setAsking(null);
        list.reload();
      }),
  });
  const toggle = (idea: IdeaItem, resolvedNow: boolean): Toggle => ({
    resolved: resolvedNow,
    busy: action.busy || pending !== null,
    pending: pending === idea.id,
    onClick: () => move(idea, !resolvedNow),
  });
  const total = (ideas?.length ?? 0) + resolved.length;

  return (
    <main className="screen ideas">
      <header className="top">
        <h1>Ідеї</h1>
        <div className="acts">
          {total > 0 && (
            <a href={searchHash("ideas")} aria-label="Пошук">
              <Icon name="search" />
            </a>
          )}
          <button aria-label="Нова ідея" onClick={() => setAdding(true)}>
            <Icon name="plus" />
          </button>
        </div>
      </header>
      {action.failed && <Problem>Не вдалося зберегти зміну. Спробуй ще раз.</Problem>}
      {ideas ? (
        <>
          {days.length ? (
            days.map(({ date, items }) => (
              <Fold
                key={date}
                shut={items.every((idea) => idea.id === leaving)}
                appear={items.every((idea) => idea.id === restored)}
              >
                <section>
                  <h2 className="grp">{dayHeading(date)}</h2>
                  {items.map((idea) => (
                    <Fold key={idea.id} shut={idea.id === leaving} appear={idea.id === restored}>
                      <Idea idea={idea} toggle={toggle(idea, false)} />
                    </Fold>
                  ))}
                </section>
              </Fold>
            ))
          ) : (
            <Empty>
              {resolved.length
                ? "Усі ідеї вирішені."
                : "Ідей поки немає. Натисни + угорі або запиши першу командою /idea у боті."}
            </Empty>
          )}
          {resolved.length > 0 && (
            <details className="resolved">
              <summary>
                <span>Вирішені</span>
                <span className="n">{resolved.length}</span>
                <Icon name="down" size={18} />
              </summary>
              {resolved.map((idea) => (
                <Idea
                  key={idea.id}
                  idea={idea}
                  stamp={shortDate(idea.date)}
                  toggle={toggle(idea, true)}
                  remove={remove(idea)}
                />
              ))}
            </details>
          )}
        </>
      ) : list.status === "error" ? (
        <Failed what="ідеї" retry={list.reload} />
      ) : (
        <Bars className="rows" rows={[85, 60, 90, 70]} />
      )}
      {undo && (
        <UndoBar
          key={undo.id}
          text="Ідею перенесено у вирішені"
          undo="Повернути"
          onUndo={() => {
            setUndo(null);
            move(undo, false);
          }}
          onDone={() => setUndo(null)}
        />
      )}
      {adding && (
        <TextSheet
          title="Нова ідея"
          placeholder="Одна думка, без підготовки"
          draftKey="draft:idea"
          limit={IDEA_LIMIT}
          onClose={() => setAdding(false)}
          save={async (body) => {
            await send("POST", "/api/ideas", { body });
            list.reload();
          }}
        />
      )}
    </main>
  );
}
