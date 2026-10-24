import { describe, expect, it } from "vitest";
import { BRIEFING_PROMPT, briefingPrompt, dailyCron, describeCron } from "./briefing";
import { isValidSchedule } from "./schedule";

describe("dailyCron", () => {
  it("builds valid crons for each day preset", () => {
    expect(dailyCron("07:30", "daily")).toBe("30 7 * * *");
    expect(dailyCron("00:05", "weekdays")).toBe("5 0 * * 1-5");
    expect(isValidSchedule(dailyCron("23:59", "weekdays")!, "Europe/Paris")).toBe(true);
  });

  it("rejects malformed times", () => {
    for (const bad of ["7:30", "24:00", "07:60", "", "07:30; rm"]) {
      expect(dailyCron(bad, "daily")).toBeUndefined();
    }
  });
});

describe("describeCron", () => {
  it("reads back crons made by dailyCron", () => {
    expect(describeCron(dailyCron("07:05", "daily")!)).toBe("Every day at 07:05");
    expect(describeCron(dailyCron("18:00", "weekdays")!)).toBe("Weekdays at 18:00");
  });

  it("shows other crons unchanged", () => {
    expect(describeCron("0 */2 * * *")).toBe("0 */2 * * *");
  });
});

describe("briefingPrompt", () => {
  it("appends the user's additions only when given", () => {
    expect(briefingPrompt("  ")).toBe(BRIEFING_PROMPT);
    expect(briefingPrompt("Include NBA scores.")).toBe(`${BRIEFING_PROMPT}\n\nAlso: Include NBA scores.`);
  });
});
