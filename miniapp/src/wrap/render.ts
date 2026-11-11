import type { Tile } from "../../../src/miniapp/collection-types.ts";
import { getBlob } from "../api.ts";
import cyrillic from "../fonts/literata-cyrillic.woff2?url";
import latin from "../fonts/literata-latin.woff2?url";
import { FONT_SLOT, H, W, type Images } from "./cards.ts";

// Drawing the cards: an SVG shown as an image cannot reach the page's fonts or the covers, so both travel
// inside it as data URLs. The same string is shown on the screen and drawn into the JPEG.

const dataUrl = (blob: Blob) =>
  new Promise<string>((done, fail) => {
    const reader = new FileReader();
    reader.onload = () => done(reader.result as string);
    reader.onerror = () => fail(reader.error);
    reader.readAsDataURL(blob);
  });

const subsets = [
  [cyrillic, "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116"],
  [
    latin,
    "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
  ],
];
let font: Promise<string> | null = null;
export function embeddedFont() {
  font ??= Promise.all(
    subsets.map(async ([url, range]) => {
      const data = await dataUrl(await (await fetch(url)).blob());
      return `@font-face{font-family:"Literata";src:url(${data}) format("woff2");unicode-range:${range};}`;
    }),
  )
    .then((faces) => faces.join(""))
    .catch((e) => {
      font = null;
      throw e;
    });
  return font;
}

// Line breaks are measured on Literata itself, so it must be loaded in the page first.
export const fontsReady = () => document.fonts.load('88px "Literata"', "Гра «Outer Wilds» — пам’ять");

async function picture(blob: Blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

// Covers, made small enough to embed, and the colour each one leans to. A cover that fails stays a tile.
export async function covers(tiles: Tile[]): Promise<{ images: Images; colors: string[] }> {
  const images: Images = new Map();
  const colors: string[] = [];
  await Promise.all(
    tiles
      .filter((t) => t.cover)
      .map(async (t) => {
        try {
          const img = await picture(await getBlob(`/api/library/${encodeURIComponent(t.id)}/cover`));
          const side = Math.min(640, Math.max(img.naturalWidth, img.naturalHeight));
          const scale = side / Math.max(img.naturalWidth, img.naturalHeight);
          const canvas = document.createElement("canvas");
          canvas.width = Math.round(img.naturalWidth * scale);
          canvas.height = Math.round(img.naturalHeight * scale);
          const g = canvas.getContext("2d")!;
          g.drawImage(img, 0, 0, canvas.width, canvas.height);
          images.set(t.id, canvas.toDataURL("image/jpeg", 0.85));
          const dot = document.createElement("canvas");
          dot.width = dot.height = 1;
          dot.getContext("2d")!.drawImage(canvas, 0, 0, 1, 1);
          const [r, gr, b] = dot.getContext("2d")!.getImageData(0, 0, 1, 1).data;
          colors.push("#" + [r, gr, b].map((v) => v.toString(16).padStart(2, "0")).join(""));
        } catch {
          // No cover on the card: the tinted tile with the first letter stands in.
        }
      }),
  );
  return { images, colors };
}

const filled = (svg: string, css: string) => svg.replace(FONT_SLOT, css);

// A blob URL the <img> on the screen shows; the caller revokes it.
export const cardUrl = (svg: string, css: string) =>
  URL.createObjectURL(new Blob([filled(svg, css)], { type: "image/svg+xml" }));

export async function cardJpeg(svg: string, css: string): Promise<Blob> {
  const url = cardUrl(svg, css);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    canvas.getContext("2d")!.drawImage(img, 0, 0, W, H);
    const blob = await new Promise<Blob | null>((done) => canvas.toBlob(done, "image/jpeg", 0.9));
    if (!blob) throw new Error("toBlob");
    return blob;
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function base64(blob: Blob) {
  const url = await dataUrl(blob);
  return url.slice(url.indexOf(",") + 1);
}
