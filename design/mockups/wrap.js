// Monthly wrap: card templates as SVG strings, 1080×1920. Invented data, nothing from the real library.
// The same functions would become React SVG components; text is wrapped by measuring it on a canvas,
// because SVG <text> does not wrap.
const W = 1080;
const H = 1920;
const M = 96; // outer margin
const FOOT = H - 300; // last baseline above the footer
const SANS = '-apple-system, BlinkMacSystemFont, "SF Pro Display", system-ui, sans-serif';
const SERIF = '"Literata", Georgia, serif';

const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
// Typographic apostrophe, and a dash that never ends a line.
const tidy = (s) => String(s ?? "").replace(/'/g, "’").replace(/ — /g, " — ");

const rules = new Intl.PluralRules("uk");
// plural(21, ["матеріал", "матеріали", "матеріалів"]) → "матеріал". Words next to numbers come from code, never from AI.
const plural = (n, [one, few, many]) => ({ one, few, many })[rules.select(n)] ?? many;

const measure = document.createElement("canvas").getContext("2d");
const width = (s, size, weight = 400, family = SANS) => {
  measure.font = `${weight} ${size}px ${family}`;
  return measure.measureText(s).width;
};

// Lines of text that fit the width; past maxLines the last line ends with "…".
function wrap(content, { size, family = SANS, weight = 400, width: max, maxLines = Infinity }) {
  const lines = [];
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
  kept[maxLines - 1] = clip(`${kept[maxLines - 1]}…`, { size, family, weight, width: max });
  return kept;
}

// One line that fits the width, cut with "…" when it does not.
function clip(content, { size, family = SANS, weight = 400, width: max }) {
  let s = tidy(content);
  if (width(s, size, weight, family) <= max) return s;
  while (s.length > 1 && width(`${s.trimEnd()}…`, size, weight, family) > max) s = s.slice(0, -1);
  return `${s.trimEnd().replace(/…$/, "")}…`;
}

// A block of wrapped text. Returns the SVG and the baseline of the last line.
function text(content, { x = M, y, size, family = SANS, weight = 400, width: max = W - 2 * M, fill, leading = 1.25, tracking = 0, opacity = 1, anchor = "start", maxLines }) {
  const lines = wrap(content, { size, family, weight, width: max, maxLines });
  const step = Math.round(size * leading);
  const svg = lines
    .map((l, i) => `<text x="${x}" y="${y + i * step}" font-family='${family}' font-size="${size}" font-weight="${weight}" letter-spacing="${tracking}" fill="${fill}" fill-opacity="${opacity}" text-anchor="${anchor}">${esc(l)}</text>`)
    .join("");
  return { svg, end: y + (lines.length - 1) * step, lines: lines.length };
}

// Text that ends at a given baseline: secondary lines sit near the foot of the card, so it never ends half empty.
function textUp(content, opts) {
  const { size, family = SANS, weight = 400, width: max = W - 2 * M, leading = 1.25, maxLines } = opts;
  const n = wrap(content, { size, family, weight, width: max, maxLines }).length;
  return text(content, { ...opts, y: opts.bottom - (n - 1) * Math.round(size * leading) });
}

// AI-written line: the system face, like everything that is not yours, and a small "AI" after it.
const CAPTION = 46;
function aiCaption(content, { y, fill }) {
  const t = text(content, { y, size: CAPTION, fill, leading: 1.32, maxLines: 3 });
  const last = wrap(content, { size: CAPTION, width: W - 2 * M, maxLines: 3 }).at(-1);
  const after = M + width(last, CAPTION) + 28;
  const mark = (x, yy) => `<text x="${x}" y="${yy}" font-family='${SANS}' font-size="36" font-weight="600" fill="${fill}" fill-opacity="0.8">AI</text>`;
  return t.svg + (after + 60 < W - M ? mark(after, t.end) : mark(M, t.end + 60));
}
function aiCaptionUp(content, { bottom, fill }) {
  const n = wrap(content, { size: CAPTION, width: W - 2 * M, maxLines: 3 }).length;
  return aiCaption(content, { y: bottom - (n - 1) * Math.round(CAPTION * 1.32), fill });
}

// The largest size (up to max) at which one line fits the width.
function fit(content, { max, weight = 800, width: room = W - 2 * M, tracking = -0.05 }) {
  const w = width(content, max, weight) + tracking * max * content.length;
  return Math.min(max, Math.floor((max * room) / w));
}

function footer(p, issue) {
  return `<text x="${M}" y="${H - 120}" font-family='${SANS}' font-size="40" font-weight="650" fill="${p.ink}">Медіатека</text>
<text x="${W - M}" y="${H - 120}" font-family='${SANS}' font-size="40" fill="${p.ink}" fill-opacity="0.8" text-anchor="end">${esc(issue.month.toLowerCase())} ${issue.year}</text>`;
}

// ---- Colour: a tile too close to the field is pushed away from it, so it never melts into the card.

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const hex = (c) => "#" + c.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
function luminance(h) {
  const [r, g, b] = rgb(h).map((v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
};
function apart(color, bg) {
  if (contrast(color, bg) >= 1.4) return color;
  const target = luminance(bg) > 0.4 ? [0, 0, 0] : [255, 255, 255];
  let c = rgb(color);
  for (let i = 0; i < 6 && contrast(hex(c), bg) < 1.4; i++) c = c.map((v, k) => v + (target[k] - v) * 0.15);
  return hex(c);
}

// Without a cover the app shows a colour and the first letter, as the library list does.
function tile(t, x, y, size, bg) {
  const letter = esc(t.title.replace(/^[«"„]/, "").charAt(0).toUpperCase());
  return `<rect x="${x}" y="${y}" width="${size}" height="${size}" fill="${apart(t.color, bg)}"/>
<text x="${x + size * 0.1}" y="${y + size * 0.86}" font-family='${SANS}' font-size="${Math.round(size * 0.62)}" font-weight="700" letter-spacing="${-size * 0.02}" fill="${t.ink}" fill-opacity="0.9">${letter}</text>`;
}

// Tiles across the full width, laid out for how many there are. Returns the SVG and its height.
function mosaic(tiles, top, bg, v = 0) {
  const full = W - 2 * M;
  const gap = 24;
  const out = [];
  const n = Math.min(tiles.length, 6);
  const put = (t, x, y, s) => out.push(tile(t, x, y, s, bg));
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
    // One large tile and up to four small ones in a column beside it.
    // Four small tiles and their gaps are exactly as tall as the large one.
    const small = (full - 4 * gap) / 5;
    const big = full - small - gap;
    put(tiles[0], M, top, big);
    const rest = tiles.slice(1, n);
    rest.forEach((t, i) => put(t, M + big + gap, top + i * (small + gap), small));
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

// A mosaic too tall for its room is scaled down and set against the right margin,
// so it answers the left-aligned text instead of leaving the right side empty.
function fitted(m, top, room) {
  const scale = Math.min(1, room / m.h);
  const x = W - M - (W - 2 * M) * scale;
  return { svg: `<g transform="translate(${x} ${top}) scale(${scale})"><g transform="translate(${-M} ${-top})">${m.svg}</g></g>`, h: m.h * scale };
}

const svg = (p, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><style>FONT_CSS</style><rect width="${W}" height="${H}" fill="${p.bg}"/>${body}</svg>`;

// ---- Templates. Each takes the issue, its palette and a layout variant (0 or 1, from the seed).
// A template returns null when the month has too little for it; the card is then left out.

const templates = {
  cover(issue, p, v) {
    const big = fit(issue.month, { max: 280 });
    const title = (base) => `<text x="${M - 6}" y="${base}" font-family='${SANS}' font-size="${big}" font-weight="800" letter-spacing="${-0.05 * big}" fill="${p.ink}">${esc(issue.month)}</text>`;
    const words = (base) => {
      const mood = text(issue.mood, { y: base + 140, size: 76, weight: 650, fill: p.accent, leading: 1.1, tracking: -1.5, maxLines: 2 });
      const caption = wrap(issue.moodLine, { size: CAPTION, width: W - 2 * M, maxLines: 3 }).length;
      return { svg: mood.svg + aiCaption(issue.moodLine, { y: mood.end + 96, fill: p.ink }), end: mood.end + 96 + (caption - 1) * Math.round(CAPTION * 1.32) };
    };
    // The shorter mosaic keeps the card from crowding the footer: at most two rows here.
    const tiles = issue.loved.length ? issue.loved : issue.latest;
    if (v) {
      // The mosaic on top, the month under it.
      const m = fitted(mosaic(tiles.slice(0, 5), 300, p.bg, 1), 300, 720);
      const base = 300 + m.h + 290;
      return svg(p, m.svg + title(base) + words(base).svg + footer(p, issue));
    }
    const top = words(420);
    const m = fitted(mosaic(tiles.slice(0, 6), top.end + 110, p.bg), top.end + 110, FOOT - (top.end + 110));
    return svg(p, title(420) + top.svg + m.svg + footer(p, issue));
  },

  number(issue, p, v) {
    const n = String(issue.saved);
    // Two digits may run off the edge on purpose; longer numbers are fitted inside the margins.
    const bleed = v && n.length <= 2;
    const size = bleed ? 900 : fit(n, { max: 900, width: W - 2 * M + 30 });
    const big = bleed
      ? `<text x="${W + 40}" y="1290" font-family='${SANS}' font-size="${size}" font-weight="800" letter-spacing="${-0.06 * size}" fill="${p.accent}" text-anchor="end">${n}</text>`
      : `<text x="${M - size * 0.04}" y="${v ? 1290 : 940}" font-family='${SANS}' font-size="${size}" font-weight="800" letter-spacing="${-0.06 * size}" fill="${p.accent}">${n}</text>`;
    const y = v ? 330 : 1110;
    const head = text(`${plural(issue.saved, ["матеріал", "матеріали", "матеріалів"])} за місяць`, { y, size: 80, weight: 700, fill: p.ink, tracking: -2 });
    const delta = text(issue.savedDelta, { y: head.end + 90, size: 48, fill: p.ink, leading: 1.32, maxLines: 3 });
    return svg(p, big + head.svg + delta.svg + aiCaptionUp(issue.numberLine, { bottom: FOOT, fill: p.ink }) + footer(p, issue));
  },

  loved(issue, p, v) {
    const all = issue.loved.length;
    if (!all) return null;
    const shown = issue.loved.slice(0, 6);
    const head = text(`${all} ${plural(all, ["улюблений", "улюблені", "улюблених"])}`, { y: 300, size: 104, weight: 750, fill: p.ink, tracking: -3 });
    const sub = text(
      all > shown.length ? `тут ${shown.length} з ${all}` : `з ${issue.saved} ${plural(issue.saved, ["збереженого", "збережених", "збережених"])}`,
      { y: 392, size: 48, fill: p.ink, opacity: 0.8 },
    );
    const listTop = FOOT - (shown.length - 1) * 84;
    // The mosaic gives way to the list of names under it.
    const grid = fitted(mosaic(shown, 470, p.bg, v), 470, listTop - 110 - 470).svg;
    const list = shown
      .map((t, i) => `<text x="${M}" y="${listTop + i * 84}" font-family='${SANS}' font-size="50" font-weight="${i === 0 ? 700 : 400}" fill="${p.ink}">${esc(clip(t.title, { size: 50, weight: i === 0 ? 700 : 400, width: W - 2 * M }))}</text>`)
      .join("");
    return svg(p, head.svg + sub.svg + grid + list + footer(p, issue));
  },

  topics(issue, p, v) {
    const topics = issue.topics.slice(0, 5);
    if (topics.length < 2) return null;
    const authors = issue.authors.slice(0, 3);
    const head = text("Про що був місяць", { y: 300, size: 104, weight: 750, fill: p.ink, tracking: -3, leading: 1.05 });
    const max = topics[0][1];
    const full = W - 2 * M - 110;
    let y = head.end + 170;
    // Without authors the topics take the whole card instead of stopping halfway.
    const spread = authors.length ? 0 : Math.min(260, (FOOT - 80 - y) / Math.max(1, topics.length - 1));
    const rows = topics
      .map(([name, n]) => {
        let row;
        if (v) {
          const size = Math.round(56 + 56 * (n / max));
          row = `<text x="${M}" y="${y}" font-family='${SANS}' font-size="${size}" font-weight="750" letter-spacing="-2" fill="${p.ink}">${esc(clip(name, { size, weight: 750, width: full }))}</text><text x="${W - M}" y="${y}" font-family='${SANS}' font-size="50" fill="${p.ink}" fill-opacity="0.8" text-anchor="end">${n}</text>`;
          y += spread || 150;
        } else {
          // Name above its bar, count after it: every row reads the same however short the bar is.
          const len = Math.max(24, Math.round((full * n) / max));
          row =
            `<text x="${M}" y="${y}" font-family='${SANS}' font-size="46" font-weight="650" fill="${p.ink}">${esc(clip(name, { size: 46, weight: 650, width: W - 2 * M }))}</text>` +
            `<rect x="${M}" y="${y + 22}" width="${len}" height="56" fill="${p.accent}"/>` +
            `<text x="${M + len + 22}" y="${y + 66}" font-family='${SANS}' font-size="44" fill="${p.ink}">${n}</text>`;
          y += spread || 140;
        }
        return row;
      })
      .join("");
    if (!authors.length) return svg(p, head.svg + rows + footer(p, issue));
    const list = authors
      .map(([a, n], i) => `<text x="${M}" y="${FOOT - (authors.length - 1 - i) * 76}" font-family='${SANS}' font-size="50" fill="${p.ink}">${esc(clip(a, { size: 50, width: W - 2 * M - 90 }))} <tspan fill-opacity="0.8">· ${n}</tspan></text>`)
      .join("");
    const authHead = text("Автори, до яких повертався", { y: FOOT - authors.length * 76 - 40, size: 56, weight: 700, fill: p.ink });
    return svg(p, head.svg + rows + authHead.svg + list + footer(p, issue));
  },

  fact(issue, p, v) {
    const f = issue.fact;
    if (!f) return null;
    const figure = String(f.n);
    const size = fit(figure, { max: 560 });
    // The figure comes first and the headline continues it: "41" → "день чекав…".
    const fig = v
      ? `<text x="${W - M + 20}" y="760" font-family='${SANS}' font-size="${size}" font-weight="800" letter-spacing="${-0.05 * size}" fill="${p.accent}" text-anchor="end">${figure}</text>`
      : `<text x="${M - 20}" y="760" font-family='${SANS}' font-size="${size}" font-weight="800" letter-spacing="${-0.05 * size}" fill="${p.accent}">${figure}</text>`;
    const head = text(`${plural(f.n, f.unit)} ${f.rest}`, { y: 930, size: 84, weight: 700, fill: p.ink, tracking: -2, leading: 1.1, maxLines: 3 });
    const detail = text(f.detail, { y: head.end + 104, size: 48, fill: p.ink, leading: 1.32, maxLines: 3 });
    return svg(p, fig + head.svg + detail.svg + aiCaptionUp(f.line, { bottom: FOOT, fill: p.ink }) + footer(p, issue));
  },

  rhythm(issue, p, v) {
    const r = issue.rhythm;
    const grid = r?.grid ?? [];
    const total = grid.flat().reduce((a, b) => a + b, 0);
    // Under ten saves a pattern is noise, so the card is not made.
    if (total < 10 || !r.headline) return null;
    const head = text(r.headline, { y: 300, size: 104, weight: 750, fill: p.ink, tracking: -3, leading: 1.05, maxLines: 2 });
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
    const late = r.late ? textUp(r.late, { bottom: FOOT, size: 50, fill: p.ink, leading: 1.3, maxLines: 2 }).svg : "";
    return svg(p, head.svg + dots + labels + late + footer(p, issue));
  },

  quote(issue, p, v) {
    const q = issue.quote;
    if (!q?.body) return null;
    // The longest quote that still fits nine lines, smaller type before cutting.
    const room = W - 2 * M;
    let size = 88;
    for (const s of [88, 76, 64, 56]) {
      size = s;
      if (wrap(q.body, { size: s, family: SERIF, width: room }).length <= 9) break;
    }
    const step = Math.round(size * 1.34);
    const n = Math.min(9, wrap(q.body, { size, family: SERIF, width: room }).length);
    // The quote sits on the optical centre, a little above the middle, and never runs into its signature.
    const first = Math.max(330, Math.round(880 - ((n - 1) * step) / 2) + (v ? 100 : 0));
    const bar = `<rect x="${M}" y="${first - size - 70}" width="120" height="14" fill="${p.accent}"/>`;
    const body = text(q.body, { y: first, size, family: SERIF, fill: p.ink, leading: 1.34, maxLines: 9 });
    const who = textUp(q.title, { bottom: FOOT - 70, size: 52, weight: 700, fill: p.ink, maxLines: 1 });
    const when = text(q.date, { y: FOOT, size: 44, fill: p.ink, opacity: 0.8 });
    return svg(p, bar + body.svg + who.svg + when.svg + footer(p, issue));
  },
};

// ---- Three issues: two ordinary months with different palettes and seeds, and one with awkward data.

const tilesNov = [
  { title: "Outer Wilds", color: "#e8a33d", ink: "#1b1a17" },
  { title: "Severance, сезон 2", color: "#2e4b3f", ink: "#f4f1ea" },
  { title: "SABLE, fABLE — Bon Iver", color: "#c9b79c", ink: "#1b1a17" },
  { title: "Як працює пам'ять", color: "#4f6d7a", ink: "#f4f1ea" },
  { title: "Dieter Rams: Less but better", color: "#d8d3c8", ink: "#1b1a17" },
  { title: "Hades II", color: "#8c2f2a", ink: "#f4f1ea" },
];
const tilesOct = [
  { title: "Перфект дейз", color: "#3a6ea5", ink: "#f2f5f8" },
  { title: "Balatro", color: "#c94f4f", ink: "#f2f5f8" },
  { title: "Як звучить кіно", color: "#e9c46a", ink: "#14304d" },
  { title: "Ryuichi Sakamoto — 12", color: "#1e2a33", ink: "#f2f5f8" },
  { title: "Нотатки про повільне читання", color: "#a8c5da", ink: "#14304d" },
];

const issues = {
  nov: {
    label: "Листопад",
    month: "Листопад",
    year: 2026,
    seed: [0, 0, 0, 0, 0, 0, 0],
    palettes: [
      { bg: "#1d5a46", ink: "#f4f1ea", accent: "#f2b36b" },
      { bg: "#f4f1ea", ink: "#17181a", accent: "#1d5a46" },
      { bg: "#f2b36b", ink: "#17181a", accent: "#1d5a46" },
    ],
    mood: "Місяць повільних речей",
    moodLine: "Довгі відео й тиха музика витіснили статті. Ти частіше дивився, ніж читав.",
    saved: 47,
    savedDelta: "На 12 більше, ніж у жовтні. Найбільше — відео: 19.",
    numberLine: "Другий тиждень вийшов найщільнішим: 18 збережень за сім днів.",
    loved: tilesNov,
    latest: tilesNov,
    topics: [["ігровий дизайн", 9], ["мінімалізм", 7], ["пам'ять", 5], ["звук", 4], ["архітектура", 3]],
    authors: [["Veritasium", 4], ["Марк Браун", 3], ["Bon Iver", 2]],
    fact: {
      n: 3,
      unit: ["раз", "рази", "разів"],
      rest: "ти зберіг «Outer Wilds»",
      detail: "Перший раз 2 листопада, востаннє 21-го. Лише втретє дописав думку.",
      line: "Схоже, до цієї гри ти повертаєшся, коли хочеш подумати.",
    },
    rhythm: {
      headline: "Найчастіше — неділя ввечері",
      grid: [
        [1, 0, 1, 0, 2, 3, 2],
        [2, 1, 1, 2, 1, 4, 3],
        [3, 2, 4, 2, 3, 5, 8],
        [0, 2, 0, 1, 0, 1, 1],
      ],
      late: "Найпізніше збереження — 02:47 у вівторок, подкаст про сон.",
    },
    quote: {
      body: "Гра, яка не дає тобі нічого, крім розуміння. І цього виявляється досить.",
      title: "Outer Wilds",
      date: "14 листопада",
    },
  },
  oct: {
    label: "Жовтень",
    month: "Жовтень",
    year: 2026,
    seed: [1, 1, 1, 1, 1, 1, 1],
    palettes: [
      { bg: "#14304d", ink: "#eef3f7", accent: "#c6e36b" },
      { bg: "#e6eef5", ink: "#14304d", accent: "#3a6ea5" },
      { bg: "#c6e36b", ink: "#14304d", accent: "#3a6ea5" },
    ],
    mood: "Звук на першому місці",
    moodLine: "Музика й усе про звук — третина місяця. Ігор удвічі менше, ніж зазвичай.",
    saved: 35,
    savedDelta: "На 4 менше, ніж у вересні. Найбільше — музика: 12.",
    numberLine: "Половину всього ти зберіг у вихідні.",
    loved: tilesOct,
    latest: tilesOct,
    topics: [["звук", 8], ["кіно", 6], ["японія", 4], ["читання", 3], ["інді-ігри", 2]],
    authors: [["Ryuichi Sakamoto", 3], ["Every Frame a Painting", 2]],
    fact: {
      n: 41,
      unit: ["день", "дні", "днів"],
      rest: "чекав «Перфект дейз» у «На потім»",
      detail: "Збережений 30 серпня, переглянутий 10 жовтня. І одразу в улюблене.",
      line: "Найдовше очікування цього року закінчилось найвищою оцінкою.",
    },
    rhythm: {
      headline: "Вихідні вранці",
      grid: [
        [1, 0, 0, 1, 0, 6, 5],
        [1, 1, 2, 0, 1, 3, 2],
        [2, 1, 1, 2, 3, 1, 1],
        [0, 0, 1, 0, 1, 0, 0],
      ],
      late: "Жодного збереження після опівночі в будні.",
    },
    quote: {
      body: "Повільне кіно, після якого місто за вікном звучить інакше.",
      title: "Перфект дейз",
      date: "10 жовтня",
    },
  },
  // Awkward on purpose: one favourite with a long title, seven topics, no authors, a three-digit fact,
  // too few saves for a rhythm, a long quote, numbers that need the singular.
  edge: {
    label: "Гірші дані",
    month: "Вересень",
    year: 2026,
    seed: [0, 1, 0, 1, 0, 1, 1],
    palettes: [
      { bg: "#0f4c5c", ink: "#f1f5f4", accent: "#ffb4a2" },
      { bg: "#f1f5f4", ink: "#0f4c5c", accent: "#0f7a8a" },
      { bg: "#ffb4a2", ink: "#1d1d1f", accent: "#0f4c5c" },
    ],
    mood: "Тихий місяць, багато незавершеного й відкладеного на потім",
    moodLine: "Збережень менше, ніж зазвичай, і більшість — статті, які ще чекають своєї черги. Зате думок до них стало більше.",
    saved: 21,
    savedDelta: "На 18 менше, ніж у серпні. Найбільше — статті: 11.",
    numberLine: "Половина збережень припала на останні вихідні місяця.",
    loved: [{ title: "Довга розмова про те, чому ми відкладаємо важливе на потім і що з цим робити, частина друга", color: "#2a6f7f", ink: "#f1f5f4" }],
    latest: [],
    topics: [["продуктивність і звички на щодень", 6], ["психологія", 5], ["нотатки", 4], ["читання", 3], ["сон", 2], ["біг", 1], ["кава", 1]],
    authors: [],
    fact: {
      n: 124,
      unit: ["день", "дні", "днів"],
      rest: "пролежала в «На потім» стаття про повільне читання, поки ти її не відкрив",
      detail: "Збережена 20 травня, прочитана 21 вересня.",
      line: "Найстаріший запис у списку на потім нарешті дочекався.",
    },
    rhythm: {
      headline: "Без вираженого ритму",
      grid: [
        [0, 0, 1, 0, 0, 0, 0],
        [0, 1, 0, 0, 0, 1, 0],
        [0, 0, 0, 0, 1, 0, 0],
        [0, 0, 0, 0, 0, 0, 0],
      ],
      late: "",
    },
    quote: {
      body: "Я довго думав, що проблема в тому, що мені бракує часу, але насправді мені бракувало рішення, що саме важливо. Коли я дочитав цю статтю, то зрозумів, що відкладаю не справи, а вибір між ними, і що жоден застосунок для задач цього вибору за мене не зробить. Можливо, варто почати з того, щоб раз на тиждень викреслювати половину списку без жалю й без пояснень.",
      title: "Чому ми відкладаємо: довгий текст про прокрастинацію, рішення і втому від вибору",
      date: "21 вересня",
    },
  },
};

const order = ["cover", "number", "loved", "topics", "fact", "rhythm", "quote"];
const names = {
  cover: "Обкладинка з настроєм",
  number: "Головне число",
  loved: "Мозаїка улюбленого",
  topics: "Теми й автори",
  fact: "Несподіваний факт",
  rhythm: "Ритм",
  quote: "Цитата (за перемикачем)",
};

// Cards with nothing to say are left out; neighbouring cards still never share a field colour.
function deck(key) {
  const issue = issues[key];
  const cards = [];
  const skipped = [];
  for (const [i, name] of order.entries()) {
    const out = templates[name](issue, issue.palettes[cards.length % 3], issue.seed[i]);
    if (out) cards.push({ name, svg: out });
    else skipped.push(name);
  }
  return { cards, skipped };
}

// ---- Export: the same SVG with the font embedded as data URLs, drawn on a canvas, saved as JPEG.

const subsets = [
  ["literata-cyrillic", "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116"],
  ["literata-latin", "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD"],
];
let fontCss = "";
async function embeddedFont() {
  if (fontCss) return fontCss;
  const faces = await Promise.all(
    subsets.map(async ([file, range]) => {
      const blob = await (await fetch(`fonts/${file}.woff2`)).blob();
      const url = await new Promise((r) => {
        const f = new FileReader();
        f.onload = () => r(f.result);
        f.readAsDataURL(blob);
      });
      return `@font-face{font-family:"Literata";src:url(${url}) format("woff2");unicode-range:${range};}`;
    }),
  );
  return (fontCss = faces.join(""));
}

async function toJpeg(svgText) {
  const src = URL.createObjectURL(new Blob([svgText.replace("FONT_CSS", await embeddedFont())], { type: "image/svg+xml" }));
  try {
    const img = new Image();
    img.src = src;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = W;
    c.height = H;
    c.getContext("2d").drawImage(img, 0, 0);
    return await new Promise((r) => c.toBlob(r, "image/jpeg", 0.9));
  } finally {
    URL.revokeObjectURL(src);
  }
}

async function render(key) {
  // Both subsets, so line breaks are measured on Literata itself, not on the fallback.
  await document.fonts.load(`88px ${SERIF}`, "Гра «Outer Wilds» — пам’ять");
  const board = document.getElementById("cards");
  board.innerHTML = "";
  const { cards, skipped } = deck(key);
  for (const card of cards) {
    const fig = document.createElement("figure");
    fig.innerHTML = `<div class="card">${card.svg.replace("FONT_CSS", "")}</div><figcaption>${names[card.name]} <button type="button">JPEG</button></figcaption>`;
    fig.querySelector("button").addEventListener("click", async () => {
      const blob = await toJpeg(card.svg);
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = `wrap-${key}-${card.name}.jpg`;
      a.click();
    });
    board.append(fig);
  }
  document.getElementById("skipped").textContent = skipped.length
    ? `Без картки, бо замало даних: ${skipped.map((n) => names[n].toLowerCase()).join(", ")}.`
    : "";
  for (const b of document.querySelectorAll(".issue button")) b.setAttribute("aria-pressed", String(b.dataset.issue === key));
}

const asked = new URLSearchParams(location.search).get("issue");
const initial = asked in issues ? asked : "nov";
for (const b of document.querySelectorAll(".issue button")) b.addEventListener("click", () => render(b.dataset.issue));
render(initial);
window.wrapDeck = { deck: (key) => deck(key).cards, toJpeg };
