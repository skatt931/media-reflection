import { useEffect, useState } from "react";
import { ApiError, get } from "./api.ts";
import { Detail } from "./library/Detail.tsx";
import { DiaryTabIcon, IdeasTabIcon, MediaTabIcon } from "./library/icons.tsx";
import { Library } from "./library/Library.tsx";
import { initData, webApp } from "./telegram.ts";

const sections = [
  { id: "diary", icon: <DiaryTabIcon />, title: "Щоденник", hint: "Тут будуть записи щоденника." },
  { id: "media", icon: <MediaTabIcon />, title: "Медіатека", hint: "" },
  { id: "ideas", icon: <IdeasTabIcon />, title: "Ідеї", hint: "Тут будуть ідеї." },
] as const;
type SectionId = (typeof sections)[number]["id"];

// #/media is the list, #/media/<id> a material.
type Route = { section: SectionId; id: string | null };

function fromHash(): Route {
  const [, name, id] = location.hash.split("/");
  const section = sections.find((s) => s.id === name)?.id ?? "diary";
  let material: string | null = null;
  try {
    material = section === "media" && id ? decodeURIComponent(id) : null;
  } catch {
    // A malformed id is shown as the list.
  }
  return { section, id: material };
}

type Access = "checking" | "ok" | "outside" | "denied" | "failed";

function useAccess(): [Access, () => void] {
  const [access, setAccess] = useState<Access>(initData ? "checking" : "outside");
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

function useRoute(): [Route, (id: SectionId) => void] {
  const [route, setRoute] = useState(fromHash);
  useEffect(() => {
    const onChange = () => setRoute(fromHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return [route, (id) => (location.hash = `#/${id}`)];
}

// Telegram's own back button, shown only on a material.
function useBackButton(visible: boolean) {
  useEffect(() => {
    const button = webApp?.BackButton;
    if (!button || !visible) return;
    const back = () => (history.length > 1 ? history.back() : (location.hash = "#/media"));
    button.show();
    button.onClick(back);
    return () => {
      button.offClick(back);
      button.hide();
    };
  }, [visible]);
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
  const [{ section, id }, open] = useRoute();
  useBackButton(access === "ok" && id !== null);

  if (access === "outside")
    return (
      <Notice title="Відкрий у Telegram" text="Mini App працює лише всередині Telegram, у чаті з ботом." />
    );
  if (access === "denied")
    return <Notice title="Немає доступу" text="Цей Mini App лише для власника бота." />;
  if (access === "failed")
    return <Notice title="Не вдалося з'єднатися" text="Бот не відповів. Спробуй ще раз." retry={retry} />;
  if (access === "checking") return <Notice title="Завантаження…" text="" />;

  const current = sections.find((s) => s.id === section)!;
  return (
    <>
      {section === "media" && <Library hidden={id !== null} />}
      {section === "media" && id !== null && <Detail id={id} />}
      {section !== "media" && (
        <main className="screen">
          <h1>{current.title}</h1>
          <p className="empty">{current.hint}</p>
        </main>
      )}
      {id === null && (
        <nav className="tabs">
          {sections.map((s) => (
            <button
              key={s.id}
              className={s.id === section ? "active" : ""}
              aria-current={s.id === section ? "page" : undefined}
              onClick={() => open(s.id)}
            >
              {s.icon}
              {s.title}
            </button>
          ))}
        </nav>
      )}
    </>
  );
}
