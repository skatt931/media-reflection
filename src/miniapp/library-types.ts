// The shape of the library API, shared by the server and the screens. No imports: the screens bundle this file.
export type Labels = {
  types: Record<string, string>;
  statuses: Record<string, string>;
  reactions: Record<string, string>;
};

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
};

export type LibraryList = {
  items: LibraryCard[];
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
  labels: Labels;
};

// A reaction filter value for items without a reaction.
export const NO_REACTION = "none";
