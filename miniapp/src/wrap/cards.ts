import type { Tile } from "../../../src/miniapp/collection-types.ts";
import type { WrapFact, WrapFacts, WrapSpec } from "../../../src/miniapp/wrap-types.ts";
import { capital, monthName, plural } from "../format.ts";

// The wrap's cards as SVG strings, 1080×1920 (design/mockups/wrap.js). The same string is shown on the screen
// and drawn into the saved JPEG, so what you see is what you save. SVG <text> does not wrap, so text is
// measured on a canvas and broken into lines here.
export const W = 1080;
export const H = 1920;
const M = 96; // outer margin
const FOOT = H - 300; // last baseline above the footer
const SANS = '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif';
const SERIF = '"Literata", Georgia, serif';
// Replaced by the embedded font when the card is drawn; the font must travel inside the SVG image.
export const FONT_SLOT = "/*FONT*/";

export type Palette = { bg: string; ink: string; accent: string };
export type CardName = "cover" | "number" | "loved" | "topics" | "fact" | "rhythm" | "quote";
// `alt` says in words what the card shows: the card itself is only a picture.
export type Card = { name: CardName; svg: string; alt: string };
// Cover images as data URLs by material id: an SVG image may not load anything from outside itself.
export type Images = Map<string, string>;

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// Typographic apostrophe, and a dash that never ends a line.
const tidy = (s: string | null | undefined) =>
  String(s ?? "")
    .replace(/'/g, "’")
    .replace(/ — /g, " — ");
const units = (n: number, [one, few, many]: [string, string, string]) => plural(n, one, few, many);

// Text is measured by SVG itself, in a hidden <svg> on the page: a canvas picks a narrower cut of the system
// font than SVG does, and the lines it allows would run past the margin on the card.
const SVG_NS = "http://www.w3.org/2000/svg";
let probe: SVGTextElement | null = null;
const widths = new Map<string, number>();
function width(s: string, size: number, weight = 400, family = SANS) {
  const key = `${weight}|${size}|${family}|${s}`;
  const known = widths.get(key);
  if (known !== undefined) return known;
  if (!probe) {
    const box = document.createElementNS(SVG_NS, "svg");
    box.setAttribute("aria-hidden", "true");
    box.setAttribute("style", "position:absolute;width:0;height:0;overflow:hidden;visibility:hidden");
    probe = document.createElementNS(SVG_NS, "text");
    box.append(probe);
    document.body.append(box);
  }
  probe.setAttribute("font-family", family);
  probe.setAttribute("font-size", String(size));
  probe.setAttribute("font-weight", String(weight));
  probe.textContent = s;
  const w = probe.getComputedTextLength();
  widths.set(key, w);
  return w;
}

type Font = { size: number; family?: string; weight?: number; width?: number; maxLines?: number };

// One line that fits the width, cut with "…" when it does not.
function clip(content: string, { size, family = SANS, weight = 400, width: room = W - 2 * M }: Font) {
  const max = room * SPARE;
  let s = tidy(content);
  if (width(s, size, weight, family) <= max) return s;
  while (s.length > 1 && width(`${s.trimEnd()}…`, size, weight, family) > max) s = s.slice(0, -1);
  return `${s.trimEnd()}…`;
}

// A small preview rasterises text a little wider than the full-size card, so lines break with some room to spare.
const SPARE = 0.97;

// Lines of text that fit the width; past maxLines the last line ends with "…".
function wrap(content: string, font: Font) {
  const { size, family = SANS, weight = 400, maxLines = Infinity } = font;
  const max = (font.width ?? W - 2 * M) * SPARE;
  const lines: string[] = [];
  let line = "";
  // Plain spaces only: the no-break space keeps a dash on the line with its word.
  for (const word of tidy(content).split(/[ \t\n]+/).filter(Boolean)) {
    const next = line ? `${line} ${word}` : word;
    if (line && width(next, size, weight, family) > max) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  kept[maxLines - 1] = clip(`${kept[maxLines - 1]}…`, font);
  return kept;
}

type TextOptions = Font & {
  x?: number;
  y: number;
  fill: string;
  leading?: number;
  tracking?: number;
  opacity?: number;
  anchor?: "start" | "end";
};

// A block of wrapped text, and the baseline of its last line.
function text(content: string, o: TextOptions) {
  const { x = M, y, size, family = SANS, weight = 400, leading = 1.25, tracking = 0, opacity = 1 } = o;
  const lines = wrap(content, o);
  const step = Math.round(size * leading);
  const svg = lines
    .map(
      (l, i) =>
        `<text x="${x}" y="${y + i * step}" font-family='${family}' font-size="${size}" font-weight="${weight}" letter-spacing="${tracking}" fill="${o.fill}" fill-opacity="${opacity}" text-anchor="${o.anchor ?? "start"}">${esc(l)}</text>`,
    )
    .join("");
  return { svg, end: y + (lines.length - 1) * step };
}

// Text that ends at a given baseline, so secondary lines sit near the foot of the card.
function textUp(content: string, o: Omit<TextOptions, "y"> & { bottom: number }) {
  const n = wrap(content, o).length;
  return text(content, { ...o, y: o.bottom - (n - 1) * Math.round(o.size * (o.leading ?? 1.25)) });
}

// A line the AI wrote: the system face like everything that is not yours, and a small "AI" after it.
// The mark rides on the last line as a <tspan>, so the renderer itself puts it after the words; a measured
// position drifts when the canvas and the SVG pick different cuts of the system font.
const CAPTION = 46;
const CAPTION_STEP = Math.round(CAPTION * 1.32);
function aiCaption(content: string, y: number, fill: string) {
  const lines = wrap(content, { size: CAPTION, maxLines: 3 });
  const mark = `<tspan dx="24" font-size="36" font-weight="600" fill-opacity="0.8">AI</tspan>`;
  // Generous room for the mark, so it never runs into the margin.
  const fits = width(lines.at(-1)!, CAPTION) + 130 < W - 2 * M;
  const row = (l: string, i: number, extra = "") =>
    `<text x="${M}" y="${y + i * CAPTION_STEP}" font-family='${SANS}' font-size="${CAPTION}" fill="${fill}">${esc(l)}${extra}</text>`;
  const body = lines.map((l, i) => row(l, i, fits && i === lines.length - 1 ? mark : "")).join("");
  const end = y + (lines.length - 1) * CAPTION_STEP;
  const own = `<text x="${M}" y="${end + 60}" font-family='${SANS}' font-size="36" font-weight="600" fill="${fill}" fill-opacity="0.8">AI</text>`;
  return { svg: body + (fits ? "" : own), end: fits ? end : end + 60 };
}
function aiCaptionUp(content: string, bottom: number, fill: string) {
  const n = wrap(content, { size: CAPTION, maxLines: 3 }).length;
  return aiCaption(content, bottom - (n - 1) * CAPTION_STEP, fill).svg;
}

// The largest size (up to max) at which one line fits the width.
function fit(content: string, max: number, room = W - 2 * M, weight = 800, tracking = -0.05) {
  const w = width(content, max, weight) + tracking * max * content.length;
  return Math.min(max, Math.floor((max * room) / w));
}

// ---- Colour: a tile too close to the field is pushed away from it, so it never melts into the card.

const rgb = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hex = (c: number[]) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
function luminance(h: string) {
  const [r, g, b] = rgb(h).map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
function apart(color: string, bg: string) {
  if (contrast(color, bg) >= 1.4) return color;
  const target = luminance(bg) > 0.4 ? [0, 0, 0] : [255, 255, 255];
  let c = rgb(color);
  for (let i = 0; i < 6 && contrast(hex(c), bg) < 1.4; i++) c = c.map((v, k) => v + (target[k] - v) * 0.15);
  return hex(c);
}
function hsl(h: number, s: number, l: number) {
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
  };
  return hex([f(0), f(8), f(4)]);
}
// The same stable tint per material as the library list.
function hue(id: string) {
  let h = 0;
  for (const char of id) h = (h * 31 + char.charCodeAt(0)) % 360;
  return h;
}
const initial = (title: string) => title.match(/\p{L}|\p{N}/u)?.[0]?.toUpperCase() ?? "·";

// The cover when there is one, else the tinted tile with the first letter, as in the library.
function tile(t: Tile, x: number, y: number, size: number, bg: string, images: Images) {
  const color = apart(hsl(hue(t.id), 0.38, 0.72), bg);
  const base = `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${color}"/>`;
  const image = images.get(t.id);
  if (image)
    return `${base}<image href="${image}" x="${x}" y="${y}" width="${size}" height="${size}" preserveAspectRatio="xMidYMid slice"/>`;
  return `${base}<text x="${x + size * 0.1}" y="${y + size * 0.86}" font-family='${SANS}' font-size="${Math.round(size * 0.62)}" font-weight="700" letter-spacing="${-size * 0.02}" fill="${hsl(hue(t.id), 0.3, 0.3)}">${esc(initial(t.title))}</text>`;
}

// Tiles across the full width, laid out for how many there are. Returns the SVG and its height.
function mosaic(tiles: Tile[], top: number, bg: string, images: Images, v = 0) {
  const full = W - 2 * M;
  const gap = 24;
  const out: string[] = [];
  const n = Math.min(tiles.length, 6);
  const put = (t: Tile, x: number, y: number, s: number) => out.push(tile(t, x, y, s, bg, images));
  let h = 0;
  if (n === 0) return { svg: "", h: 0 };
  if (n === 1) {
    put(tiles[0], M, top, full);
    h = full;
  } else if (n === 2) {
    const s = (full - gap) / 2;
    tiles.slice(0, 2).forEach((t, i) => put(t, M + i * (s + gap), top, s));
    h = s;
  } else if (n === 4 || (n >= 5 && v)) {
    // One large tile and a column of small ones exactly as tall as it.
    const small = (full - 4 * gap) / 5;
    const big = full - small - gap;
    put(tiles[0], M, top, big);
    tiles.slice(1, Math.min(n, 5)).forEach((t, i) => put(t, M + big + gap, top + i * (small + gap), small));
    h = big;
  } else if (n === 3) {
    const s = (full - gap) / 2;
    put(tiles[0], M, top, s * 2 + gap);
    h = s * 2 + gap;
    tiles.slice(1, 3).forEach((t, i) => put(t, M + i * (s + gap), top + h + gap, s));
    h += gap + s;
  } else if (n === 5) {
    // Two on top, three below, so no slot is left empty.
    const s2 = (full - gap) / 2;
    const s3 = (full - 2 * gap) / 3;
    tiles.slice(0, 2).forEach((t, i) => put(t, M + i * (s2 + gap), top, s2));
    tiles.slice(2, 5).forEach((t, i) => put(t, M + i * (s3 + gap), top + s2 + gap, s3));
    h = s2 + gap + s3;
  } else {
    const s = (full - 2 * gap) / 3;
    tiles.slice(0, 6).forEach((t, i) => put(t, M + (i % 3) * (s + gap), top + Math.floor(i / 3) * (s + gap), s));
    h = 2 * s + gap;
  }
  return { svg: out.join(""), h };
}

// A mosaic too tall for its room is scaled down against the right margin, answering the text on the left.
function fitted(m: { svg: string; h: number }, top: number, room: number) {
  const scale = Math.min(1, room / m.h);
  const x = W - M - (W - 2 * M) * scale;
  return {
    svg: `<g transform="translate(${x} ${top}) scale(${scale})"><g transform="translate(${-M} ${-top})">${m.svg}</g></g>`,
    h: m.h * scale,
  };
}

const svg = (p: Palette, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><style>${FONT_SLOT}</style><rect width="${W}" height="${H}" fill="${p.bg}"/>${body}</svg>`;

// ---- What the cards say, put together from the facts and the stored spec.

const monthTitle = (period: string) => capital(monthName(Number(period.slice(5)) - 1));
const monthIn = ["січні", "лютому", "березні", "квітні", "травні", "червні", "липні", "серпні", "вересні", "жовтні", "листопаді", "грудні"];
const genitive = ["січня", "лютого", "березня", "квітня", "травня", "червня", "липня", "серпня", "вересня", "жовтня", "листопада", "грудня"];
const dayMonth = (iso: string) => `${Number(iso.slice(8, 10))} ${genitive[Number(iso.slice(5, 7)) - 1]}`;

function previousIn(period: string) {
  const m = Number(period.slice(5));
  return monthIn[(m + 10) % 12];
}

export type Story = {
  facts: WrapFacts;
  spec: WrapSpec;
  palette: Palette[];
  images: Images;
};

function footer(p: Palette, period: string) {
  return `<text x="${M}" y="${H - 120}" font-family='${SANS}' font-size="40" font-weight="650" fill="${p.ink}">Медіатека</text>
<text x="${W - M}" y="${H - 120}" font-family='${SANS}' font-size="40" fill="${p.ink}" fill-opacity="0.8" text-anchor="end">${monthName(Number(period.slice(5)) - 1)} ${period.slice(0, 4)}</text>`;
}

type Template = (s: Story, p: Palette, v: number) => { svg: string; alt: string } | null;
const sentence = (...parts: (string | null | undefined | false)[]) =>
  parts
    .filter(Boolean)
    .map((x) => tidy(x as string).replace(/[.!?…]?$/, (m) => m || "."))
    .join(" ");

const templates: Record<CardName, Template> = {
  cover({ facts, spec, images }, p, v) {
    const month = monthTitle(facts.period);
    const big = fit(month, 280);
    const mood = spec.mood ?? (facts.topType ? `Найбільше — ${facts.topType.label.toLowerCase()}` : "Твій місяць");
    const title = (base: number) =>
      `<text x="${M - 6}" y="${base}" font-family='${SANS}' font-size="${big}" font-weight="800" letter-spacing="${-0.05 * big}" fill="${p.ink}">${esc(month)}</text>`;
    const words = (base: number) => {
      const m = text(mood, { y: base + 140, size: 76, weight: 650, fill: p.accent, leading: 1.1, tracking: -1.5, maxLines: 2 });
      if (!spec.moodLine) return { svg: m.svg, end: m.end };
      const c = aiCaption(spec.moodLine, m.end + 96, p.ink);
      return { svg: m.svg + c.svg, end: c.end };
    };
    const tiles = facts.loved.length ? facts.loved : facts.latest;
    if (v) {
      const m = fitted(mosaic(tiles.slice(0, 5), 300, p.bg, images, 1), 300, 720);
      const base = 300 + m.h + 290;
      return { svg: svg(p, m.svg + title(base) + words(base).svg + footer(p, facts.period)), alt: sentence(month, mood, spec.moodLine) };
    }
    const top = words(420);
    const m = fitted(mosaic(tiles.slice(0, 6), top.end + 110, p.bg, images), top.end + 110, FOOT - (top.end + 110));
    return { svg: svg(p, title(420) + top.svg + m.svg + footer(p, facts.period)), alt: sentence(month, mood, spec.moodLine) };
  },

  number({ facts, spec }, p, v) {
    const n = String(facts.saved);
    // Two digits may run off the edge on purpose; longer numbers are fitted inside the margins.
    const bleed = v && n.length <= 2;
    const size = bleed ? 900 : fit(n, 900, W - 2 * M + 30);
    const big = bleed
      ? `<text x="${W + 40}" y="1290" font-family='${SANS}' font-size="${size}" font-weight="800" letter-spacing="${-0.06 * size}" fill="${p.accent}" text-anchor="end">${n}</text>`
      : `<text x="${M - size * 0.04}" y="${v ? 1290 : 940}" font-family='${SANS}' font-size="${size}" font-weight="800" letter-spacing="${-0.06 * size}" fill="${p.accent}">${n}</text>`;
    const head = text(`${units(facts.saved, ["матеріал", "матеріали", "матеріалів"])} за місяць`, {
      y: v ? 330 : 1110,
      size: 80,
      weight: 700,
      fill: p.ink,
      tracking: -2,
    });
    const parts: string[] = [];
    if (facts.previous !== null) {
      const d = facts.saved - facts.previous;
      parts.push(
        d === 0
          ? `Стільки ж, як у ${previousIn(facts.period)}.`
          : `На ${Math.abs(d)} ${d > 0 ? "більше" : "менше"}, ніж у ${previousIn(facts.period)}.`,
      );
    }
    if (facts.topType) parts.push(`Найбільше — ${facts.topType.label.toLowerCase()}: ${facts.topType.n}.`);
    const headline = `${facts.saved} ${units(facts.saved, ["матеріал", "матеріали", "матеріалів"])} за місяць`;
    const delta = parts.length ? text(parts.join(" "), { y: head.end + 90, size: 48, fill: p.ink, leading: 1.32, maxLines: 3 }).svg : "";
    const line = spec.numberLine ? aiCaptionUp(spec.numberLine, FOOT, p.ink) : "";
    return { svg: svg(p, big + head.svg + delta + line + footer(p, facts.period)), alt: sentence(headline, ...parts, spec.numberLine) };
  },

  loved({ facts, images }, p, v) {
    const all = facts.loved.length;
    if (!all) return null;
    const shown = facts.loved.slice(0, 6);
    const head = text(`${all} ${units(all, ["улюблений", "улюблені", "улюблених"])}`, {
      y: 300,
      size: 104,
      weight: 750,
      fill: p.ink,
      tracking: -3,
    });
    const sub = text(
      all > shown.length
        ? `тут ${shown.length} з ${all}`
        : `з ${facts.saved} ${units(facts.saved, ["збереженого", "збережених", "збережених"])}`,
      { y: 392, size: 48, fill: p.ink, opacity: 0.8 },
    );
    const listTop = FOOT - (shown.length - 1) * 84;
    // The mosaic gives way to the list of names under it.
    const grid = fitted(mosaic(shown, 470, p.bg, images, v), 470, listTop - 110 - 470).svg;
    const list = shown
      .map(
        (t, i) =>
          `<text x="${M}" y="${listTop + i * 84}" font-family='${SANS}' font-size="50" font-weight="${i === 0 ? 700 : 400}" fill="${p.ink}">${esc(clip(t.title, { size: 50, weight: i === 0 ? 700 : 400 }))}</text>`,
      )
      .join("");
    return {
      svg: svg(p, head.svg + sub.svg + grid + list + footer(p, facts.period)),
      alt: sentence(`${all} ${units(all, ["улюблений", "улюблені", "улюблених"])}: ${shown.map((t) => t.title).join(", ")}`),
    };
  },

  topics({ facts }, p, v) {
    const topics = facts.topics.slice(0, 5);
    if (topics.length < 2) return null;
    const authors = facts.authors.slice(0, 3);
    const head = text("Про що був місяць", { y: 300, size: 104, weight: 750, fill: p.ink, tracking: -3, leading: 1.05 });
    const max = topics[0][1];
    const full = W - 2 * M - 110;
    let y = head.end + 170;
    // Without authors the topics take the whole card instead of stopping halfway.
    const spread = authors.length ? 0 : Math.min(260, (FOOT - 80 - y) / Math.max(1, topics.length - 1));
    const rows = topics
      .map(([name, n]) => {
        let row: string;
        if (v) {
          const size = Math.round(56 + 56 * (n / max));
          row =
            `<text x="${M}" y="${y}" font-family='${SANS}' font-size="${size}" font-weight="750" letter-spacing="-2" fill="${p.ink}">${esc(clip(name, { size, weight: 750, width: full }))}</text>` +
            `<text x="${W - M}" y="${y}" font-family='${SANS}' font-size="50" fill="${p.ink}" fill-opacity="0.8" text-anchor="end">${n}</text>`;
          y += spread || 150;
        } else {
          // Name above its bar, count after it: every row reads the same however short the bar is.
          const len = Math.max(24, Math.round((full * n) / max));
          row =
            `<text x="${M}" y="${y}" font-family='${SANS}' font-size="46" font-weight="650" fill="${p.ink}">${esc(clip(name, { size: 46, weight: 650 }))}</text>` +
            `<rect x="${M}" y="${y + 22}" width="${len}" height="56" fill="${p.accent}"/>` +
            `<text x="${M + len + 22}" y="${y + 66}" font-family='${SANS}' font-size="44" fill="${p.ink}">${n}</text>`;
          y += spread || 140;
        }
        return row;
      })
      .join("");
    const about = `Про що був місяць: ${topics.map(([t, n]) => `${t} ${n}`).join(", ")}`;
    if (!authors.length) return { svg: svg(p, head.svg + rows + footer(p, facts.period)), alt: sentence(about) };
    const list = authors
      .map(
        ([a, n], i) =>
          `<text x="${M}" y="${FOOT - (authors.length - 1 - i) * 76}" font-family='${SANS}' font-size="50" fill="${p.ink}">${esc(clip(a, { size: 50, width: W - 2 * M - 90 }))} <tspan fill-opacity="0.8">· ${n}</tspan></text>`,
      )
      .join("");
    const authHead = text("Автори, до яких повертався", { y: FOOT - authors.length * 76 - 40, size: 56, weight: 700, fill: p.ink });
    return {
      svg: svg(p, head.svg + rows + authHead.svg + list + footer(p, facts.period)),
      alt: sentence(about, `Автори, до яких повертався: ${authors.map(([a, n]) => `${a} ${n}`).join(", ")}`),
    };
  },

  fact({ facts, spec }, p, v) {
    const f: WrapFact | undefined = facts.facts.find((x) => x.id === spec.factId) ?? facts.facts[0];
    if (!f) return null;
    const figure = String(f.n);
    const size = fit(figure, 560);
    // The figure comes first and the headline continues it: "41" → "день чекав…".
    const fig = v
      ? `<text x="${W - M + 20}" y="760" font-family='${SANS}' font-size="${size}" font-weight="800" letter-spacing="${-0.05 * size}" fill="${p.accent}" text-anchor="end">${figure}</text>`
      : `<text x="${M - 20}" y="760" font-family='${SANS}' font-size="${size}" font-weight="800" letter-spacing="${-0.05 * size}" fill="${p.accent}">${figure}</text>`;
    const head = text(`${units(f.n, f.unit)} ${f.rest}`, { y: 930, size: 84, weight: 700, fill: p.ink, tracking: -2, leading: 1.1, maxLines: 3 });
    const detail = text(f.detail, { y: head.end + 104, size: 48, fill: p.ink, leading: 1.32, maxLines: 3 });
    const line = spec.factLine && f.id === spec.factId ? aiCaptionUp(spec.factLine, FOOT, p.ink) : "";
    return {
      svg: svg(p, fig + head.svg + detail.svg + line + footer(p, facts.period)),
      alt: sentence(`${f.n} ${units(f.n, f.unit)} ${f.rest}`, f.detail, line ? spec.factLine : null),
    };
  },

  rhythm({ facts }, p) {
    const grid = facts.rhythm;
    // Under ten saves a pattern is noise, so the card is not made.
    if (grid.flat().reduce((a, b) => a + b, 0) < 10) return null;
    const headline = facts.peak ? `Найчастіше — ${facts.peak}` : "Коли ти зберігаєш";
    const head = text(headline, {
      y: 300,
      size: 104,
      weight: 750,
      fill: p.ink,
      tracking: -3,
      leading: 1.05,
      maxLines: 2,
    });
    const days = ["пн", "вт", "ср", "чт", "пт", "сб", "нд"];
    const parts = ["ранок", "день", "вечір", "ніч"];
    const left = M + 180;
    const col = (W - M - left) / 7;
    const top = head.end + 240;
    const row = 210;
    const max = Math.max(...grid.flat());
    let dots = "";
    grid.forEach((cells, ri) =>
      cells.forEach((n, di) => {
        const cx = left + col * di + col / 2;
        const cy = top + ri * row;
        if (!n) dots += `<circle cx="${cx}" cy="${cy}" r="7" fill="${p.ink}" fill-opacity="0.3"/>`;
        else {
          const peak = n === max;
          dots += `<circle cx="${cx}" cy="${cy}" r="${Math.round(12 + (col * 0.46 - 12) * Math.sqrt(n / max))}" fill="${peak ? p.accent : p.ink}" fill-opacity="${peak ? 1 : 0.85}"/>`;
        }
      }),
    );
    const labels =
      parts.map((t, i) => `<text x="${M}" y="${top + i * row + 15}" font-family='${SANS}' font-size="44" fill="${p.ink}" fill-opacity="0.8">${t}</text>`).join("") +
      days.map((d, i) => `<text x="${left + col * i + col / 2}" y="${top + 3 * row + 150}" font-family='${SANS}' font-size="44" fill="${p.ink}" fill-opacity="0.8" text-anchor="middle">${d}</text>`).join("");
    const late = facts.late
      ? textUp(`Найпізніше збереження — ${facts.late}.`, { bottom: FOOT, size: 50, fill: p.ink, leading: 1.3, maxLines: 2 }).svg
      : "";
    return {
      svg: svg(p, head.svg + dots + labels + late + footer(p, facts.period)),
      alt: sentence(headline, facts.late && `Найпізніше збереження — ${facts.late}`),
    };
  },

  quote({ facts, spec }, p, v) {
    if (!facts.quotes.length) return null;
    const q = facts.quotes[spec.seed % facts.quotes.length];
    // The longest quote that still fits nine lines: smaller type before cutting.
    let size = 88;
    for (const s of [88, 76, 64, 56]) {
      size = s;
      if (wrap(q.body, { size: s, family: SERIF }).length <= 9) break;
    }
    const step = Math.round(size * 1.34);
    const n = Math.min(9, wrap(q.body, { size, family: SERIF }).length);
    // On the optical centre, a little above the middle, and never into its signature.
    const first = Math.max(330, Math.round(880 - ((n - 1) * step) / 2) + (v ? 100 : 0));
    const bar = `<rect x="${M}" y="${first - size - 70}" width="120" height="14" fill="${p.accent}"/>`;
    const body = text(q.body, { y: first, size, family: SERIF, fill: p.ink, leading: 1.34, maxLines: 9 });
    const who = textUp(q.title, { bottom: FOOT - 70, size: 52, weight: 700, fill: p.ink, maxLines: 1 });
    const when = text(dayMonth(q.date), { y: FOOT, size: 44, fill: p.ink, opacity: 0.8 });
    return {
      svg: svg(p, bar + body.svg + who.svg + when.svg + footer(p, facts.period)),
      alt: sentence(`Цитата: «${q.body}»`, `${q.title}, ${dayMonth(q.date)}`),
    };
  },
};

const ORDER: CardName[] = ["cover", "number", "loved", "topics", "fact", "rhythm", "quote"];

// The cards this month has something for. The seed picks each card's layout; neighbouring cards never
// share a field colour.
export function deck(story: Story): Card[] {
  const cards: Card[] = [];
  for (const [i, name] of ORDER.entries()) {
    const variant = (story.spec.seed >> i) & 1;
    const out = templates[name](story, story.palette[cards.length % story.palette.length], variant);
    if (out) cards.push({ name, ...out });
  }
  return cards;
}

