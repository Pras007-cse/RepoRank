import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { rateLimit } from "@/lib/rateLimit";

describe("src/lib/rateLimit.ts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows initial request and initializes bucket with correct remaining count", () => {
    const key = "test_user_initial";
    const res = rateLimit(key, { limit: 5, windowMs: 60_000 });

    expect(res.allowed).toBe(true);
    expect(res.remaining).toBe(4);
    expect(res.resetAt).toBeGreaterThan(Date.now());
  });

  it("decrements remaining count on subsequent requests within the window", () => {
    const key = "test_user_subsequent";
    rateLimit(key, { limit: 3, windowMs: 60_000 });
    const res2 = rateLimit(key, { limit: 3, windowMs: 60_000 });

    expect(res2.allowed).toBe(true);
    expect(res2.remaining).toBe(1);

    const res3 = rateLimit(key, { limit: 3, windowMs: 60_000 });
    expect(res3.allowed).toBe(true);
    expect(res3.remaining).toBe(0);
  });

  it("blocks requests once the limit is exhausted", () => {
    const key = "test_user_exhausted";
    for (let i = 0; i < 3; i++) {
      rateLimit(key, { limit: 3, windowMs: 60_000 });
    }

    const blocked = rateLimit(key, { limit: 3, windowMs: 60_000 });
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
  });

  it("resets remaining count after the window passes", () => {
    const key = "test_user_reset";
    for (let i = 0; i < 2; i++) {
      rateLimit(key, { limit: 2, windowMs: 10_000 });
    }

    const blocked = rateLimit(key, { limit: 2, windowMs: 10_000 });
    expect(blocked.allowed).toBe(false);

    // Fast-forward time past window
    vi.advanceTimersByTime(10_001);

    const afterReset = rateLimit(key, { limit: 2, windowMs: 10_000 });
    expect(afterReset.allowed).toBe(true);
    expect(afterReset.remaining).toBe(1);
  });

  it("tracks rate limits independently across different keys", () => {
    const key1 = "user_alpha";
    const key2 = "user_beta";

    rateLimit(key1, { limit: 1, windowMs: 60_000 });
    const blockedUser1 = rateLimit(key1, { limit: 1, windowMs: 60_000 });
    const allowedUser2 = rateLimit(key2, { limit: 1, windowMs: 60_000 });

    expect(blockedUser1.allowed).toBe(false);
    expect(allowedUser2.allowed).toBe(true);
  });
});
