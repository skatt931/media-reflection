import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import {
  ORDER,
  before,
  depth,
  goBack,
  hashOf,
  scrollKey,
  sectionHash,
  type Route,
  type Section,
} from "../router.ts";
import {
  DIM,
  PEEK,
  REST,
  SHRINK,
  SLIDE_MS,
  TAB_MS,
  ZOOM_MS,
  Run,
  centred,
  clamp,
  clearLook,
  inCard,
  reduced,
  rubber,
  setLook,
  type Look,
} from "./motion.ts";
import { PaneContext } from "./pane.ts";

// The screens move like the pages of a phone: the tabs slide sideways (and follow a swipe), a screen opened
// from the list slides over it, and a material opens out of its card and folds back into it. Only the screen
// on show is a pane at rest; during a move two panes are mounted, each scrolling on its own.

type Pane = { id: number; route: Route };
type Kind = "tab" | "push" | "pop";

const list = (section: Section): Route => ({ screen: "list", section });

function kindOf(from: Route, to: Route): Kind | null {
  if (from.screen === "list" && to.screen === "list") return from.section === to.section ? null : "tab";
  const by = depth(to) - depth(from);
  return by > 0 ? "push" : by < 0 ? "pop" : null;
}

// A swipe closes a material (back to the media list) and a diary entry (back to wherever it was opened from:
// the list, a search, the entry before it).
const closable = (route: Route) => route.screen === "material" || route.screen === "entry";
const homeOf = (route: Route) => sectionHash(route.section);
function underOf(route: Route): Route {
  if (route.screen !== "entry") return list(route.section);
  const prev = before();
  return prev && prev.section === "diary" && prev.screen !== "compose" ? prev : list("diary");
}

// Touches that start here belong to the thing touched, not to the swipe.
const OWN = "input, textarea, select, [contenteditable], .sheet, .scrim, .views, [data-noswipe]";
const LOCK = 10;
const velocityWindow = 100;

type Drag = {
  pointer: number;
  x0: number;
  y0: number;
  kind: "tab" | "back";
  locked: boolean;
  samples: { x: number; t: number }[];
  dx: number;
  dir: 1 | -1;
  neighbor?: Pane;
  under?: Pane;
  card?: DOMRect | null;
  top: Look;
  low: Look;
  veil: number;
};

function PaneView({
  pane,
  els,
  children,
}: {
  pane: Pane;
  els: Map<number, HTMLElement>;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    els.set(pane.id, ref.current!);
    return () => {
      els.delete(pane.id);
    };
  }, [els, pane.id]);
  const info = useMemo(() => ({ ref, key: scrollKey(pane.route) }), [pane.route]);
  return (
    <PaneContext value={info}>
      <div ref={ref} className={pane.route.screen === "list" ? "pane is-list" : "pane"}>
        {children}
      </div>
    </PaneContext>
  );
}

