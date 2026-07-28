const MOSCOW_TIME_ZONE = "Europe/Moscow";

export function dateKey(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MOSCOW_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function shiftDateKey(value: string, days: number): string {
  const date = new Date(`${value}T12:00:00+03:00`);
  date.setUTCDate(date.getUTCDate() + days);
  return dateKey(date);
}

export function dayDistance(value: string, from = dateKey()): number {
  const target = new Date(`${value}T12:00:00+03:00`).getTime();
  const origin = new Date(`${from}T12:00:00+03:00`).getTime();
  return Math.round((target - origin) / 86_400_000);
}

export function formatLongDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: MOSCOW_TIME_ZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(new Date(`${value}T12:00:00+03:00`));
}

export function formatShortDate(value: string): string {
  return new Intl.DateTimeFormat("ru-RU", {
    timeZone: MOSCOW_TIME_ZONE,
    day: "numeric",
    month: "long",
  }).format(new Date(`${value}T12:00:00+03:00`));
}

export function relativeDayLabel(value: string): string {
  const distance = dayDistance(value);
  if (distance === 0) return "Сегодня";
  if (distance === 1) return "Завтра";
  if (distance === -1) return "Вчера";
  return formatLongDate(value);
}
