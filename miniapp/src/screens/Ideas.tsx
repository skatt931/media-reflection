import { useMemo, useState } from "react";
import type { IdeaItem, IdeaList } from "../../../src/miniapp/data.ts";
import { send } from "../api.ts";
import { dayHeading, ideasLabel, shortDate } from "../format.ts";
import { useAction, useResource, useScrollMemory } from "../hooks.ts";
import { Icon } from "../icons.tsx";
import { Bars, Empty, Failed, Marked, Problem } from "../parts.tsx";
import { searchHash } from "../router.ts";
import { TextSheet } from "./TextSheet.tsx";

export const IDEA_LIMIT = 4_000;

type Toggle = { resolved: boolean; busy: boolean; onClick: () => void };
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
          aria-label={toggle.resolved ? "Повернути до ідей" : "Позначити вирішеною"}
          onClick={toggle.onClick}
        >
          <Icon name={toggle.resolved ? "undo" : "check"} size={22} />
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

  const move = (idea: IdeaItem, resolve: boolean) =>
    action.run(async () => {
      await send("POST", `/api/ideas/${idea.id}/${resolve ? "resolve" : "restore"}`);
      list.reload();
    });
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
    busy: action.busy,
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
              <section key={date}>
                <h2 className="grp">{dayHeading(date)}</h2>
                {items.map((idea) => (
                  <Idea key={idea.id} idea={idea} toggle={toggle(idea, false)} />
                ))}
              </section>
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
