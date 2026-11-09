import { useEffect, useRef, useState } from "react";
import type { DiaryList, IdeaList } from "../../../src/miniapp/data.ts";
import { dayHeading, ideasLabel, records } from "../format.ts";
import { useBack, useDebounced, useResource } from "../hooks.ts";
import { Icon } from "../icons.tsx";
import { Bars, Failed } from "../parts.tsx";
import { goBack, searchHash, sectionHash } from "../router.ts";
import { DiaryRow } from "./Diary.tsx";
import { Idea } from "./Ideas.tsx";

// Words of the query are looked up independently of their endings, in the diary or in the ideas.
export function Search({ section, initial }: { section: "diary" | "ideas"; initial: string }) {
  const [text, setText] = useState(initial);
  const q = useDebounced(text.trim(), 250);
  const result = useResource<DiaryList & IdeaList>(q ? `/api/${section}?q=${encodeURIComponent(q)}` : null);
  const field = useRef<HTMLInputElement>(null);
  const leave = () => goBack(sectionHash(section));
  useBack(true, leave);
  useEffect(() => {
    field.current?.focus();
  }, []);
  // The query stays in the address, so coming back from an entry finds the same results.
  useEffect(() => {
    history.replaceState(null, "", searchHash(section, q));
  }, [section, q]);

  const terms = result.data?.terms ?? [];
  const found = section === "diary" ? result.data?.entries : result.data?.ideas;
  const pending = !!q && result.status === "loading";

  return (
    <main className="screen">
      <form className="field" role="search" onSubmit={(e) => e.preventDefault()}>
        <label className="input">
          <Icon name="search" size={20} />
          <input
            ref={field}
            type="search"
            value={text}
            placeholder="Пошук за словами"
            aria-label="Пошук за словами"
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
        <button type="button" className="cancel" onClick={leave}>
          Скасувати
        </button>
      </form>
      {q && result.status === "error" ? (
        <Failed what="результати" retry={result.reload} />
      ) : q && found ? (
        <div aria-busy={pending}>
          <p className="found" role="status">
            {found.length
              ? (section === "diary" ? records : ideasLabel)(found.length)
              : `Нічого не знайдено за «${q}».`}
          </p>
          {section === "diary"
            ? result.data?.entries.map((entry) => (
                <DiaryRow key={entry.id} entry={entry} terms={terms} withMonth />
              ))
            : result.data?.ideas.map((idea, i, all) => (
                <div key={idea.id}>
                  {(i === 0 || all[i - 1].date !== idea.date) && (
                    <h2 className="grp">{dayHeading(idea.date)}</h2>
                  )}
                  <Idea idea={idea} terms={terms} />
                </div>
              ))}
        </div>
      ) : pending ? (
        <Bars className="rows" rows={[90, 70, 85]} />
      ) : null}
    </main>
  );
}
