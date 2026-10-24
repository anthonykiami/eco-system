import { afterEach, describe, expect, it, vi } from "vitest";

const loadEnv = async () => (await import("./env")).env;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("APP_URL in production", () => {
  it("rejects a localhost APP_URL on a Vercel production deploy", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("APP_URL", "http://localhost:3000");
    await expect(loadEnv()).rejects.toThrow(/APP_URL is http:\/\/localhost:3000 in production/);
  });

  it("allows the public URL in production and localhost elsewhere", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("APP_URL", "https://agent-eco.example.com");
    expect((await loadEnv()).APP_URL).toBe("https://agent-eco.example.com");

    vi.resetModules();
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("APP_URL", "http://localhost:3000");
    expect((await loadEnv()).APP_URL).toBe("http://localhost:3000");
  });
});