export function Stage({
  route,
  render,
  onReveal,
}: {
  route: Route;
  render: (route: Route) => ReactNode;
  // A list is being uncovered by a swipe: the tab bar comes back with it.
  onReveal: (on: boolean) => void;
}) {
  const [panes, setPanes] = useState<Pane[]>(() => [{ id: 1, route }]);
  const stage = useRef<HTMLDivElement>(null);
  const veil = useRef<HTMLDivElement>(null);
  const els = useRef(new Map<number, HTMLElement>()).current;
  const ids = useRef(1);
  const current = useRef<Pane>(panes[0]);
  const shown = useRef(hashOf(route));
  const run = useRef<Run | null>(null);
  const pending = useRef<(() => void) | null>(null);
  const drag = useRef<Drag | null>(null);
  const tap = useRef<{ id: string; card: DOMRect; at: number } | null>(null);
  const quiet = useRef(0);
  const reveal = useRef(onReveal);
  reveal.current = onReveal;

  const el = (pane: Pane) => els.get(pane.id)!;
  const size = () => ({ W: stage.current!.clientWidth, H: stage.current!.clientHeight });
  const moving = (on: boolean) => stage.current?.classList.toggle("moving", on);

  // The card of a material on the list, if it is on the screen: what the page opens from and folds into.
  const cardOf = (pane: Pane, id: string) => {
    const node = els.get(pane.id)?.querySelector<HTMLElement>(`[data-card="${CSS.escape(id)}"]`);
    const box = node?.getBoundingClientRect();
    return box && box.width > 0 && box.bottom > 0 && box.top < size().H ? box : null;
  };

  const end = (r: Run, rest: Pane[], after?: () => void) => {
    void r.done.then(() => {
      if (run.current !== r) return;
      // Dropping the old pane comes first and in the same breath as clearing the styles: no frame shows the
      // old screen back at rest.
      flushSync(() => setPanes(rest));
      r.cancel();
      run.current = null;
      moving(false);
      after?.();
    });
  };
  const begin = () => {
    const r = new Run();
    run.current = r;
    moving(true);
    return r;
  };
  const ms = (n: number) => (reduced() ? 0 : n);

  // ——— moves caused by the address ———
  const transition = (kind: Kind, from: Pane, to: Pane) => {
    const { W, H } = size();
    const r = begin();
    const [a, b] = [el(from), el(to)];
    if (kind === "tab") {
      const dir = ORDER.indexOf(to.route.section) > ORDER.indexOf(from.route.section) ? 1 : -1;
      r.tween(a, REST, { ...REST, x: -dir * W }, TAB_MS);
      r.tween(b, { ...REST, x: dir * W }, REST, TAB_MS);
    } else if (kind === "push") {
      const t = tap.current;
      const card =
        to.route.screen === "material" && t?.id === to.route.id && performance.now() - t.at < 1500
          ? t.card
          : null;
      if (card) {
        r.tween(a, REST, centred(SHRINK, W, H), ZOOM_MS);
        r.tween(b, inCard(card, W, H), REST, ZOOM_MS, { to: 1, delay: 0, duration: ZOOM_MS * 0.22 });
      } else {
        r.tween(a, REST, { ...REST, x: -PEEK * W }, SLIDE_MS);
        r.tween(b, { ...REST, x: W }, REST, SLIDE_MS);
        r.lift(b);
      }
      r.dim(veil.current, 0, DIM, card ? ZOOM_MS : SLIDE_MS);
    } else {
      // `to` is the list underneath, `from` the screen leaving.
      const card = from.route.screen === "material" ? cardOf(to, from.route.id) : null;
      if (card) {
        r.tween(a, REST, inCard(card, W, H), ZOOM_MS, {
          to: 0,
          delay: ZOOM_MS * 0.2,
          duration: ZOOM_MS * 0.45,
        });
        r.tween(b, centred(SHRINK, W, H), REST, ZOOM_MS);
      } else {
        r.tween(a, REST, { ...REST, x: W }, SLIDE_MS);
        r.tween(b, { ...REST, x: -PEEK * W }, REST, SLIDE_MS);
        r.lift(a);
      }
      r.dim(veil.current, DIM, 0, card ? ZOOM_MS : SLIDE_MS);
    }
    end(r, [to]);
  };

  useLayoutEffect(() => {
    const key = hashOf(route);
    // A swipe that already moved here has set `shown`: the address only catches up.
    if (key === shown.current) return;
    shown.current = key;
    drag.current = null;
    const from = current.current;
    const to: Pane = { id: ++ids.current, route };
    current.current = to;
    if (run.current) {
      run.current.cancel();
      run.current = null;
      moving(false);
    }
    clearLook(el(from));
    const kind = reduced() ? null : kindOf(from.route, route);
    if (!kind) {
      setPanes([to]);
      return;
    }
    setPanes(kind === "pop" ? [to, from] : [from, to]);
    pending.current = () => transition(kind, from, to);
  }, [route]);

  // Once both panes are in the page, the move starts: in the same frame, so nothing flashes.
  useLayoutEffect(() => {
    const start = pending.current;
    pending.current = null;
    start?.();
  }, [panes]);

  // ——— swipes ———
  const follow = (d: Drag, dx: number) => {
    const { W, H } = size();
    const top = el(current.current);
    d.dx = dx;
    if (d.kind === "tab") {
      if (!d.neighbor) {
        d.top = { ...REST, x: rubber(dx, W) };
        setLook(top, d.top);
        return;
      }
      const x = d.dir === 1 ? Math.min(dx, 0) : Math.max(dx, 0);
      d.top = { ...REST, x };
      d.low = { ...REST, x: x + d.dir * W };
      setLook(top, d.top);
      setLook(el(d.neighbor), d.low);
      return;
    }
    const p = clamp(dx / W, 0, 1);
    const x = Math.max(dx, 0);
    d.veil = DIM * (1 - p);
    if (d.card) {
      const s = 1 - 0.12 * p;
      d.top = { x: x + (W / 2) * (1 - s), y: (H / 2) * (1 - s), s, r: (28 * p) / s, b: 0, o: 1 };
      d.low = centred(SHRINK + (1 - SHRINK) * p, W, H);
    } else {
      d.top = { ...REST, x };
      d.low = { ...REST, x: -PEEK * W * (1 - p) };
    }
    setLook(top, d.top);
    setLook(el(d.under!), d.low);
    if (veil.current) veil.current.style.opacity = String(d.veil);
  };

  const lock = (d: Drag, dx: number) => {
    const cur = current.current;
    if (d.kind === "tab") {
      if (cur.route.screen !== "list") return false;
      d.dir = dx < 0 ? 1 : -1;
      const next = ORDER[ORDER.indexOf(cur.route.section) + d.dir];
      if (next) {
        d.neighbor = { id: ++ids.current, route: list(next) };
        flushSync(() => setPanes([cur, d.neighbor!]));
      }
    } else {
      if (dx < 0 || !closable(cur.route)) return false;
      d.under = { id: ++ids.current, route: underOf(cur.route) };
      flushSync(() => setPanes([d.under!, cur]));
      d.card = cur.route.screen === "material" ? cardOf(d.under, cur.route.id) : null;
      if (!d.card) el(cur).classList.add("lifted");
      if (d.under.route.screen === "list") reveal.current(true);
    }
    moving(true);
    return true;
  };

  const release = (d: Drag, cancelled: boolean) => {
    const { W, H } = size();
    const cur = current.current;
    const topEl = el(cur);
    const first = d.samples[0];
    const last = d.samples.at(-1);
    // Pixels per millisecond, positive to the right.
    const speed = first && last && last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;
    const r = new Run();
    run.current = r;
    const p = Math.abs(d.kind === "tab" ? (d.top.x ?? 0) : d.dx) / W;

    if (d.kind === "tab") {
      const toward = -d.dir * speed;
      const go = !cancelled && !!d.neighbor && (p > 0.33 || (toward > 0.4 && p > 0.03));
      if (!d.neighbor) {
        r.tween(topEl, d.top, REST, ms(300));
        end(r, [cur]);
        return;
      }
      const nb = el(d.neighbor);
      const time = ms(220 + 180 * (go ? 1 - p : p));
      if (go) {
        r.tween(topEl, d.top, { ...REST, x: -d.dir * W }, time);
        r.tween(nb, d.low, REST, time);
        current.current = d.neighbor;
        shown.current = hashOf(d.neighbor.route);
        location.hash = sectionHash(d.neighbor.route.section as Section);
        end(r, [d.neighbor]);
      } else {
        r.tween(topEl, d.top, REST, time);
        r.tween(nb, d.low, { ...REST, x: d.dir * W }, time);
        end(r, [cur]);
      }
      return;
    }

    const go = !cancelled && (p > 0.3 || (speed > 0.45 && d.dx > 0));
    const under = d.under!;
    const low = el(under);
    const lowRest = d.card ? centred(SHRINK, W, H) : { ...REST, x: -PEEK * W };
    const time = ms(240 + 220 * (go ? 1 - p : p));
    if (go) {
      if (d.card) {
        r.tween(topEl, d.top, inCard(d.card, W, H), time, { to: 0, delay: time * 0.2, duration: time * 0.5 });
      } else {
        r.tween(topEl, d.top, { ...REST, x: W }, time);
      }
      r.tween(low, d.low, REST, time);
      r.dim(veil.current, d.veil, 0, time);
      current.current = under;
      shown.current = hashOf(under.route);
      goBack(homeOf(cur.route));
      end(r, [under], () => reveal.current(false));
    } else {
      r.tween(topEl, d.top, REST, time);
      r.tween(low, d.low, lowRest, time);
      r.dim(veil.current, d.veil, DIM, time);
      end(r, [cur], () => {
        topEl.classList.remove("lifted");
        reveal.current(false);
      });
    }
  };

  useEffect(() => {
    const root = stage.current!;
    const down = (e: PointerEvent) => {
      if (e.pointerType === "mouse" || !e.isPrimary || run.current || drag.current) return;
      if ((e.target as Element).closest(OWN) || document.querySelector(".sheet")) return;
      const screen = current.current.route.screen;
      const kind = screen === "list" ? "tab" : closable(current.current.route) ? "back" : null;
      if (!kind) return;
      drag.current = {
        pointer: e.pointerId,
        x0: e.clientX,
        y0: e.clientY,
        kind,
        locked: false,
        samples: [],
        dx: 0,
        dir: 1,
        top: REST,
        low: REST,
        veil: 0,
      };
    };
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.pointer) return;
      const dx = e.clientX - d.x0;
      const dy = e.clientY - d.y0;
      if (!d.locked) {
        // Vertical intent: the page scrolls and the swipe stays out of it.
        if (Math.abs(dy) > LOCK && Math.abs(dy) > Math.abs(dx)) {
          drag.current = null;
          return;
        }
        if (Math.abs(dx) < LOCK || Math.abs(dx) < Math.abs(dy) * 1.4) return;
        if (!lock(d, dx)) {
          drag.current = null;
          return;
        }
        d.locked = true;
        root.setPointerCapture(e.pointerId);
      }
      d.samples.push({ x: e.clientX, t: e.timeStamp });
      while (d.samples.length > 2 && e.timeStamp - d.samples[0].t > velocityWindow) d.samples.shift();
      follow(d, dx);
    };
    const up = (e: PointerEvent, cancelled = false) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.pointer) return;
      drag.current = null;
      if (!d.locked) return;
      // The finger lifting after a swipe must not tap whatever lies under it.
      quiet.current = performance.now() + 120;
      release(d, cancelled);
    };
    const cancel = (e: PointerEvent) => up(e, true);
    const click = (e: MouseEvent) => {
      if (performance.now() < quiet.current) {
        e.stopPropagation();
        e.preventDefault();
      }
    };
    root.addEventListener("pointerdown", down);
    root.addEventListener("pointermove", move);
    root.addEventListener("pointerup", up);
    root.addEventListener("pointercancel", cancel);
    root.addEventListener("click", click, true);
    return () => {
      root.removeEventListener("pointerdown", down);
      root.removeEventListener("pointermove", move);
      root.removeEventListener("pointerup", up);
      root.removeEventListener("pointercancel", cancel);
      root.removeEventListener("click", click, true);
    };
    // The handlers read everything through refs: they are bound once.
  }, []);

  // A material opens out of the card that was touched: remember where it was.
  const touched = (e: ReactMouseEvent) => {
    const card = (e.target as Element).closest<HTMLElement>("[data-card]");
    if (card)
      tap.current = { id: card.dataset.card!, card: card.getBoundingClientRect(), at: performance.now() };
  };

  const views = panes.map((pane) => (
    <PaneView key={pane.id} pane={pane} els={els}>
      {render(pane.route)}
    </PaneView>
  ));
  // The veil goes between the two panes: darkens the lower one.
  if (views.length === 2)
    views.splice(1, 0, <div key="veil" className="veil" ref={veil} aria-hidden="true" />);

  return (
    <div className="stage" ref={stage} onClickCapture={touched}>
      {views}
    </div>
  );
}
