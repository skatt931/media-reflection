import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useBack } from "./hooks.ts";
import { nativeBack } from "./telegram.ts";
import { Icon } from "./icons.tsx";

// A failure stays inside the block that failed.
export function Failed({ what, retry }: { what: string; retry: () => void }) {
  return (
    <div className="failed" role="alert">
      <p>Не вдалося завантажити {what}.</p>
      <button onClick={retry}>Повторити</button>
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}

// Flat bars at the size of the real text, no shimmer.
export function Bars({ rows, className = "" }: { rows: number[]; className?: string }) {
  return (
    <div className={`bars ${className}`} aria-hidden="true">
      {rows.map((width, i) => (
        <span key={i} style={{ width: `${width}%` }} />
      ))}
    </div>
  );
}

// Outside Telegram there is no native back button, so the screen carries its own.
export function BackBar({ onBack }: { onBack: () => void }) {
  if (nativeBack) return null;
  return (
    <button className="backbar" onClick={onBack}>
      <Icon name="back" size={20} />
      Назад
    </button>
  );
}

// The words of a search stay marked in what it found.
export function Marked({ text, terms }: { text: string; terms: string[] }) {
  if (!terms.length) return <>{text}</>;
  const letters = "[\\p{L}\\p{N}'’ʼ`]*";
  const any = terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/'/g, "['’ʼ`]")).join("|");
  const pattern = new RegExp(`((?:${any})${letters})`, "giu");
  return <>{text.split(pattern).map((piece, i) => (i % 2 ? <mark key={i}>{piece}</mark> : piece))}</>;
}

// Sheets are mounted at the root of the app, not in the pane of the screen that opened them: a pane is a
// stacking context on iOS, which would keep its sheet below the tab bar.
export const Overlay = ({ children }: { children: ReactNode }) =>
  createPortal(children, document.querySelector(".app") ?? document.body);

// A bottom sheet over the screen: Telegram's back button, Escape and a tap outside close it.
export function Sheet({
  title,
  onClose,
  className = "",
  focus = true,
  children,
}: {
  title: string;
  onClose: () => void;
  className?: string;
  // Off when a field inside takes the focus itself.
  focus?: boolean;
  children: ReactNode;
}) {
  useBack(true, onClose);
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus) sheet.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [focus, onClose]);
  return (
    <Overlay>
      <div className="scrim" onClick={onClose} />
      <div
        className={`sheet fsheet ${className}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        ref={sheet}
      >
        <div className="grab" aria-hidden="true" />
        <div className="sheet-top">
          <h2>{title}</h2>
        </div>
        {children}
      </div>
    </Overlay>
  );
}

// Said where a write failed; the text typed so far is still there.
export function Problem({ children }: { children: ReactNode }) {
  return (
    <p className="problem" role="alert">
      {children}
    </p>
  );
}

// A finished action says so above the tab bar and offers to take it back. It goes away on its own, and at once
// when a different screen takes over.
const UNDO_MS = 7_000;
export function UndoBar({
  text,
  undo,
  onUndo,
  onDone,
}: {
  text: string;
  undo: string;
  onUndo: () => void;
  onDone: () => void;
}) {
  const [leaving, setLeaving] = useState(false);
  const done = useRef(onDone);
  done.current = onDone;
  useEffect(() => {
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const wait = window.setTimeout(() => (still ? done.current() : setLeaving(true)), UNDO_MS);
    const leave = () => done.current();
    window.addEventListener("hashchange", leave);
    return () => {
      window.clearTimeout(wait);
      window.removeEventListener("hashchange", leave);
    };
  }, []);
  return (
    <Overlay>
      <div
        className={leaving ? "undo leaving" : "undo"}
        role="status"
        onAnimationEnd={() => leaving && done.current()}
      >
        <span>{text}</span>
        <button onClick={onUndo}>{undo}</button>
      </div>
    </Overlay>
  );
}
