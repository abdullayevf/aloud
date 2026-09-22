import { describe, expect, it } from "vitest";
import { buildTokenUrl } from "./token";

describe("buildTokenUrl", () => {
  it("targets the voice agent token endpoint", () => {
    const url = buildTokenUrl();
    expect(url.origin + url.pathname).toBe("https://agents.assemblyai.com/v1/token");
  });

  it("always sends expires_in_seconds, which the API requires", () => {
    const value = Number(buildTokenUrl().searchParams.get("expires_in_seconds"));
    expect(value).toBeGreaterThanOrEqual(1);
    expect(value).toBeLessThanOrEqual(600);
  });

  it("caps the session so a leaked socket cannot bill for three hours", () => {
    expect(Number(buildTokenUrl().searchParams.get("max_session_duration_seconds"))).toBe(600);
  });
});
