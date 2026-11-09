import { useEffect, useState } from "react";

export type Section = "diary" | "media" | "ideas";
export type Route =
  | { screen: "list"; section: Section }
  | { screen: "entry"; section: "diary"; id: number }
  | { screen: "search"; section: "diary" | "ideas"; q: string };

// #/diary, #/diary/42, #/diary/search?q=слово, #/ideas, #/ideas/search?q=слово, #/media
export function parse(hash: string): Route {
  const [path, query = ""] = hash.replace(/^#\/?/, "").split("?");
  const [section, rest] = path.split("/");
  if (section === "media") return { screen: "list", section };
  const known = section === "ideas" ? "ideas" : "diary";
  if (rest === "search")
    return { screen: "search", section: known, q: new URLSearchParams(query).get("q") ?? "" };
  if (known === "diary" && /^\d+$/.test(rest ?? ""))
    return { screen: "entry", section: "diary", id: Number(rest) };
  return { screen: "list", section: known };
}

export const searchHash = (section: "diary" | "ideas", q = "") =>
  `#/${section}/search${q ? `?q=${encodeURIComponent(q)}` : ""}`;
export const entryHash = (id: number) => `#/diary/${id}`;
export const sectionHash = (section: Section) => `#/${section}`;

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parse(location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

// One step back inside the app; from a screen opened directly, to its section.
export function goBack(fallback: string) {
  if (history.length > 1) history.back();
  else location.hash = fallback;
}
