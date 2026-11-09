const months = [
  "січень",
  "лютий",
  "березень",
  "квітень",
  "травень",
  "червень",
  "липень",
  "серпень",
  "вересень",
  "жовтень",
  "листопад",
  "грудень",
];
const monthsOf = [
  "січня",
  "лютого",
  "березня",
  "квітня",
  "травня",
  "червня",
  "липня",
  "серпня",
  "вересня",
  "жовтня",
  "листопада",
  "грудня",
];
export const monthAbbr = ["січ", "лют", "бер", "кві", "тра", "чер", "лип", "сер", "вер", "жов", "лис", "гру"];
const weekdaysShort = ["нд", "пн", "вт", "ср", "чт", "пт", "сб"];
const weekdays = ["неділя", "понеділок", "вівторок", "середа", "четвер", "пʼятниця", "субота"];

export const capital = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
export const pad = (n: number) => String(n).padStart(2, "0");

// "2026-11-07" → local noon, so no time zone moves it to another day.
export const parseDate = (iso: string) => new Date(`${iso}T12:00:00`);
export const isoDate = (date: Date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
export const today = () => isoDate(new Date());
export const monthKey = (iso: string) => iso.slice(0, 7);

export function parts(iso: string) {
  const date = parseDate(iso);
  return {
    day: date.getDate(),
    month: date.getMonth(),
    year: date.getFullYear(),
    weekday: date.getDay(),
  };
}

export const monthName = (month: number) => months[month];
export const weekdayShort = (iso: string) => weekdaysShort[parts(iso).weekday];
export const weekdayFull = (iso: string) => weekdays[parts(iso).weekday];

export function dayMonthPlain(iso: string) {
  const { day, month } = parts(iso);
  return `${day} ${monthsOf[month]}`;
}

// "7 листопада", with the year when it is not this one.
export function dayMonth(iso: string) {
  const { year } = parts(iso);
  return `${dayMonthPlain(iso)}${year === new Date().getFullYear() ? "" : ` ${year}`}`;
}

export function dayHeading(iso: string) {
  const now = new Date();
  if (iso === isoDate(now)) return "Сьогодні";
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  return iso === isoDate(yesterday) ? "Вчора" : dayMonth(iso);
}

export function plural(n: number, one: string, few: string, many: string) {
  const last = n % 10;
  const lastTwo = n % 100;
  if (last === 1 && lastTwo !== 11) return one;
  return last >= 2 && last <= 4 && (lastTwo < 10 || lastTwo >= 20) ? few : many;
}
export const records = (n: number) => `${n} ${plural(n, "запис", "записи", "записів")}`;
export const wordsLabel = (n: number) => `${n} ${plural(n, "слово", "слова", "слів")}`;
export const ideasLabel = (n: number) => `${n} ${plural(n, "ідея", "ідеї", "ідей")}`;
