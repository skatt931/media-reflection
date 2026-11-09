import { useState } from "react";
import type { CollectionList } from "../../../src/miniapp/collection-types.ts";
import type { LibraryItem } from "../../../src/miniapp/library-types.ts";
import { send } from "../api.ts";
import { useAction, useResource } from "../hooks.ts";
import { Icon } from "../icons.tsx";
import { Problem, Sheet } from "../parts.tsx";

const NAME_LIMIT = 60;

// A name for a new collection, or a new name for one that exists.
export function CollectionName({
  id,
  initial = "",
  onClose,
  onDone,
}: {
  id?: string;
  initial?: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState(initial);
  const { busy, failed, run } = useAction();
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = name.trim();
    if (!value) return;
    const saved = await run(async () => {
      if (id) await send("PATCH", `/api/collections/${encodeURIComponent(id)}`, { name: value });
      else await send("POST", "/api/collections", { name: value });
      return true;
    });
    if (saved) onDone();
  };
  return (
    <Sheet title={id ? "Назва добірки" : "Нова добірка"} onClose={onClose} focus={false}>
      <form className="tagadd stacked" onSubmit={submit}>
        <label className="input">
          <input
            autoFocus
            value={name}
            maxLength={NAME_LIMIT}
            placeholder="Напр. «Дизайн мого застосунку»"
            aria-label="Назва добірки"
            enterKeyHint="done"
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        {failed && <Problem>Не вдалося зберегти. Можливо, така добірка вже є.</Problem>}
        <button className="go" type="submit" disabled={busy || !name.trim()}>
          {busy ? "Зберігаю…" : "Зберегти"}
        </button>
      </form>
    </Sheet>
  );
}

// «Додати в добірку»: every collection is a button that is on while the material is in it; a new one can be
// started on the spot. Each tap is saved at once and can be tapped back.
export function CollectionPicker({
  item,
  onChange,
  onClose,
}: {
  item: LibraryItem;
  onChange: (item: LibraryItem) => void;
  onClose: () => void;
}) {
  const list = useResource<CollectionList>("/api/collections");
  const { busy, failed, run } = useAction();
  const [name, setName] = useState("");
  const inside = new Set(item.collections);

  const toggle = (id: string) =>
    run(async () => {
      const has = inside.has(id);
      await send("POST", `/api/collections/${encodeURIComponent(id)}/${has ? "remove" : "items"}`, {
        itemId: item.id,
      });
      onChange({
        ...item,
        collections: has ? item.collections.filter((x) => x !== id) : [...item.collections, id],
      });
      list.reload();
    });

  const create = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = name.trim();
    if (!value) return;
    await run(async () => {
      const { id } = await send<{ id: string }>("POST", "/api/collections", { name: value });
      await send("POST", `/api/collections/${id}/items`, { itemId: item.id });
      onChange({ ...item, collections: [...item.collections, id] });
      setName("");
      list.reload();
    });
  };

  return (
    <Sheet title="У добірку" onClose={onClose}>
      <div className="fbody">
        {list.data?.collections.length ? (
          <div className="opts picks">
            {list.data.collections.map((c) => (
              <button
                key={c.id}
                type="button"
                className="opt"
                aria-pressed={inside.has(c.id)}
                disabled={busy}
                onClick={() => toggle(c.id)}
              >
                {inside.has(c.id) && <Icon name="check" size={17} />}
                {c.name}
              </button>
            ))}
          </div>
        ) : list.status === "error" ? (
          <Problem>Не вдалося завантажити добірки.</Problem>
        ) : list.data ? (
          <p className="empty">Добірок ще немає. Створи першу нижче.</p>
        ) : null}
        <form className="tagadd" onSubmit={create}>
          <label className="input">
            <input
              value={name}
              maxLength={NAME_LIMIT}
              placeholder="Нова добірка"
              aria-label="Нова добірка"
              enterKeyHint="done"
              autoComplete="off"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <button type="submit" disabled={busy || !name.trim()}>
            Створити
          </button>
        </form>
        {failed && <Problem>Не вдалося зберегти. Можливо, така добірка вже є.</Problem>}
      </div>
      <button className="go" onClick={onClose}>
        Готово
      </button>
    </Sheet>
  );
}
