import { describe, expect, it } from "vitest";
import type { Agent } from "@/lib/db/schema";
import { agentSlug } from "@/lib/agents/naming";
import { findAgent, parseMention } from "./agent-handles";

const agent = (name: string, role: Agent["role"] = "specialized"): Agent => ({
  id: `id-${name}`,
  userId: "u",
  name,
  role,
  telegramTopicId: null,
  description: null,
  soul: "",
  createdAt: new Date(),
});

describe("agentSlug", () => {
  it("lowercases and joins words with underscores", () => {
    expect(agentSlug("Travel Planner")).toBe("travel_planner");
    expect(agentSlug("  🔎 Researcher! ")).toBe("researcher");
    expect(agentSlug("Café Bot")).toBe("cafe_bot");
    expect(agentSlug("🤖")).toBe("agent");
    // Non-Latin names keep their letters, so two of them don't collide.
    expect(agentSlug("Тренер")).toBe("тренер");
    expect(agentSlug("コーチ")).not.toBe(agentSlug("Тренер"));
  });
});

describe("parseMention", () => {
  it("reads a leading @handle and the rest of the message", () => {
    expect(parseMention("@researcher find sleep papers")).toEqual({ handle: "researcher", rest: "find sleep papers" });
    expect(parseMention("@coach, how was my week?")).toEqual({ handle: "coach", rest: "how was my week?" });
    expect(parseMention("@coach")).toEqual({ handle: "coach", rest: "" });
  });

  it("ignores mentions that aren't at the start", () => {
    expect(parseMention("email me@example.com")).toBeUndefined();
    expect(parseMention("hello")).toBeUndefined();
  });
});

describe("findAgent", () => {
  const primary = agent("Assistant", "primary");
  const travel = agent("Travel Planner");
  const trainer = agent("Trainer");
  const agents = [primary, travel, trainer];

  it("matches exact handles, names, and 'main'", () => {
    expect(findAgent(agents, "travel_planner")).toEqual({ status: "found", agent: travel });
    expect(findAgent(agents, "Travel Planner")).toEqual({ status: "found", agent: travel });
    expect(findAgent(agents, "@trainer")).toEqual({ status: "found", agent: trainer });
    expect(findAgent(agents, "main")).toEqual({ status: "found", agent: primary });
  });

  it("accepts a unique prefix and reports ambiguous ones", () => {
    expect(findAgent(agents, "trav")).toEqual({ status: "found", agent: travel });
    expect(findAgent(agents, "tr")).toEqual({ status: "ambiguous", agents: [travel, trainer] });
    expect(findAgent(agents, "chef")).toEqual({ status: "none" });
  });
});
