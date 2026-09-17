export type Timezone = string;

const DEFAULT_LOCALE = "fr-FR";
const DEFAULT_TZ: Timezone = "Europe/Paris";

export function formatDateTime(
  input: Date | string | number,
  options?: { timeZone?: Timezone; locale?: string; withTz?: boolean }
): string {
  const date = new Date(input);
  const locale = options?.locale || DEFAULT_LOCALE;
  const timeZone = options?.timeZone || DEFAULT_TZ;
  const withTz = options?.withTz !== false;

  const parts = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(date);

  return parts;
}

export function formatDate(
  input: Date | string | number,
  options?: { timeZone?: Timezone; locale?: string }
): string {
  const date = new Date(input);
  const locale = options?.locale || DEFAULT_LOCALE;
  const timeZone = options?.timeZone || DEFAULT_TZ;

  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone,
  }).format(date);
}

export function formatTime(
  input: Date | string | number,
  options?: { timeZone?: Timezone; locale?: string; withTz?: boolean }
): string {
  const date = new Date(input);
  const locale = options?.locale || DEFAULT_LOCALE;
  const timeZone = options?.timeZone || DEFAULT_TZ;
  const withTz = options?.withTz !== false;

  return new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  }).format(date);
}

function getZonedParts(date: Date, timeZone: Timezone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(date);
  const get = (type: string) =>
    Number(parts.find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
    second: get("second"),
  };
}

function getTimezoneOffsetMs(date: Date, timeZone: Timezone): number {
  const p = getZonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Calendar day of `date` in the given timezone, as "YYYY-MM-DD". */
export function getDayKey(
  date: Date | string | number,
  timeZone: Timezone = DEFAULT_TZ
): string {
  const p = getZonedParts(new Date(date), timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(
    p.day
  ).padStart(2, "0")}`;
}

/** UTC instant of local midnight (in `timeZone`) for the day containing `date`. */
export function startOfDayInTimezone(
  date: Date | string | number,
  timeZone: Timezone = DEFAULT_TZ
): Date {
  const p = getZonedParts(new Date(date), timeZone);
  const utcMidnight = Date.UTC(p.year, p.month - 1, p.day);
  const firstGuess = utcMidnight - getTimezoneOffsetMs(new Date(utcMidnight), timeZone);
  return new Date(
    utcMidnight - getTimezoneOffsetMs(new Date(firstGuess), timeZone)
  );
}
