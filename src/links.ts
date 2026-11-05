const tracking = new Set([
  "si",
  "is",
  "igsh",
  "igshid",
  "srtk",
  "cplk",
  "img_index",
  "xmt",
  "slof",
  "fbclid",
  "gclid",
  "dclid",
  "msclkid",
  "mc_cid",
  "mc_eid",
  "feature",
  "pp",
  "ref_src",
  "ref_url",
  "share_id",
]);

export function findUrl(text: string) {
  const match = text.match(/https?:\/\/[^\s<>]+/i)?.[0];
  return match?.replace(/[).,!?»"']+$/, "") ?? null;
}

export function normalizeUrl(raw: string) {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  url.hostname = url.hostname.toLowerCase();
  if (url.hostname === "threads.net" || url.hostname === "www.threads.net") url.hostname = "www.threads.com";
  if (url.hostname === "youtu.be") {
    const id = url.pathname.split("/")[1];
    if (id) {
      const t = url.searchParams.get("t");
      url = new URL(`https://www.youtube.com/watch?v=${id}`);
      if (t) url.searchParams.set("t", t);
    }
  }
  for (const key of [...url.searchParams.keys()])
    if (key.startsWith("utm_") || tracking.has(key)) url.searchParams.delete(key);
  if (url.hostname === "x.com" || url.hostname === "twitter.com") url.searchParams.delete("s");
  return url.toString().replace(/\?$/, "");
}

const host = (url: URL) => url.hostname.replace(/^(www|m)\./, "");

export function typeFromUrl(raw: string | null) {
  if (!raw) return "unknown";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return "unknown";
  }
  const h = host(url);
  const on = (...names: string[]) => names.some((n) => h === n || h.endsWith("." + n));
  const path = url.pathname;
  if (on("youtube.com", "youtu.be", "tiktok.com", "vimeo.com")) return "video";
  if (on("spotify.com")) {
    if (path.includes("/track/")) return "music_track";
    if (path.includes("/album/")) return "music_album";
    if (path.includes("/episode/") || path.includes("/show/")) return "podcast";
  }
  if (on("podcasts.apple.com")) return "podcast";
  if (on("music.apple.com"))
    return url.searchParams.has("i") || path.includes("/song/") ? "music_track" : "music_album";
  if (on("soundcloud.com", "bandcamp.com")) return "music_track";
  if (
    on(
      "instagram.com",
      "threads.com",
      "threads.net",
      "x.com",
      "twitter.com",
      "facebook.com",
      "reddit.com",
      "bsky.app",
      "linkedin.com",
    )
  )
    return "social_post";
  if (on("medium.com", "substack.com", "habr.com", "dou.ua")) return "article";
  if (on("imdb.com", "letterboxd.com")) return "film";
  if (on("store.steampowered.com", "gog.com", "store.playstation.com", "itch.io")) return "game";
  if (on("goodreads.com")) return "book";
  return "unknown";
}
