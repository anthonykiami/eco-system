import { describe, expect, it } from "vitest";
import { BRIEFING_PROMPT, briefingPrompt, dailyCron, describeCron, describeJob, onceCron, weeklyCron } from "./briefing";
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

describe("weeklyCron", () => {
  it("builds a cron for the chosen days", () => {
    expect(weeklyCron("09:00", ["mon", "thu"])).toBe("0 9 * * 1,4");
    expect(weeklyCron("09:00", ["thu", "mon", "mon"])).toBe("0 9 * * 1,4");
    expect(weeklyCron("09:00", ["sun", "mon", "tue", "wed", "thu", "fri", "sat"])).toBe("0 9 * * *");
    expect(isValidSchedule(weeklyCron("06:15", ["sat"])!, "Asia/Tokyo")).toBe(true);
  });

  it("rejects a bad time or no days", () => {
    expect(weeklyCron("9", ["mon"])).toBeUndefined();
    expect(weeklyCron("09:00", [])).toBeUndefined();
  });
});

describe("describeCron", () => {
  it("reads back crons made by dailyCron", () => {
    expect(describeCron(dailyCron("07:05", "daily")!)).toBe("Every day at 07:05");
    expect(describeCron(dailyCron("18:00", "weekdays")!)).toBe("Weekdays at 18:00");
  });

  it("reads back crons made by weeklyCron", () => {
    expect(describeCron(weeklyCron("09:00", ["thu", "mon"])!)).toBe("Mondays and Thursdays at 09:00");
    expect(describeCron(weeklyCron("09:00", ["sun"])!)).toBe("Sundays at 09:00");
    expect(describeCron("0 9 * * 1,3,5")).toBe("Mondays, Wednesdays and Fridays at 09:00");
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

describe("one-off helpers", () => {
  it("onceCron builds a yearly cron for a local date and time", () => {
    expect(onceCron("2026-10-25", "15:05")).toBe("5 15 25 10 *");
    expect(onceCron("25/10/2026", "15:05")).toBeUndefined();
    expect(onceCron("2026-10-25", "25:00")).toBeUndefined();
  });

  it("describeJob shows one-offs by their moment and recurring jobs by their pattern", () => {
    const at = new Date("2026-10-25T19:00:00Z");
    expect(describeJob({ kind: "reminder", cronExpression: "0 15 25 10 *", nextRunAt: at }, "America/New_York")).toBe(
      "Reminder, Sun, Oct 25, 3:00 PM",
    );
    expect(describeJob({ kind: "once", cronExpression: "0 15 25 10 *", nextRunAt: null }, "UTC")).toBe(
      "Once, already sent",
    );
    expect(describeJob({ kind: "recurring", cronExpression: "30 7 * * 1-5", nextRunAt: at }, "UTC")).toBe(
      "Weekdays at 07:30",
    );
  });
});
