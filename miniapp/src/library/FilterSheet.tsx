import { useEffect, type ReactNode } from "react";
import { ReactionIcon } from "./icons.tsx";
import { NO_REACTION, isFiltered, noFilters, type Filters, type Labels } from "./types.ts";

type Props = {
  filters: Filters;
  counts: { types: Record<string, number> };
  labels: Labels;
  shown: number;
  onChange: (filters: Filters) => void;
  onClose: () => void;
};

const toggle = (list: string[], value: string) =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset>
      <legend>{title}</legend>
      <div className="options">{children}</div>
    </fieldset>
  );
}

function Option({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="chip" aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}

export function FilterSheet({ filters, counts, labels, shown, onChange, onClose }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.body.classList.add("locked");
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("locked");
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const types = Object.entries(counts.types).sort((a, b) => b[1] - a[1]);
  return (
    <div className="sheet-wrap">
      <div className="backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Фільтри">
        <div className="sheet-head">
          <h2>Фільтри</h2>
          <button className="link" disabled={!isFiltered(filters)} onClick={() => onChange(noFilters)}>
            Скинути
          </button>
        </div>
        <div className="sheet-body">
          <Group title="Тип">
            {types.map(([type]) => (
              <Option
                key={type}
                on={filters.types.includes(type)}
                onClick={() => onChange({ ...filters, types: toggle(filters.types, type) })}
              >
                {labels.types[type] ?? type}
              </Option>
            ))}
          </Group>
          <Group title="Стан">
            {Object.entries(labels.statuses).map(([status, label]) => (
              <Option
                key={status}
                on={filters.statuses.includes(status)}
                onClick={() => onChange({ ...filters, statuses: toggle(filters.statuses, status) })}
              >
                {label}
              </Option>
            ))}
          </Group>
          <Group title="Реакція">
            {Object.entries(labels.reactions).map(([reaction, label]) => (
              <Option
                key={reaction}
                on={filters.reactions.includes(reaction)}
                onClick={() => onChange({ ...filters, reactions: toggle(filters.reactions, reaction) })}
              >
                <ReactionIcon reaction={reaction} filled={false} />
                {label}
              </Option>
            ))}
            <Option
              on={filters.reactions.includes(NO_REACTION)}
              onClick={() => onChange({ ...filters, reactions: toggle(filters.reactions, NO_REACTION) })}
            >
              Без реакції
            </Option>
          </Group>
        </div>
        <button className="button wide" onClick={onClose}>
          {shown > 0 ? `Показати ${shown}` : "Нічого не знайдено"}
        </button>
      </div>
    </div>
  );
}
