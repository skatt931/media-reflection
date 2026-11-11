// What the Mini App shows of the counters. Only types: the screens bundle this file.
// «done»: counts from the last mark. «keep»: counts from its start; a mark is a lapse that starts it over.
// «auto»: the diary, counted from its newest entry date, with nothing to mark.
export type CounterKind = "done" | "keep" | "auto";

export type CounterItem = {
  id: string;
  name: string;
  kind: CounterKind;
  // Whole days since `since`; null for a «done» counter that was never marked.
  days: number | null;
  since: string | null;
  markedToday: boolean;
  // Only for the diary, which can be hidden from the row.
  hidden?: boolean;
};

export type CounterList = { today: string; counters: CounterItem[] };

export type CounterDetail = CounterItem & {
  // The dates of the marks, newest first.
  marks: string[];
  // The day a «keep» counter first started; `since` moves on with every lapse.
  started: string | null;
  // The longest run of a «keep» counter, once there has been a lapse.
  record: number | null;
};
