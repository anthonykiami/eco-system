import { describe, expect, it } from "vitest";
import { formatRunTime, parseTimeOfDay, resolveTimezone } from "./time";

describe("parseTimeOfDay", () => {
  it.each([
    ["7", "07:00"],
    ["7:30", "07:30"],
    ["07:30", "07:30"],
    ["19.45", "19:45"],
    ["7am", "07:00"],
    ["7:30 pm", "19:30"],
    ["12am", "00:00"],
    ["12 PM", "12:00"],
    ["7 a.m.", "07:00"],
    ["noon", "12:00"],
    ["0:05", "00:05"],
  ])("%s → %s", (input, expected) => {
    expect(parseTimeOfDay(input)).toBe(expected);
  });

  it.each(["24:00", "7:60", "13pm", "0am", "tomorrow", "7:3", ""])("rejects %j", (input) => {
    expect(parseTimeOfDay(input)).toBeUndefined();
  });
});

describe("resolveTimezone", () => {
  it("canonicalizes case and spaces, and accepts aliases", () => {
    expect(resolveTimezone("america/chicago")).toBe("America/Chicago");
    expect(resolveTimezone("America/Los Angeles")).toBe("America/Los_Angeles");
    expect(resolveTimezone("UTC")).toBe("UTC");
  });

  it("rejects unknown zones", () => {
    expect(resolveTimezone("Mars/Olympus")).toBeUndefined();
    expect(resolveTimezone("")).toBeUndefined();
  });
});

describe("formatRunTime", () => {
  it("formats in the user's timezone", () => {
    const date = new Date("2026-10-26T11:30:00Z"); // Monday
    expect(formatRunTime(date, "America/New_York")).toBe("Mon 7:30 AM");
  });
});
