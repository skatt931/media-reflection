import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type PointerEvent,
  type RefObject,
} from "react";
import { get } from "./api.ts";
import { usePane } from "./stage/pane.ts";
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

// Back to a list lands where it was left: the position of every screen is kept by its address. Each screen
// scrolls in its own pane, so a pane that is only passing by cannot disturb the position of another.
const positions = new Map<string, number>();
export function useScrollMemory(ready: boolean) {
  const pane = usePane();
  useEffect(() => {
    const node = pane?.ref.current;
    if (!pane || !node) return;
    const save = () => positions.set(pane.key, node.scrollTop);
    node.addEventListener("scroll", save, { passive: true });
    return () => node.removeEventListener("scroll", save);
  }, [pane]);
  useLayoutEffect(() => {
    if (ready && pane?.ref.current) pane.ref.current.scrollTop = positions.get(pane.key) ?? 0;
  }, [ready, pane]);
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Focus stays inside an open dialog: Tab wraps from the last control to the first (and back), and when the dialog
// closes focus returns to what opened it. Declare it before the effect that focuses the dialog.
export function useFocusTrap(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const controls = () =>
      [...node.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const all = controls();
      if (!all.length) return e.preventDefault();
      const first = all[0];
      const last = all[all.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || active === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !node.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    };
    const onFocusIn = (e: FocusEvent) => {
      if (e.target instanceof Node && !node.contains(e.target)) (controls()[0] ?? node).focus();
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("focusin", onFocusIn);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("focusin", onFocusIn);
      if (opener?.isConnected) opener.focus();
    };
  }, [ref]);
}

const PULL_LOCK = 6;
const PULL_FAR = 0.3;
const PULL_FLICK = 0.5;
const PULL_MS = 200;

// A bottom sheet follows a finger that pulls its head down and leaves when it is pulled far enough or flicked;
// otherwise it settles back. Spread the result on the head (handle and title); taps on the buttons inside it stay taps.
export function useSheetPull(
  sheet: RefObject<HTMLElement | null>,
  scrim: RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  const latest = useRef(onClose);
  latest.current = onClose;
  const pull = useRef<{
    id: number;
    y0: number;
    active: boolean;
    samples: { y: number; t: number }[];
  } | null>(null);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const place = (y: number, ms = 0) => {
    const box = sheet.current;
    if (!box) return;
    box.style.animation = "none";
    box.style.transition = ms ? `transform ${ms}ms cubic-bezier(0.2, 0.8, 0.2, 1)` : "none";
    box.style.transform = `translateY(${y}px)`;
    const veil = scrim.current;
    if (veil) {
      veil.style.animation = "none";
      veil.style.transition = ms ? `opacity ${ms}ms linear` : "none";
      veil.style.opacity = String(Math.max(0, 1 - y / Math.max(1, box.offsetHeight)));
    }
  };

  return {
    onPointerDown(e: PointerEvent<HTMLElement>) {
      if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) return;
      pull.current = {
        id: e.pointerId,
        y0: e.clientY,
        active: false,
        samples: [{ y: e.clientY, t: e.timeStamp }],
      };
    },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      const p = pull.current;
      if (!p || e.pointerId !== p.id) return;
      const dy = e.clientY - p.y0;
      if (!p.active) {
        if (dy < -PULL_LOCK) pull.current = null;
        if (dy < PULL_LOCK) return;
        p.active = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      p.samples.push({ y: e.clientY, t: e.timeStamp });
      while (p.samples.length > 2 && e.timeStamp - p.samples[0].t > 100) p.samples.shift();
      place(Math.max(0, dy));
    },
    onPointerUp(e: PointerEvent<HTMLElement>) {
      const p = pull.current;
      pull.current = null;
      const box = sheet.current;
      if (!p || !p.active || e.pointerId !== p.id || !box) return;
      const dy = Math.max(0, e.clientY - p.y0);
      const first = p.samples[0];
      const speed = e.timeStamp > first.t ? (e.clientY - first.y) / (e.timeStamp - first.t) : 0;
      const away = dy > box.offsetHeight * PULL_FAR || speed > PULL_FLICK;
      if (!away) return place(0, PULL_MS);
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return latest.current();
      place(box.offsetHeight, PULL_MS);
      timer.current = window.setTimeout(() => latest.current(), PULL_MS);
    },
    onPointerCancel(e: PointerEvent<HTMLElement>) {
      if (pull.current?.id !== e.pointerId) return;
      const active = pull.current.active;
      pull.current = null;
      if (active) place(0, PULL_MS);
    },
  };
}
