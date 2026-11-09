import type { ReactNode } from "react";
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
