// The moving parts of the Stage: where a pane looks to be (`Look`) and the animations between two looks.
// Only transform, clip-path and opacity are animated, so nothing is laid out again while it moves.

// x, y, s: translate and scale from the top-left corner. r, b: the rounded clip (radius, and how much of the
// bottom is cut off), both in the pane's own pixels. o: opacity.
export type Look = { x: number; y: number; s: number; r: number; b: number; o: number };
export const REST: Look = { x: 0, y: 0, s: 1, r: 0, b: 0, o: 1 };

// The curve of an iOS sheet: fast at first, a long soft landing, no overshoot.
export const EASE = "cubic-bezier(0.32, 0.72, 0, 1)";
export const SLIDE_MS = 420;
export const ZOOM_MS = 480;
export const TAB_MS = 340;
// How far the page underneath moves while another one covers it, how much it shrinks under a zoom, how dark it gets.
export const PEEK = 0.3;
export const SHRINK = 0.94;
export const DIM = 0.16;

export const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
export const clamp = (n: number, low: number, high: number) => Math.min(high, Math.max(low, n));

// A pull past the end of the tabs: it gives, then stiffens, like the scroll of an iOS list.
export function rubber(dx: number, width: number) {
  const pull = Math.abs(dx);
  return Math.sign(dx) * (1 - 1 / ((pull * 0.55) / width + 1)) * width;
}

const clip = (l: Look) => (l.r > 0 || l.b > 0 ? `inset(0px 0px ${l.b}px 0px round ${l.r}px)` : "none");
const pose = (l: Look) => ({
  transform: `translate3d(${l.x}px, ${l.y}px, 0) scale(${l.s})`,
  clipPath: `inset(0px 0px ${l.b}px 0px round ${l.r}px)`,
});

// A pane scaled about its centre, as a page does when another one opens over it.
export function centred(scale: number, width: number, height: number): Look {
  return { ...REST, s: scale, x: (width / 2) * (1 - scale), y: (height / 2) * (1 - scale) };
}

// The pane shrunk into a card on the screen: the page grows out of it (or folds back into it).
export function inCard(card: DOMRect, width: number, height: number): Look {
  const s = card.width / width;
  return { x: card.left, y: card.top, s, b: Math.max(0, height - card.height / s), r: 18 / s, o: 0 };
}

// Direct manipulation: a pane follows the finger by its style, with no animation in between.
export function setLook(el: HTMLElement, l: Look) {
  el.style.transformOrigin = "0 0";
  el.style.transform = pose(l).transform;
  el.style.clipPath = clip(l);
  el.style.opacity = String(l.o);
}

export function clearLook(el: HTMLElement) {
  el.style.transform = "";
  el.style.clipPath = "";
  el.style.opacity = "";
  el.style.transformOrigin = "";
}

export type Fade = { to: number; delay: number; duration: number };

// The animations of one move. They all end together; `done` says when, `cancel` drops them and leaves the
// panes as they are laid out.
export class Run {
  private anims: Animation[] = [];
  private els = new Set<HTMLElement>();
  private lifted = new Set<HTMLElement>();

  tween(el: HTMLElement, from: Look, to: Look, ms: number, fade?: Fade) {
    this.els.add(el);
    el.style.transformOrigin = "0 0";
    this.anims.push(el.animate([pose(from), pose(to)], { duration: ms, easing: EASE, fill: "both" }));
    if (fade)
      this.anims.push(
        el.animate([{ opacity: from.o }, { opacity: fade.to }], {
          duration: fade.duration,
          delay: fade.delay,
          easing: "ease-out",
          fill: "both",
        }),
      );
  }

  // The veil between the two panes darkens or clears.
  dim(el: HTMLElement | null, from: number, to: number, ms: number) {
    if (!el) return;
    this.els.add(el);
    this.anims.push(
      el.animate([{ opacity: from }, { opacity: to }], { duration: ms, easing: EASE, fill: "both" }),
    );
  }

  // A pane sliding over another casts a soft shadow on it.
  lift(el: HTMLElement) {
    el.classList.add("lifted");
    this.lifted.add(el);
  }

  get done(): Promise<void> {
    return Promise.all(this.anims.map((a) => a.finished)).then(
      () => undefined,
      () => undefined,
    );
  }

  cancel() {
    for (const a of this.anims) a.cancel();
    for (const el of this.els) clearLook(el);
    for (const el of this.lifted) el.classList.remove("lifted");
    this.anims = [];
    this.els.clear();
    this.lifted.clear();
  }
}
