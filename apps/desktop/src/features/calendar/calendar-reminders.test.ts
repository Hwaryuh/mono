import { describe, expect, it } from "vitest";
import type { CalendarEvent } from "@mono/contracts";
import { checkCalendarReminders } from "./calendar-reminders";

function event(over: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: "e1", version: 1, title: "회의", startDate: "2026-09-10", startTime: "15:00",
    endDate: "2026-09-10", endTime: "16:00", location: "", categoryId: "c1", note: "",
    reminderMinutes: null, recurrence: null, seriesId: null, occurrenceDate: null, ...over,
  };
}

const start = new Date("2026-09-10T15:00").getTime();

describe("checkCalendarReminders", () => {
  it("fires once when the lead time is reached, then not again", () => {
    const fired = new Set<string>();
    const events = [event({ reminderMinutes: 10 })];

    expect(checkCalendarReminders(events, start - 11 * 60_000, fired)).toEqual([]);
    expect(checkCalendarReminders(events, start - 9 * 60_000, fired)).toEqual(["회의"]);
    expect(checkCalendarReminders(events, start - 8 * 60_000, fired)).toEqual([]);
  });

  it("skips events with no reminder set", () => {
    expect(checkCalendarReminders([event({ reminderMinutes: null })], start, new Set())).toEqual([]);
  });

  it("does not fire before the lead time even by a second", () => {
    expect(checkCalendarReminders([event({ reminderMinutes: 5 })], start - 5 * 60_000 - 1000, new Set())).toEqual([]);
  });

  it("treats a stale reminder (app was closed for hours) as not due", () => {
    expect(checkCalendarReminders([event({ reminderMinutes: 10 })], start + 60 * 60_000, new Set())).toEqual([]);
  });

  it("keys recurring occurrences separately", () => {
    const fired = new Set<string>();
    const a = event({ id: "s::2026-09-10", seriesId: "s", occurrenceDate: "2026-09-10", reminderMinutes: 10 });
    const b = event({ id: "s::2026-09-11", seriesId: "s", occurrenceDate: "2026-09-11", startDate: "2026-09-11", reminderMinutes: 10 });
    expect(checkCalendarReminders([a], start - 9 * 60_000, fired)).toEqual(["회의"]);
    expect(checkCalendarReminders([b], new Date("2026-09-11T14:51").getTime(), fired)).toEqual(["회의"]);
  });
});
