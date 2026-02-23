import { formatInTimeZone } from "date-fns-tz";

export function formatShiftRange(
  startIso: string,
  endIso: string,
  timezone: string,
): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  const startLabel = formatInTimeZone(start, timezone, "EEE, MMM d h:mm a");
  const endLabel = formatInTimeZone(end, timezone, "h:mm a zzz");
  return `${startLabel} - ${endLabel}`;
}

export function toWeekMondayIso(date = new Date()): string {
  const utcDay = date.getUTCDay();
  const diff = utcDay === 0 ? -6 : 1 - utcDay;
  const monday = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + diff),
  );
  return monday.toISOString().slice(0, 10);
}
