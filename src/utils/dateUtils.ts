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
