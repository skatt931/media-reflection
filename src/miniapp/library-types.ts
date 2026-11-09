// The shape of the library API, shared by the server and the screens. No imports: the screens bundle this file.
export type Labels = {
  types: Record<string, string>;
  statuses: Record<string, string>;
  reactions: Record<string, string>;
};

// The last thing written about a material, for the list. `hit` marks a piece cut around a search word.
export type Thought = { body: string; date: string; hit: boolean };

export type LibraryCard = {
  id: string;
  title: string;
  type: string;
  creator: string | null;
  source: string | null;
  status: string | null;
  reaction: string | null;
  date: string;
  tags: string[];
  cover: boolean;
  unreviewed: boolean;
  // No written thought yet, even if there is a reaction; resources count too.
  noThought: boolean;
  thought: Thought | null;
};

export type LibraryList = {
  items: LibraryCard[];
  // The stems of the search words, to mark them in the thoughts.
  terms: string[];
  total: number;
  counts: { saved: number; unreviewed: number; noThought: number; types: Record<string, number> };
  labels: Labels;
};

export type LibraryItem = LibraryCard & {
  url: string | null;
  summary: string | null;
  description: string | null;
  entities: string[];
  impressions: { date: string; body: string }[];
  // The ids of the collections this material is in.
  collections: string[];
  labels: Labels;
};

// A reaction filter value for items without a reaction.
export const NO_REACTION = "none";
