import { useEffect, useState } from "react";
import { ApiError, get, mock } from "./api.ts";
import { Icon, type IconName } from "./icons.tsx";
import { sectionHash, useRoute, type Section } from "./router.ts";
import { initData } from "./telegram.ts";
import { Diary } from "./screens/Diary.tsx";
import { Entry } from "./screens/Entry.tsx";
import { Ideas } from "./screens/Ideas.tsx";
import { Media } from "./screens/Media.tsx";
import { Search } from "./screens/Search.tsx";

const sections: { id: Section; icon: IconName; title: string }[] = [
  { id: "diary", icon: "diary", title: "Щоденник" },
  { id: "media", icon: "library", title: "Медіатека" },
  { id: "ideas", icon: "ideas", title: "Ідеї" },
];

type Access = "checking" | "ok" | "outside" | "denied" | "failed";

function useAccess(): [Access, () => void] {
  const [access, setAccess] = useState<Access>(mock ? "ok" : initData ? "checking" : "outside");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!initData) return;
    let current = true;
    setAccess("checking");
    get("/api/me").then(
      () => current && setAccess("ok"),
      (e) => current && setAccess(e instanceof ApiError && e.status === 401 ? "denied" : "failed"),
    );
    return () => {
      current = false;
    };
  }, [attempt]);
  return [access, () => setAttempt((n) => n + 1)];
}

function Notice({ title, text, retry }: { title: string; text: string; retry?: () => void }) {
  return (
    <main className="notice">
      <h1>{title}</h1>
      <p>{text}</p>
      {retry && <button onClick={retry}>Спробувати ще раз</button>}
    </main>
  );
}

export function App() {
  const [access, retry] = useAccess();
  const route = useRoute();

  if (access === "outside")
    return (
      <Notice title="Відкрий у Telegram" text="Mini App працює лише всередині Telegram, у чаті з ботом." />
    );
  if (access === "denied")
    return <Notice title="Немає доступу" text="Цей Mini App лише для власника бота." />;
  if (access === "failed")
    return <Notice title="Не вдалося з'єднатися" text="Бот не відповів. Спробуй ще раз." retry={retry} />;
  if (access === "checking") return <Notice title="Завантаження…" text="" />;

  const tabs = route.screen === "list";
  return (
    <div className="app">
      {route.screen === "entry" ? (
        <Entry key={route.id} id={route.id} />
      ) : route.screen === "search" ? (
        <Search key={route.section} section={route.section} initial={route.q} />
      ) : route.section === "diary" ? (
        <Diary />
      ) : route.section === "ideas" ? (
        <Ideas />
      ) : (
        <Media />
      )}
      {tabs && (
        <nav className="tabs" aria-label="Розділи">
          {sections.map((s) => (
            <a key={s.id} href={sectionHash(s.id)} aria-current={s.id === route.section ? "page" : undefined}>
              <Icon name={s.icon} />
              {s.title}
            </a>
          ))}
        </nav>
      )}
    </div>
  );
}
