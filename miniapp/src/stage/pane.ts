import { createContext, useContext, type RefObject } from "react";

// Every screen lives in a pane that scrolls on its own, so two screens can be on show during a move and each
// keeps its position. `key` is where the pane's scroll position is remembered.
export type PaneInfo = { ref: RefObject<HTMLElement | null>; key: string };

export const PaneContext = createContext<PaneInfo | null>(null);
export const usePane = () => useContext(PaneContext);
