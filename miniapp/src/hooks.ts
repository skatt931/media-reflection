import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { get } from "./api.ts";
import { claimBack } from "./telegram.ts";

type Resource<T> = { status: "loading" | "ok" | "error"; data?: T; error?: unknown };

// Answers already seen stay on screen while a fresh one loads, so going back to a list is instant.
const seen = new Map<string, unknown>();

export function useResource<T>(
  path: string | null,
): Resource<T> & { reload: () => void; set: (data: T) => void } {
  const [state, setState] = useState<Resource<T>>(() =>
    path && seen.has(path) ? { status: "ok", data: seen.get(path) as T } : { status: "loading" },
  );
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!path) return;
    let current = true;
    setState((was) => ({ status: "loading", data: seen.has(path) ? (seen.get(path) as T) : was.data }));
    get<T>(path).then(
      (data) => {
        seen.set(path, data);
        if (current) setState({ status: "ok", data });
      },
      (error) => current && setState((was) => ({ status: "error", data: was.data, error })),
    );
    return () => {
      current = false;
    };
  }, [path, attempt]);
  const reload = useCallback(() => setAttempt((n) => n + 1), []);
  // The answer to a write replaces what was shown, here and in the cache.
  const set = useCallback(
    (data: T) => {
      if (path) seen.set(path, data);
      setState({ status: "ok", data });
    },
    [path],
  );
  return { ...state, reload, set };
}

// A write in flight: one at a time, and a failure is shown where it happened instead of being lost.
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const working = useRef(false);
  const run = useCallback(async <T>(action: () => Promise<T>): Promise<T | undefined> => {
    if (working.current) return undefined;
    working.current = true;
    setBusy(true);
    setFailed(false);
    try {
      return await action();
    } catch {
      setFailed(true);
      return undefined;
    } finally {
      working.current = false;
      setBusy(false);
    }
  }, []);
  return { busy, failed, run };
}

// Unsaved text survives a closed sheet, a swiped-away app or a restart; it is cleared only by saving.
export function useDraft(key: string): [string, (text: string) => void, () => void] {
  const [text, setText] = useState(() => {
    try {
      return localStorage.getItem(key) ?? "";
    } catch {
      return "";
    }
  });
  const update = useCallback(
    (next: string) => {
      setText(next);
      try {
        if (next) localStorage.setItem(key, next);
        else localStorage.removeItem(key);
      } catch {
        // No storage: the text still lives on the screen.
      }
    },
    [key],
  );
  const clear = useCallback(() => update(""), [update]);
  return [text, update, clear];
}

export function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return debounced;
}

// While `active`, Telegram's back button (or the screen's own, outside Telegram) calls `handler`.
export function useBack(active: boolean, handler: () => void) {
  const latest = useRef(handler);
  latest.current = handler;
  useEffect(() => (active ? claimBack(() => latest.current()) : undefined), [active]);
}

// Back to a list lands where it was left: the position of every screen is kept by its address.
const positions = new Map<string, number>();
export function useScrollMemory(ready: boolean) {
  useEffect(() => {
    const key = location.hash;
    const save = () => location.hash === key && positions.set(key, window.scrollY);
    window.addEventListener("scroll", save, { passive: true });
    return () => window.removeEventListener("scroll", save);
  }, []);
  useLayoutEffect(() => {
    if (ready) window.scrollTo(0, positions.get(location.hash) ?? 0);
  }, [ready]);
}
