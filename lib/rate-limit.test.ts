import { beforeEach, describe, expect, it } from "vitest";
import { clientKey, rateLimit, resetRateLimits } from "./rate-limit";

beforeEach(() => resetRateLimits());

describe("rateLimit", () => {
  it("allows up to the limit and refuses the next one", () => {
    for (let i = 0; i < 3; i++) expect(rateLimit("a", 3, 60_000, 1000).ok).toBe(true);
    expect(rateLimit("a", 3, 60_000, 1000).ok).toBe(false);
  });

  it("lets the caller back in once the window has slid past", () => {
    for (let i = 0; i < 3; i++) rateLimit("b", 3, 60_000, 1000);
    expect(rateLimit("b", 3, 60_000, 1000).ok).toBe(false);
    expect(rateLimit("b", 3, 60_000, 61_001).ok).toBe(true);
  });

  it("keeps callers in separate buckets", () => {
    for (let i = 0; i < 3; i++) rateLimit("c", 3, 60_000, 1000);
    expect(rateLimit("c", 3, 60_000, 1000).ok).toBe(false);
    expect(rateLimit("d", 3, 60_000, 1000).ok).toBe(true);
  });

  it("reports a retry-after that is never zero", () => {
    for (let i = 0; i < 3; i++) rateLimit("e", 3, 60_000, 1000);
    const { retryAfterSeconds } = rateLimit("e", 3, 60_000, 60_500);
    expect(retryAfterSeconds).toBeGreaterThan(0);
  });

  it("does not count a refused attempt against the window", () => {
    for (let i = 0; i < 3; i++) rateLimit("f", 3, 60_000, 1000);
    rateLimit("f", 3, 60_000, 30_000); // refused
    // The window still clears 60s after the ORIGINAL three, not after the refusal.
    expect(rateLimit("f", 3, 60_000, 61_001).ok).toBe(true);
  });
});

describe("clientKey", () => {
  const req = (headers: Record<string, string>) =>
    new Request("https://example.com/api/call", { method: "POST", headers });

  it("takes the left-most forwarded address", () => {
    expect(clientKey(req({ "x-forwarded-for": "203.0.113.5, 70.41.3.18" }))).toBe("203.0.113.5");
  });

  it("falls back to x-real-ip", () => {
    expect(clientKey(req({ "x-real-ip": "203.0.113.9" }))).toBe("203.0.113.9");
  });

  it("buckets unidentifiable callers together rather than exempting them", () => {
    expect(clientKey(req({}))).toBe("unknown");
  });
});
