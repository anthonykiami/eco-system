import { beforeEach, describe, expect, it, vi } from "vitest";
import { inGoogleAccount, loadToday, senderName, startOfLocalDay } from "./today";

const mocks = vi.hoisted(() => ({
  execute: vi.fn(),
  accounts: vi.fn(),
  get: vi.fn(),
  set: vi.fn(),
}));

vi.mock("./composio", () => ({ executeForAccount: mocks.execute, listConnectedAccounts: mocks.accounts }));
vi.mock("@/lib/upstash", () => ({ redis: { get: mocks.get, set: mocks.set, del: vi.fn() } }));

const NY = "America/New_York";
// 9:00 AM in New York on Saturday, Oct 24 2026.
const NOW = new Date("2026-10-24T13:00:00Z");

beforeEach(() => {
  mocks.get.mockReset().mockResolvedValue(null);
  mocks.set.mockReset().mockResolvedValue("OK");
  mocks.execute.mockReset();
  mocks.accounts.mockReset();
});

describe("helpers", () => {
  it("finds local midnight in the user's timezone, DST included", () => {
    expect(startOfLocalDay("2026-10-24", NY).toISOString()).toBe("2026-10-24T04:00:00.000Z");
    expect(startOfLocalDay("2026-11-02", NY).toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect(startOfLocalDay("2026-10-25", "Asia/Tokyo").toISOString()).toBe("2026-10-24T15:00:00.000Z");
  });

  it("points Google links at the connected account, not the browser's first one", () => {
    expect(inGoogleAccount("https://www.google.com/calendar/event?eid=abc", "me@upenn.edu")).toBe(
      "https://www.google.com/calendar/event?eid=abc&authuser=me%40upenn.edu",
    );
    expect(inGoogleAccount("https://mail.google.com/mail/u/0/#inbox/123", "me@gmail.com")).toBe(
      "https://mail.google.com/mail/u/me@gmail.com/#inbox/123",
    );
    expect(inGoogleAccount("https://mail.google.com/mail/?shva=1#inbox/1", "me@gmail.com")).toBe(
      "https://mail.google.com/mail/?shva=1&authuser=me%40gmail.com#inbox/1",
    );
    expect(inGoogleAccount("https://x.test/a", undefined)).toBe("https://x.test/a");
    expect(inGoogleAccount(undefined, "me@gmail.com")).toBeUndefined();
  });

  it("shows senders by name", () => {
    expect(senderName('"Jane Doe" <jane@x.com>')).toBe("Jane Doe");
    expect(senderName("Penn Registrar <noreply@upenn.edu>")).toBe("Penn Registrar");
    expect(senderName("bob@x.com")).toBe("bob@x.com");
  });
});

describe("loadToday", () => {
  const calendar = (summary_view: object[]) => ({ successful: true, data: { summary_view } });
  const inbox = (messages: object[]) => ({ successful: true, data: { messages } });

  it("reads every account for today and tomorrow, sorted, and names accounts when there are several", async () => {
    mocks.accounts.mockResolvedValue(
      new Map([
        ["GOOGLECALENDAR", [{ id: "cal1", email: "me@upenn.edu" }]],
        ["GMAIL", [{ id: "g1", email: "me@gmail.com" }, { id: "g2", email: "me@work.com" }]],
      ]),
    );
    mocks.execute.mockImplementation(async (_user, slug, accountId, _tool, args) => {
      if (slug === "GOOGLECALENDAR") {
        expect(args).toMatchObject({ time_min: "2026-10-24T04:00:00.000Z", time_max: "2026-10-26T04:00:00.000Z" });
        return calendar([
          {
            title: "Lab",
            start: "2026-10-24T14:00:00-04:00",
            end: "2026-10-24T15:00:00-04:00",
            calendar: "Penn",
            display_url: "https://www.google.com/calendar/event?eid=lab",
          },
          { title: "Brunch", start: "2026-10-25T11:00:00-04:00", end: "2026-10-25T12:00:00-04:00" },
          { title: "Fall break", start: "2026-10-24", end: "2026-10-25", is_all_day: true },
          { title: "Too late", start: "2026-10-26T09:00:00-04:00" },
        ]);
      }
      return accountId === "g1"
        ? inbox([{ sender: "Ann <a@x.com>", subject: "Hi", messageTimestamp: "2026-10-24T12:00:00Z" }])
        : inbox([{ sender: "Boss <b@x.com>", subject: "Q4", messageTimestamp: "2026-10-24T12:30:00Z" }]);
    });

    const today = await loadToday("user-1", NY, NOW);

    expect(mocks.execute.mock.calls.every(([userId]) => userId === "user-1")).toBe(true);
    expect([today.today, today.tomorrow]).toEqual(["2026-10-24", "2026-10-25"]);
    expect(today.events.map((e) => [e.title, e.day])).toEqual([
      ["Fall break", "2026-10-24"],
      ["Lab", "2026-10-24"],
      ["Brunch", "2026-10-25"],
    ]);
    expect(today.events[1].account).toBeUndefined(); // only one calendar, so no label…
    expect(today.events[1].url).toBe("https://www.google.com/calendar/event?eid=lab&authuser=me%40upenn.edu"); // …but its link names it
    expect(today.emails).toEqual([
      expect.objectContaining({ from: "Boss", subject: "Q4", account: "me@work.com" }),
      expect.objectContaining({ from: "Ann", account: "me@gmail.com" }),
    ]);
    expect(mocks.set).toHaveBeenCalledWith("today:v2:user-1", today, { ex: 120 });
  });

  it("keeps going when one account fails, says which, and doesn't cache the gap", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.accounts.mockResolvedValue(
      new Map([
        ["GOOGLECALENDAR", [{ id: "cal1", email: "me@upenn.edu" }]],
        ["GMAIL", [{ id: "g1", email: "me@gmail.com" }]],
      ]),
    );
    mocks.execute.mockImplementation(async (_u, slug) => {
      if (slug === "GMAIL") throw new Error("token expired");
      return calendar([]);
    });

    const today = await loadToday("user-1", NY, NOW);

    expect(today).toMatchObject({ events: [], emails: [], failed: ["me@gmail.com"], gmailConnected: true });
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("reports the connections as unavailable instead of failing when they can't be listed", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.accounts.mockRejectedValue(new Error("500 Failed to fetch API key information from DB"));

    expect(await loadToday("user-1", NY, NOW)).toMatchObject({ unavailable: true, events: [], emails: [] });
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("uses the cache for the same day, and says when nothing is connected", async () => {
    mocks.get.mockResolvedValueOnce({ today: "2026-10-24", events: [], emails: [], failed: [] });
    expect(await loadToday("user-1", NY, NOW)).toMatchObject({ today: "2026-10-24" });
    expect(mocks.accounts).not.toHaveBeenCalled();

    mocks.accounts.mockResolvedValue(new Map());
    expect(await loadToday("user-1", NY, NOW)).toMatchObject({ calendarConnected: false, gmailConnected: false });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
