import { useEffect, useState } from "react";

export type Section = "diary" | "media" | "ideas";
export type Route =
  | { screen: "list"; section: Section }
  | { screen: "entry"; section: "diary"; id: number }
  | { screen: "compose"; section: "diary" }
  | { screen: "material"; section: "media"; id: string }
  | { screen: "search"; section: "diary" | "ideas"; q: string };

// #/diary, #/diary/new, #/diary/42, #/diary/search?q=слово, #/ideas, #/ideas/search?q=слово, #/media, #/media/<id>
export function parse(hash: string): Route {
  const [path, query = ""] = hash.replace(/^#\/?/, "").split("?");
  const [section, rest] = path.split("/");
  if (section === "media") {
    try {
      return rest
        ? { screen: "material", section, id: decodeURIComponent(rest) }
        : { screen: "list", section };
    } catch {
      return { screen: "list", section };
    }
  }
  // An empty or unknown address is how the app is opened: it lands on the first tab, ideas.
  const known = section === "diary" ? "diary" : "ideas";
  if (rest === "search")
    return { screen: "search", section: known, q: new URLSearchParams(query).get("q") ?? "" };
  if (known === "diary" && rest === "new") return { screen: "compose", section: "diary" };
  if (known === "diary" && /^\d+$/.test(rest ?? ""))
    return { screen: "entry", section: "diary", id: Number(rest) };
  return { screen: "list", section: known };
}

export const searchHash = (section: "diary" | "ideas", q = "") =>
  `#/${section}/search${q ? `?q=${encodeURIComponent(q)}` : ""}`;
export const composeHash = "#/diary/new";
export const entryHash = (id: number) => `#/diary/${id}`;
export const materialHash = (id: string) => `#/media/${encodeURIComponent(id)}`;
export const sectionHash = (section: Section) => `#/${section}`;

// The order of the tabs: swiping goes along it.
export const ORDER: Section[] = ["ideas", "media", "diary"];

export function hashOf(route: Route): string {
  switch (route.screen) {
    case "list":
      return sectionHash(route.section);
    case "entry":
      return entryHash(route.id);
    case "compose":
      return composeHash;
    case "material":
      return materialHash(route.id);
    case "search":
      return searchHash(route.section, route.q);
  }
}

// Where a screen keeps its scroll position. The search address changes with every query, the screen does not.
export const scrollKey = (route: Route) =>
  route.screen === "search" ? `#/${route.section}/search` : hashOf(route);

// How deep a screen lies: moving to a deeper one slides in, to a shallower one slides out.
export const depth = (route: Route) => (route.screen === "list" ? 0 : route.screen === "entry" ? 2 : 1);

// The screens before this one, as the browser's history holds them: a swipe back has to show the screen
// that "back" is going to land on. Every history entry is stamped with its place (`at`) as it is first
// reached, so a step back or forward is told from a new step. `oldURL` carries the address as it was left,
// including a search query that was written over it.
const trail = new Map<number, Route>();
let at = 0;
let replacing = false;
const stamped = () => (history.state as { at?: number } | null)?.at;
if (typeof window !== "undefined") {
  at = stamped() ?? 0;
  history.replaceState({ ...history.state, at }, "");
  trail.set(at, parse(location.hash));
  window.addEventListener("hashchange", (e) => {
    const placed = stamped();
    if (typeof placed === "number") at = placed;
    else {
      if (!replacing) trail.set(at, parse(new URL(e.oldURL).hash));
      at += replacing ? 0 : 1;
      history.replaceState({ ...history.state, at }, "");
    }
    replacing = false;
    trail.set(at, parse(location.hash));
  });
}

// The screen "back" returns to, when this session has seen it.
export const before = (): Route | undefined => trail.get(at - 1);

// Swaps the current screen for another one in the history, so "back" skips it.
export function replaceHash(hash: string) {
  replacing = true;
  location.replace(hash);
}

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
