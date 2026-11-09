import type { Tile } from "../../../src/miniapp/collection-types.ts";
import { Cover } from "./Cover.tsx";
import { Icon } from "../icons.tsx";

// Up to four covers cut into one square: one whole, two halves, one tall and two short, or four. With `fill`
// the missing places stay open (an album that has not filled up yet).
export function Mosaic({ tiles, fill = false, label }: { tiles: Tile[]; fill?: boolean; label?: string }) {
  const shown = tiles.slice(0, 4);
  const open = fill ? 4 - shown.length : 0;
  const count = shown.length + open;
  return (
    <div className={`mosaic m${count}`} role={label ? "img" : undefined} aria-label={label}>
      {shown.map((tile) => (
        <Cover key={tile.id} id={tile.id} title={tile.title} has={tile.cover} />
      ))}
      {Array.from({ length: open }, (_, i) => (
        <span key={`open-${i}`} className="slot" aria-hidden="true" />
      ))}
      {count === 0 && (
        <span className="slot" aria-hidden="true">
          <Icon name="folder" size={26} />
        </span>
      )}
    </div>
  );
}
