import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";

export type Metadata = {
  title: string | null;
  creator: string | null;
  description: string | null;
  image: string | null;
  site: string | null;
  url: string | null;
};
export type Lookup = (host: string) => Promise<string[]>;

const agent = "facebookexternalhit/1.1";
const defaultLookup: Lookup = async (host) => (await dnsLookup(host, { all: true })).map((a) => a.address);

function privateAddress(ip: string) {
  const v4 = ip.startsWith("::ffff:") ? ip.slice(7) : ip;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b < 128) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b < 32) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  const v6 = ip.toLowerCase();
  return v6 === "::" || v6 === "::1" || v6.startsWith("fc") || v6.startsWith("fd") || v6.startsWith("fe80");
}

async function publicUrl(raw: string, lookup: Lookup) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol)) return null;
  if (url.username || url.password || url.port) return null;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : await lookup(host).catch(() => []);
  if (!addresses.length || addresses.some(privateAddress)) return null;
  return url;
}

// Follows redirects by hand so every hop is checked against private addresses.
async function get(raw: string, accept: string, transport: typeof fetch, lookup: Lookup) {
  let current = raw;
  for (let hop = 0; hop < 5; hop++) {
    const url = await publicUrl(current, lookup);
    if (!url) return null;
    const response = await transport(url, {
      redirect: "manual",
      signal: AbortSignal.timeout(6000),
      headers: { "user-agent": agent, accept },
    });
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      current = new URL(location, url).toString();
      continue;
    }
    return response.ok ? { response, url: url.toString() } : null;
  }
  return null;
}

async function readUntil(response: Response, limit: number, stop?: string) {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const decoder = new TextDecoder();
  let tail = "";
  while (size < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    if (stop) {
      tail = (tail + decoder.decode(value, { stream: true })).slice(-4096);
      if (tail.includes(stop)) break;
    }
  }
  await reader.cancel().catch(() => {});
  const bytes = new Uint8Array(Math.min(size, limit));
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= bytes.length) break;
    bytes.set(chunk.subarray(0, bytes.length - offset), offset);
    offset += chunk.length;
  }
  return bytes;
}

const entities: Record<string, string> = {
  amp: "&",
  quot: '"',
  apos: "'",
  lt: "<",
  gt: ">",
  nbsp: " ",
};
export function decodeEntities(text: string) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code: string) => {
    if (code[0] !== "#") return entities[code.toLowerCase()] ?? all;
    const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
    return Number.isFinite(n) && n <= 0x10ffff ? String.fromCodePoint(n) : all;
  });
}

export function parseHead(html: string) {
  const meta: Record<string, string> = {};
  for (const tag of html.match(/<meta\s[^>]*>/gi) ?? []) {
    const attr = (name: string) => tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, "i"));
    const key = attr("property") ?? attr("name");
    const content = attr("content");
    if (!key || !content) continue;
    const name = (key[2] ?? key[3]).toLowerCase();
    meta[name] ??= decodeEntities(content[2] ?? content[3]).trim();
  }
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return { meta, title: title ? decodeEntities(title).trim() : null };
}

const clip = (text: string | null | undefined, max: number) => {
  const value = text?.replace(/\s+/g, " ").trim();
  return value ? (value.length > max ? value.slice(0, max - 1) + "…" : value) : null;
};
const firstLine = (text: string | null) => clip(text?.split("\n").find((l) => l.trim()) ?? null, 120);

