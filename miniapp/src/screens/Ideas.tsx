import { useMemo } from "react";
import type { IdeaItem, IdeaList } from "../../../src/miniapp/data.ts";
import { dayHeading } from "../format.ts";
import { useResource, useScrollMemory } from "../hooks.ts";
import { Icon } from "../icons.tsx";
import { Bars, Empty, Failed, Marked } from "../parts.tsx";
import { searchHash } from "../router.ts";

export function Idea({ idea, terms = [] }: { idea: IdeaItem; terms?: string[] }) {
  return (
    <div className="idea">
      <time>{idea.time}</time>
      <p>
        <Marked text={idea.body} terms={terms} />
      </p>
    </div>
  );
}

export function Ideas() {
  const list = useResource<IdeaList>("/api/ideas");
  useScrollMemory(list.status === "ok");
  const ideas = list.data?.ideas;
  const days = useMemo(() => {
    const out: { date: string; items: IdeaItem[] }[] = [];
    for (const idea of ideas ?? []) {
      if (out.at(-1)?.date === idea.date) out.at(-1)!.items.push(idea);
      else out.push({ date: idea.date, items: [idea] });
    }
    return out;
  }, [ideas]);

  return (
    <main className="screen ideas">
      <header className="top">
        <h1>Ідеї</h1>
        {!!ideas?.length && (
          <div className="acts">
            <a href={searchHash("ideas")} aria-label="Пошук">
              <Icon name="search" />
            </a>
          </div>
        )}
      </header>
      {ideas ? (
        ideas.length ? (
          days.map(({ date, items }) => (
            <section key={date}>
              <h2 className="grp">{dayHeading(date)}</h2>
              {items.map((idea) => (
                <Idea key={idea.id} idea={idea} />
              ))}
            </section>
          ))
        ) : (
          <Empty>Ідей поки немає. Запиши першу командою /idea у боті.</Empty>
        )
      ) : list.status === "error" ? (
        <Failed what="ідеї" retry={list.reload} />
      ) : (
        <Bars className="rows" rows={[85, 60, 90, 70]} />
      )}
    </main>
  );
}
