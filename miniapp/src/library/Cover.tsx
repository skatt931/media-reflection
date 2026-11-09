import { useEffect, useRef, useState } from "react";
import { getBlob } from "../api.ts";

// One request per cover for the whole session; the blob URL is kept, so going back to a list is instant.
const loaded = new Map<string, Promise<string | null>>();

function cover(id: string) {
  let pending = loaded.get(id);
  if (!pending) {
    pending = getBlob(`/api/library/${encodeURIComponent(id)}/cover`).then(
      (blob) => URL.createObjectURL(blob),
      () => {
        loaded.delete(id);
        return null;
      },
    );
    loaded.set(id, pending);
  }
  return pending;
}

// A stable pale tint per item: identity, not data.
function hue(id: string) {
  let h = 0;
  for (const char of id) h = (h * 31 + char.charCodeAt(0)) % 360;
  return h;
}

const initial = (title: string) => title.match(/\p{L}|\p{N}/u)?.[0]?.toUpperCase() ?? "·";

type Props = { id: string; title: string; has: boolean; large?: boolean };

export function Cover({ id, title, has, large }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(!has);
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!has || seen) return;
    const node = box.current;
    if (!node || !("IntersectionObserver" in window)) return setSeen(true);
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [has, seen]);

  useEffect(() => {
    if (!has || !seen) return;
    let current = true;
    cover(id).then((url) => current && setSrc(url));
    return () => {
      current = false;
    };
  }, [id, has, seen]);

  return (
    <div
      ref={box}
      className={large ? "cover large" : "cover"}
      style={{ "--hue": hue(id) } as React.CSSProperties}
    >
      {src ? <img src={src} alt="" draggable={false} /> : <span aria-hidden="true">{initial(title)}</span>}
    </div>
  );
}