export function fromHead(html: string, pageUrl: string): Metadata {
  const { meta, title } = parseHead(html);
  const host = new URL(pageUrl).hostname.replace(/^www\./, "");
  const site = meta["og:site_name"] ?? null;
  const ogTitle = meta["og:title"] ?? meta["twitter:title"] ?? null;
  let image: string | null = meta["og:image"] ?? meta["twitter:image"] ?? null;
  try {
    image = image ? new URL(image, pageUrl).toString() : null;
  } catch {
    image = null;
  }
  let result: Metadata = {
    title: clip(ogTitle ?? title, 300),
    creator: clip(meta["author"] ?? meta["article:author"], 200),
    description: clip(meta["og:description"] ?? meta["twitter:description"] ?? meta["description"], 1000),
    image,
    site,
    url: meta["og:url"] ?? null,
  };
  if (result.creator?.startsWith("http")) result.creator = null;

  if (host === "threads.com" || host === "threads.net") {
    // Threads puts the post text in <title> and the author in og:title.
    const author = ogTitle?.replace(/\s+on Threads$/i, "") ?? null;
    const post = title && title !== "Threads" ? title : null;
    result = {
      ...result,
      creator: clip(author, 200),
      title: firstLine(post) ?? (author ? `Допис ${author}` : null),
      description: clip(post, 1000) ?? result.description,
    };
  } else if (host === "instagram.com") {
    const quoted = ogTitle?.match(/^(.*?) on Instagram: "([\s\S]*)"$/);
    const profile = ogTitle?.match(/^(.*?) • Instagram/);
    const caption = result.description?.match(/: "([\s\S]*)"\.?\s*$/)?.[1];
    result = {
      ...result,
      creator: clip(quoted?.[1] ?? profile?.[1], 200),
      title: firstLine(quoted?.[2] ?? caption ?? null) ?? (profile ? `Допис ${profile[1]}` : null),
      description: clip(caption ?? quoted?.[2], 1000),
    };
  } else if (host === "open.spotify.com") {
    // "Show · Episode" or "Artist · Song · 2020".
    result.creator = clip(result.description?.split(" · ")[0], 200);
  }
  return result;
}

function youtubeId(url: URL) {
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, "");
  if (host === "youtu.be") return url.pathname.split("/")[1];
  if (host !== "youtube.com") return null;
  return url.searchParams.get("v") ?? url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1] ?? null;
}

export async function fetchMetadata(
  raw: string,
  transport: typeof fetch = fetch,
  lookup: Lookup = defaultLookup,
): Promise<Metadata | null> {
  try {
    const url = new URL(raw);
    const id = youtubeId(url);
    if (id !== null) {
      if (!/^[-\w]+$/.test(id)) return null;
      const response = await transport(
        "https://www.youtube.com/oembed?format=json&url=" +
          encodeURIComponent("https://www.youtube.com/watch?v=" + id),
        { signal: AbortSignal.timeout(4000), redirect: "error" },
      );
      if (!response.ok) return null;
      const data = (await response.json()) as any;
      if (typeof data.title !== "string" || !data.title.trim()) return null;
      return {
        title: clip(data.title, 300),
        creator: typeof data.author_name === "string" ? clip(data.author_name, 200) : null,
        description: null,
        image: typeof data.thumbnail_url === "string" ? data.thumbnail_url : null,
        site: "YouTube",
        url: null,
      };
    }
    const page = await get(raw, "text/html", transport, lookup);
    if (!page || !page.response.headers.get("content-type")?.includes("html")) return null;
    const html = new TextDecoder().decode(await readUntil(page.response, 1_000_000, "</head>"));
    const value = fromHead(html, page.url);
    return value.title || value.description || value.image ? value : null;
  } catch {
    return null;
  }
}

const imageTypes: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};
export async function fetchImage(
  raw: string,
  transport: typeof fetch = fetch,
  lookup: Lookup = defaultLookup,
) {
  try {
    const page = await get(raw, "image/*", transport, lookup);
    const type = page?.response.headers.get("content-type")?.split(";")[0].trim();
    const ext = type ? imageTypes[type] : undefined;
    if (!page || !ext) return null;
    const limit = 5_000_000;
    if (Number(page.response.headers.get("content-length") ?? 0) > limit) return null;
    const bytes = await readUntil(page.response, limit + 1);
    return bytes.length && bytes.length <= limit ? { bytes, ext } : null;
  } catch {
    return null;
  }
}
