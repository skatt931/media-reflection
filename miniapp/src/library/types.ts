export type Labels = {
  types: Record<string, string>;
  statuses: Record<string, string>;
  reactions: Record<string, string>;
};

export type Card = {
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
};

export type LibraryResponse = {
  items: Card[];
  total: number;
  counts: { saved: number; unreviewed: number; types: Record<string, number> };
  labels: Labels;
};

export type Detail = Card & {
  url: string | null;
  summary: string | null;
  description: string | null;
  entities: string[];
  impressions: { date: string; body: string }[];
  labels: Labels;
};

export type Filters = {
  types: string[];
  statuses: string[];
  reactions: string[];
  unreviewed: boolean;
};

export const NO_REACTION = "none";
export const noFilters: Filters = { types: [], statuses: [], reactions: [], unreviewed: false };

export const isFiltered = (f: Filters) =>
  f.types.length > 0 || f.statuses.length > 0 || f.reactions.length > 0 || f.unreviewed;
