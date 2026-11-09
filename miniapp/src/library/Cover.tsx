import { useEffect, useRef, useState, type CSSProperties } from "react";
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

// A stable pale tint per material: identity, not data.
function hue(id: string) {
  let h = 0;
  for (const char of id) h = (h * 31 + char.charCodeAt(0)) % 360;
  return h;
}

const initial = (title: string) => title.match(/\p{L}|\p{N}/u)?.[0]?.toUpperCase() ?? "·";

// Loads only when it nears the screen. Without a cover (or when it fails) a tile with the first letter stays.
export function Cover({
  id,
  title,
  has,
  large,
}: {
  id: string;
  title: string;
  has: boolean;
  large?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [near, setNear] = useState(!has);
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!has || near) return;
    const node = box.current;
    if (!node || !("IntersectionObserver" in window)) return setNear(true);
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setNear(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [has, near]);

  useEffect(() => {
    if (!has || !near) return;
    let current = true;
    cover(id).then((url) => current && setSrc(url));
    return () => {
      current = false;
    };
  }, [id, has, near]);

  return (
    <div ref={box} className={large ? "cover hero" : "cover"} style={{ "--hue": hue(id) } as CSSProperties}>
      {src ? <img src={src} alt="" draggable={false} /> : <span aria-hidden="true">{initial(title)}</span>}
    </div>
  );
}
