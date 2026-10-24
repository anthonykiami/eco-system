import { describe, expect, it } from "vitest";
import { buildSituation, buildSystemPrompt } from "./index";

const NOON_UTC = new Date("2026-09-22T16:00:00Z");

describe("buildSituation", () => {
  it("states the current moment in the user's timezone", () => {
    const text = buildSituation("America/New_York", NOON_UTC);
    expect(text).toContain("Tuesday, September 22, 2026");
    expect(text).toContain("12:00 PM");
    expect(text).toContain("America/New_York");
  });

  it("renders the same instant differently per timezone", () => {
    expect(buildSituation("Asia/Tokyo", NOON_UTC)).toContain("September 23, 2026");
    expect(buildSituation("America/Los_Angeles", NOON_UTC)).toContain("9:00 AM");
  });
});

describe("buildSystemPrompt", () => {
  it("always includes the soul and the situation", () => {
    const prompt = buildSystemPrompt("SOUL", [], { timezone: "UTC", now: NOON_UTC });
    expect(prompt).toContain("SOUL");
    expect(prompt).toContain("<situation>");
    expect(prompt).not.toContain("<memories>");
  });

  it("adds memories when there are any", () => {
    const prompt = buildSystemPrompt("SOUL", ["likes tea"], { timezone: "UTC", now: NOON_UTC });
    expect(prompt).toContain("- likes tea");
    expect(prompt.indexOf("SOUL")).toBeLessThan(prompt.indexOf("<situation>"));
  });
});

describe("integration limits", () => {
  it("states the user's limits in the system prompt, and nothing when there are none", () => {
    const note = "Gmail is drafts-only: you can't send.";
    const withLimits = buildSystemPrompt("soul", [], { timezone: "UTC", integrationNotes: [note] });
    expect(withLimits).toContain("<integration_limits>");
    expect(withLimits).toContain(`- ${note}`);
    expect(buildSystemPrompt("soul", [], { timezone: "UTC" })).not.toContain("integration_limits");
  });
});
