import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameMonth,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths
} from "date-fns";
import type { DateRange } from "./types";

export function toLocalDate(iso: string): string {
  const value = parseISO(iso);
  if (Number.isNaN(value.getTime())) {
    return iso.slice(0, 10);
  }
  return format(value, "yyyy-MM-dd");
}

export function dateFromKey(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year ?? 1970, (month ?? 1) - 1, day ?? 1);
}

export function dateKey(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export function monthLabel(date: Date): string {
  return format(date, "yyyy 年 M 月");
}

export function dayLabel(key: string): string {
  return format(dateFromKey(key), "M 月 d 日");
}

export function timeLabel(iso: string): string {
  const value = parseISO(iso);
  return Number.isNaN(value.getTime()) ? "--:--" : format(value, "HH:mm");
}

export function weekLabel(range: DateRange): string {
  return `${format(dateFromKey(range.start), "M/d")} - ${format(dateFromKey(range.end), "M/d")}`;
}

export function weekRange(anchor: Date): DateRange {
  return {
    start: dateKey(startOfWeek(anchor, { weekStartsOn: 1 })),
    end: dateKey(endOfWeek(anchor, { weekStartsOn: 1 }))
  };
}

export function dayRange(anchor: Date): DateRange {
  const key = dateKey(anchor);
  return { start: key, end: key };
}

export function monthGrid(anchor: Date): Array<{ date: string; inMonth: boolean }> {
  const monthStart = startOfMonth(anchor);
  const monthEnd = endOfMonth(anchor);
  const start = startOfWeek(monthStart, { weekStartsOn: 1 });
  const end = endOfWeek(monthEnd, { weekStartsOn: 1 });
  return eachDayOfInterval({ start, end }).map((day) => ({
    date: dateKey(day),
    inMonth: isSameMonth(day, anchor)
  }));
}

export function moveMonth(anchor: Date, direction: -1 | 1): Date {
  return direction === -1 ? subMonths(anchor, 1) : addMonths(anchor, 1);
}

export function moveRangeAnchor(anchor: Date, mode: "day" | "week", direction: -1 | 1): Date {
  return addDays(anchor, direction * (mode === "week" ? 7 : 1));
}

export function inRange(date: string, range: DateRange): boolean {
  return date >= range.start && date <= range.end;
}

export function compareIso(left: string, right: string): number {
  return left.localeCompare(right);
}
