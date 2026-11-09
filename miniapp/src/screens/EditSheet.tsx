import { useState, type ReactNode } from "react";
import type { LibraryItem } from "../../../src/miniapp/library-types.ts";
import { send } from "../api.ts";
import { useAction } from "../hooks.ts";
import { Icon, type IconName } from "../icons.tsx";
import { Problem, Sheet } from "../parts.tsx";

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="fgrp">
      <legend>{title}</legend>
      <div className="opts">{children}</div>
    </fieldset>
  );
}

function Option({
  on,
  disabled,
  onClick,
  children,
}: {
  on: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className="opt" aria-pressed={on} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  );
}

// The same four things the bot lets you change by hand. Every tap is saved at once (and can be tapped back),
// so there is nothing to confirm; what is set here is locked from the AI.
export function EditSheet({
  item,
  onChange,
  onClose,
}: {
  item: LibraryItem;
  onChange: (item: LibraryItem) => void;
  onClose: () => void;
}) {
  const { busy, failed, run } = useAction();
  const [tag, setTag] = useState("");
  const save = (body: Record<string, unknown>) =>
    run(async () =>
      onChange(await send<LibraryItem>("PATCH", `/api/library/${encodeURIComponent(item.id)}`, body)),
    );

  const addTag = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = tag.trim();
    if (!value) return;
    if (item.tags.some((t) => t === value.toLowerCase())) return setTag("");
    await save({ tags: [...item.tags, value] });
    setTag("");
  };

  return (
    <Sheet title="Змінити" onClose={onClose}>
      <div className="fbody">
        <Group title="Тип">
          {Object.entries(item.labels.types).map(([type, label]) => (
            <Option
              key={type}
              on={item.type === type}
              disabled={busy}
              onClick={() => item.type !== type && save({ type })}
            >
              {label}
            </Option>
          ))}
        </Group>
        <Group title="Стан">
          {Object.entries(item.labels.statuses).map(([status, label]) => (
            <Option
              key={status}
              on={item.status === status}
              disabled={busy}
              onClick={() => item.status !== status && save({ status })}
            >
              {label}
            </Option>
          ))}
        </Group>
        <Group title="Реакція">
          {Object.entries(item.labels.reactions).map(([reaction, label]) => (
            <Option
              key={reaction}
              on={item.reaction === reaction}
              disabled={busy}
              onClick={() => save({ reaction: item.reaction === reaction ? null : reaction })}
            >
              <Icon name={reaction as IconName} size={17} />
              {label}
            </Option>
          ))}
          <Option
            on={item.reaction === null}
            disabled={busy}
            onClick={() => item.reaction !== null && save({ reaction: null })}
          >
            Без реакції
          </Option>
        </Group>
        <Group title="Теги">
          {item.tags.map((t) => (
            <button
              key={t}
              type="button"
              className="opt"
              disabled={busy}
              aria-label={`Прибрати тег ${t}`}
              onClick={() => save({ tags: item.tags.filter((x) => x !== t) })}
            >
              {t}
              <Icon name="close" size={14} />
            </button>
          ))}
        </Group>
        <form className="tagadd" onSubmit={addTag}>
          <label className="input">
            <input
              value={tag}
              maxLength={60}
              placeholder="Новий тег"
              aria-label="Новий тег"
              enterKeyHint="done"
              autoComplete="off"
              onChange={(e) => setTag(e.target.value)}
            />
          </label>
          <button type="submit" disabled={busy || !tag.trim()}>
            Додати
          </button>
        </form>
        {failed && <Problem>Не вдалося зберегти. Спробуй ще раз.</Problem>}
      </div>
      <button className="go" onClick={onClose}>
        Готово
      </button>
    </Sheet>
  );
}
