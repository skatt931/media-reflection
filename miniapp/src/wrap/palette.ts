import type { Palette } from "./cards.ts";

// Checked palettes, three fields each, so neighbouring cards differ and text always reads. The wrap takes
// the one closest in hue to its covers; free colours from the covers could not promise contrast.
type Preset = { hue: number | null; fields: Palette[] };

const presets: Preset[] = [
  {
    hue: 155,
    fields: [
      { bg: "#1d5a46", ink: "#f4f1ea", accent: "#f2b36b" },
      { bg: "#f4f1ea", ink: "#17181a", accent: "#1d5a46" },
      { bg: "#f2b36b", ink: "#17181a", accent: "#1d5a46" },
    ],
  },
  {
    hue: 212,
    fields: [
      { bg: "#14304d", ink: "#eef3f7", accent: "#c6e36b" },
      { bg: "#e6eef5", ink: "#14304d", accent: "#3a6ea5" },
      { bg: "#c6e36b", ink: "#14304d", accent: "#3a6ea5" },
    ],
  },
  {
    hue: 190,
    fields: [
      { bg: "#0f4c5c", ink: "#f1f5f4", accent: "#ffb4a2" },
      { bg: "#f1f5f4", ink: "#0f4c5c", accent: "#0f7a8a" },
      { bg: "#ffb4a2", ink: "#1d1d1f", accent: "#0f4c5c" },
    ],
  },
  {
    hue: 350,
    fields: [
      { bg: "#5b1f2a", ink: "#f6eee9", accent: "#f4c06a" },
      { bg: "#f6eee9", ink: "#3a141b", accent: "#9b2c3d" },
      { bg: "#f4c06a", ink: "#2a1b12", accent: "#5b1f2a" },
    ],
  },
  {
    hue: null,
    fields: [
      { bg: "#1f2124", ink: "#f2f1ec", accent: "#f5d547" },
      { bg: "#f2f1ec", ink: "#1f2124", accent: "#3a6ea5" },
      { bg: "#f5d547", ink: "#1f2124", accent: "#3a6ea5" },
    ],
  },
];

function hueOf(hex: string): { hue: number; saturation: number } {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const saturation = max === 0 ? 0 : d / max;
  if (!d) return { hue: 0, saturation };
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { hue: (h * 60 + 360) % 360, saturation };
}

const distance = (a: number, b: number) => Math.min(Math.abs(a - b), 360 - Math.abs(a - b));

// The covers' leaning colour picks the palette; greyish covers take the neutral one. Without covers, the seed.
export function paletteFor(colors: string[], seed: number): Palette[] {
  const vivid = colors.map(hueOf).filter((c) => c.saturation >= 0.2);
  if (!colors.length) return presets[seed % presets.length].fields;
  if (vivid.length * 2 < colors.length) return presets.find((p) => p.hue === null)!.fields;
  // The mean hue on the circle, so red covers on both sides of 0° do not average to cyan.
  const x = vivid.reduce((sum, c) => sum + Math.cos((c.hue * Math.PI) / 180), 0);
  const y = vivid.reduce((sum, c) => sum + Math.sin((c.hue * Math.PI) / 180), 0);
  const mean = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  const coloured = presets.filter((p) => p.hue !== null);
  return coloured.reduce((best, p) => (distance(p.hue!, mean) < distance(best.hue!, mean) ? p : best)).fields;
}
