import { useEffect, useRef } from "react";
import { useAction, useDraft } from "../hooks.ts";
import { Problem, Sheet } from "../parts.tsx";

type Props = {
  title: string;
  placeholder: string;
  // Where the unsaved text is kept, so closing the sheet by accident loses nothing.
  draftKey: string;
  limit: number;
  save: (text: string) => Promise<unknown>;
  onClose: () => void;
  serif?: boolean;
};

// One text, one button: the sheet for a new idea and for a new impression.
export function TextSheet({ title, placeholder, draftKey, limit, save, onClose, serif = false }: Props) {
  const [text, setText, clear] = useDraft(draftKey);
  const { busy, failed, run } = useAction();
  const field = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    field.current?.focus();
  }, []);
  const empty = !text.trim();

  const submit = async () => {
    if (empty) return;
    const saved = await run(async () => {
      await save(text);
      return true;
    });
    if (saved) {
      clear();
      onClose();
    }
  };

  return (
    <Sheet title={title} onClose={onClose} className="textsheet" focus={false}>
      <textarea
        ref={field}
        className={serif ? "write serif" : "write"}
        rows={5}
        maxLength={limit}
        value={text}
        placeholder={placeholder}
        aria-label={title}
        onChange={(e) => setText(e.target.value)}
      />
      {failed && <Problem>Не вдалося зберегти. Текст лишився, спробуй ще раз.</Problem>}
      <button className="go" disabled={empty || busy} onClick={submit}>
        {busy ? "Зберігаю…" : "Зберегти"}
      </button>
    </Sheet>
  );
}
