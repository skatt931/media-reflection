import { useEffect, useState } from "react";
import { ApiError, get, mock } from "./api.ts";
import { Icon, type IconName } from "./icons.tsx";
import { sectionHash, useRoute, type Route, type Section } from "./router.ts";
import { Stage } from "./stage/Stage.tsx";
import { initData } from "./telegram.ts";
import { Album, Albums } from "./screens/Album.tsx";
import { Collection } from "./screens/Collection.tsx";
import { Compose } from "./screens/Compose.tsx";
import { Diary } from "./screens/Diary.tsx";
import { Entry } from "./screens/Entry.tsx";
import { Ideas } from "./screens/Ideas.tsx";
import { Material } from "./screens/Material.tsx";
import { Media } from "./screens/Media.tsx";
import { Search } from "./screens/Search.tsx";
import { Wrap } from "./screens/Wrap.tsx";

const sections: { id: Section; icon: IconName; title: string }[] = [
  { id: "ideas", icon: "ideas", title: "Ідеї" },
  { id: "media", icon: "library", title: "Медіатека" },
  { id: "diary", icon: "diary", title: "Щоденник" },
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

function screenOf(route: Route) {
  if (route.screen === "compose") return <Compose />;
  if (route.screen === "entry") return <Entry id={route.id} />;
  if (route.screen === "material") return <Material id={route.id} />;
  if (route.screen === "collection") return <Collection id={route.id} />;
  if (route.screen === "albums") return <Albums />;
  if (route.screen === "album") return <Album period={route.period} />;
  if (route.screen === "wrap") return <Wrap period={route.period} />;
  if (route.screen === "search") return <Search section={route.section} initial={route.q} />;
  if (route.section === "diary") return <Diary />;
  return route.section === "ideas" ? <Ideas /> : <Media />;
}

export function App() {
  const [access, retry] = useAccess();
  const route = useRoute();
  const [uncovering, setUncovering] = useState(false);

  if (access === "outside")
    return (
      <Notice title="Відкрий у Telegram" text="Mini App працює лише всередині Telegram, у чаті з ботом." />
    );
  if (access === "denied")
    return <Notice title="Немає доступу" text="Цей Mini App лише для власника бота." />;
  if (access === "failed")
    return <Notice title="Не вдалося з'єднатися" text="Бот не відповів. Спробуй ще раз." retry={retry} />;
  if (access === "checking") return <Notice title="Завантаження…" text="" />;

  // The tab bar belongs to the lists. It slides away when a screen opens over one and comes back with it.
  const tabs = route.screen === "list" || uncovering;
  return (
    <div className="app">
      <Stage route={route} render={screenOf} onReveal={setUncovering} />
      <nav className={tabs ? "tabs" : "tabs away"} aria-label="Розділи" aria-hidden={!tabs}>
        {sections.map((s) => (
          <a
            key={s.id}
            href={sectionHash(s.id)}
            tabIndex={tabs ? undefined : -1}
            aria-current={s.id === route.section ? "page" : undefined}
          >
            <Icon name={s.icon} />
            {s.title}
          </a>
        ))}
      </nav>
    </div>
  );
}
