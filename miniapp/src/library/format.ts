const short = ["січ", "лют", "бер", "кві", "тра", "чер", "лип", "сер", "вер", "жов", "лис", "гру"];
const genitive = [
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
const nominative = [
  "Січень",
  "Лютий",
  "Березень",
  "Квітень",
  "Травень",
  "Червень",
  "Липень",
  "Серпень",
  "Вересень",
  "Жовтень",
  "Листопад",
  "Грудень",
];

// Dates arrive as YYYY-MM-DD in the owner's time zone; they are never parsed into a Date.
const parts = (date: string) => ({
  year: date.slice(0, 4),
  month: Number(date.slice(5, 7)) - 1,
  day: Number(date.slice(8, 10)),
});

export function shortDate(date: string) {
  const { month, day } = parts(date);
  return `${day} ${short[month]}`;
}

export function longDate(date: string, thisYear = String(new Date().getFullYear())) {
  const { year, month, day } = parts(date);
  return `${day} ${genitive[month]}${year === thisYear ? "" : ` ${year}`}`;
}

export function monthTitle(date: string) {
  const { year, month } = parts(date);
  return `${nominative[month]} ${year}`;
}

export function materials(count: number) {
  const tail = count % 100 > 10 && count % 100 < 20 ? 0 : count % 10;
  const word = tail === 1 ? "матеріал" : tail >= 2 && tail <= 4 ? "матеріали" : "матеріалів";
  return `${count} ${word}`;
}
