import { useState } from "react";
import type { CollectionView } from "../../../src/miniapp/collection-types.ts";
import { ApiError, send } from "../api.ts";
import { materialsLabel } from "../format.ts";
import { useBack, useResource, useScrollMemory } from "../hooks.ts";
import { Icon } from "../icons.tsx";
import { BackBar, Bars, Empty, Failed } from "../parts.tsx";
import { goBack, sectionHash } from "../router.ts";
import { confirmAction } from "../telegram.ts";
import { CollectionName } from "./CollectionSheet.tsx";
import { Item } from "./Media.tsx";

// One collection: the materials in it as they look in the library, with your last words under each.
export function Collection({ id }: { id: string }) {
  const view = useResource<CollectionView>(`/api/collections/${encodeURIComponent(id)}`);
  const [naming, setNaming] = useState(false);
  const back = () => goBack(sectionHash("media"));
  useBack(true, back);
  useScrollMemory(view.status === "ok");
  const data = view.data;

  const remove = async () => {
    if (!data || !(await confirmAction(`Видалити добірку «${data.name}»? Матеріали лишаться в медіатеці.`)))
      return;
    try {
      await send("POST", `/api/collections/${encodeURIComponent(id)}/delete`);
      back();
    } catch {
      view.reload();
    }
  };

  return (
    <main className="screen detail">
      <div className="detailbar">
        <BackBar onBack={back} />
        {data && (
          <div className="barActs">
            <button className="textbtn" onClick={() => setNaming(true)}>
              <Icon name="edit" size={18} />
              Назва
            </button>
            <button className="textbtn danger" onClick={remove}>
              <Icon name="trash" size={18} />
              Видалити
            </button>
          </div>
        )}
      </div>
      {data ? (
        <>
          <header className="collhead">
            <h1>{data.name}</h1>
            <p>{materialsLabel(data.count)}</p>
          </header>
          {data.items.length ? (
            data.items.map((card) => <Item key={card.id} card={card} labels={data.labels} />)
          ) : (
            <Empty>У добірці ще нічого немає. Відкрий матеріал і натисни «У добірку».</Empty>
          )}
        </>
      ) : view.status === "error" ? (
        view.error instanceof ApiError && view.error.status === 404 ? (
          <Empty>Такої добірки немає. Можливо, її видалили.</Empty>
        ) : (
          <Failed what="добірку" retry={view.reload} />
        )
      ) : (
        <Bars className="rows" rows={[60, 90, 70, 85]} />
      )}
      {data && naming && (
        <CollectionName
          id={data.id}
          initial={data.name}
          onClose={() => setNaming(false)}
          onDone={() => {
            setNaming(false);
            view.reload();
          }}
        />
      )}
    </main>
  );
}
