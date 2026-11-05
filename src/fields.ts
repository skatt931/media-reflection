export const types: Record<string, string> = {
  video: "Відео",
  film: "Фільм",
  series: "Серіал",
  music_track: "Трек",
  music_album: "Альбом",
  podcast: "Подкаст",
  game: "Гра",
  article: "Стаття",
  book: "Книга",
  social_post: "Допис",
  resource: "Ресурс",
  other: "Інше",
  unknown: "Невідомо",
};
export const statuses: Record<string, string> = {
  saved: "На потім",
  in_progress: "У процесі",
  consumed: "Ознайомився",
  finished: "Завершено",
};
export const reactions: Record<string, string> = {
  loved: "Улюблене",
  positive: "Сподобалось",
  mixed: "Змішані враження",
  negative: "Не сподобалось",
};
// ❤️ is a stronger 👍: everything that counts likes counts both.
export const liked = (reaction: unknown) => reaction === "positive" || reaction === "loved";
export const fields: Record<string, string> = {
  title: "Назва",
  creator: "Автор / виконавець",
  source: "Джерело",
  tags: "Теги",
  consumed_on: "Дата",
  summary: "AI-опис",
  entities: "Згадані назви",
};
export function localDate(now = new Date(), zone = process.env.TIMEZONE ?? "Europe/Prague") {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function validDate(value: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function localTime(now = new Date(), zone = process.env.TIMEZONE ?? "Europe/Prague") {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: zone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(now);
}
export function addDays(date: string, days: number) {
  return new Date(Date.parse(date + "T12:00:00Z") + days * 86400000).toISOString().slice(0, 10);
}
