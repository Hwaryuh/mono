import type { DayEntry } from "@mono/contracts";
import { describe, expect, it } from "vitest";
import { buildTimeline, chainStartOf, parseEntryDraft } from "./day-timeline";

function entry(startTime: string, endTime: string, title = "x"): DayEntry {
  return { id: `${startTime}-${endTime}`, version: 1, date: "2026-10-03", startTime, endTime, title, todoId: null, note: "", source: "manual" };
}

describe("parseEntryDraft", () => {
  it("chains an end-time-only entry onto the previous end", () => {
    expect(parseEntryDraft("10:30 기획 다듬기", "09:00", "14:00")).toEqual({ startTime: "09:00", endTime: "10:30", title: "기획 다듬기" });
    expect(parseEntryDraft("1030 기획", "09:00", "14:00")).toEqual({ startTime: "09:00", endTime: "10:30", title: "기획" });
  });

  it("inserts a range as written", () => {
    expect(parseEntryDraft("9-10:30 기획 다듬기", "13:25", "14:00")).toEqual({ startTime: "09:00", endTime: "10:30", title: "기획 다듬기" });
    expect(parseEntryDraft("9:00 ~ 10:30 기획", null, "14:00")).toEqual({ startTime: "09:00", endTime: "10:30", title: "기획" });
  });

  it("ends a title-only entry now, and keeps numeric-looking titles as titles", () => {
    expect(parseEntryDraft("기획 다듬기", "13:25", "14:05")).toEqual({ startTime: "13:25", endTime: "14:05", title: "기획 다듬기" });
    expect(parseEntryDraft("3D 모델링", "13:25", "14:05")).toEqual({ startTime: "13:25", endTime: "14:05", title: "3D 모델링" });
  });

  it("asks for a start on an empty day and rejects a zero-length range", () => {
    expect(parseEntryDraft("10:30 기획", null, "14:00")).toEqual({ error: "needsStart" });
    expect(parseEntryDraft("기획", null, "14:00")).toEqual({ error: "needsStart" });
    expect(parseEntryDraft("13:25 기획", "13:25", "14:00")).toEqual({ error: "sameTime" });
    expect(parseEntryDraft("   ", "09:00", "14:00")).toBeNull();
  });
});

describe("buildTimeline", () => {
  it("marks gaps of 15+ minutes, flags overlaps, and sums logged time", () => {
    const timeline = buildTimeline([entry("12:00", "13:00"), entry("09:00", "10:30"), entry("10:20", "10:40"), entry("10:50", "11:00")]);
    expect(timeline.rows.map((row) => row.kind === "gap" ? `gap ${row.startTime}-${row.endTime}` : `${row.entry.startTime}${row.overlaps ? "!" : ""}`))
      .toEqual(["09:00", "10:20!", "10:50", "gap 11:00-12:00", "12:00"]);
    expect(timeline.loggedMinutes).toBe(90 + 20 + 10 + 60);
    expect(timeline.gapMinutes).toBe(60);
  });

  it("chains from the latest end, including past midnight", () => {
    expect(chainStartOf([])).toBeNull();
    expect(chainStartOf([entry("09:00", "10:30"), entry("10:00", "10:15")])).toBe("10:30");
    expect(chainStartOf([entry("23:00", "00:30")])).toBe("00:30");
    expect(buildTimeline([entry("23:00", "00:30")]).rows[0]).toMatchObject({ minutes: 90, crossesMidnight: true });
  });
});
