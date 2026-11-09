import { useEffect, useState } from "react";
import { ApiError, get } from "./api.ts";
import { initData } from "./telegram.ts";

const sections = [
  { id: "diary", icon: "📓", title: "Щоденник", hint: "Тут будуть записи щоденника." },
  { id: "media", icon: "📚", title: "Медіатека", hint: "Тут буде медіатека." },
  { id: "ideas", icon: "💡", title: "Ідеї", hint: "Тут будуть ідеї." },
] as const;
type SectionId = (typeof sections)[number]["id"];

const fromHash = (): SectionId => sections.find((s) => `#/${s.id}` === location.hash)?.id ?? "diary";

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

function useSection(): [SectionId, (id: SectionId) => void] {
  const [section, setSection] = useState(fromHash);
  useEffect(() => {
    const onChange = () => setSection(fromHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return [section, (id) => (location.hash = `#/${id}`)];
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
  const [section, open] = useSection();

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
      <main className="screen">
        <h1>{current.title}</h1>
        <p className="empty">{current.hint}</p>
      </main>
      <nav className="tabs">
        {sections.map((s) => (
          <button
            key={s.id}
            className={s.id === section ? "active" : ""}
            aria-current={s.id === section ? "page" : undefined}
            onClick={() => open(s.id)}
          >
            <span aria-hidden="true">{s.icon}</span>
            {s.title}
          </button>
        ))}
      </nav>
    </>
  );
}
