import { describe, expect, it } from "vitest";
import { PLAN_LIMITS } from "./limits";
import { PLAN_MODELS, webTools } from "./models";

describe("plan models", () => {
  it("every plan has models", () => {
    expect(Object.keys(PLAN_MODELS).sort()).toEqual(Object.keys(PLAN_LIMITS).sort());
  });

  it("gives web search and fetch only to plans that include them", () => {
    expect(webTools("free", "America/New_York")).toEqual({});
    expect(Object.keys(webTools("max", "America/New_York")).sort()).toEqual(["web_fetch", "web_search"]);
  });
});
