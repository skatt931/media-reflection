import { useEffect, useRef, type ReactNode } from "react";
import { NO_REACTION, type Labels } from "../../../src/miniapp/library-types.ts";
import { useBack } from "../hooks.ts";
import { Icon, type IconName } from "../icons.tsx";

export type Filters = { types: string[]; statuses: string[]; reactions: string[]; unreviewed: boolean };
export const noFilters: Filters = { types: [], statuses: [], reactions: [], unreviewed: false };
export const isFiltered = (f: Filters) =>
  f.types.length > 0 || f.statuses.length > 0 || f.reactions.length > 0 || f.unreviewed;
export const toggle = (list: string[], value: string) =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="fgrp">
      <legend>{title}</legend>
      <div className="opts">{children}</div>
    </fieldset>
  );
}

function Option({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="opt" aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}

type Props = {
  filters: Filters;
  types: string[];
  labels: Labels;
  shown: number;
  onChange: (filters: Filters) => void;
  onClose: () => void;
};

// Changes apply at once to the list behind the sheet; the button only closes it and says how many are left.
export function FilterSheet({ filters, types, labels, shown, onChange, onClose }: Props) {
  useBack(true, onClose);
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    sheet.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="scrim" onClick={onClose} />
      <div
        className="sheet fsheet"
        role="dialog"
        aria-modal="true"
        aria-label="Фільтри"
        tabIndex={-1}
        ref={sheet}
      >
        <div className="grab" aria-hidden="true" />
        <div className="sheet-top">
          <h2>Фільтри</h2>
          <button className="reset" disabled={!isFiltered(filters)} onClick={() => onChange(noFilters)}>
            Скинути
          </button>
        </div>
        <div className="fbody">
          <Group title="Тип">
            {types.map((type) => (
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
                <Icon name={reaction as IconName} size={17} />
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
        <button className="go" onClick={onClose}>
          {shown > 0 ? `Показати ${shown}` : "Нічого не знайдено"}
        </button>
      </div>
    </>
  );
}
