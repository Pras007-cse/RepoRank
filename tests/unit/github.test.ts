import { describe, it, expect } from "vitest";
import {
  withRateLimitGuard,
  GitHubRateLimitError,
  parseRepoUrl,
} from "@/lib/github";
import type { Octokit } from "@octokit/rest";

describe("src/lib/github.ts", () => {
  describe("withRateLimitGuard", () => {
    const mockOctokit = {} as Octokit;

    it("returns result when the wrapped API call succeeds", async () => {
      const result = await withRateLimitGuard(mockOctokit, async () => "success");
      expect(result).toBe("success");
    });

    it("throws GitHubRateLimitError when status is 403 and remaining quota is 0", async () => {
      const resetUnixSeconds = 1700000000;
      const rateLimitErr = {
        status: 403,
        response: {
          headers: {
            "x-ratelimit-remaining": "0",
            "x-ratelimit-reset": String(resetUnixSeconds),
          },
        },
      };

      await expect(
        withRateLimitGuard(mockOctokit, async () => {
          throw rateLimitErr;
        })
      ).rejects.toThrow(GitHubRateLimitError);

      try {
        await withRateLimitGuard(mockOctokit, async () => {
          throw rateLimitErr;
        });
      } catch (err: any) {
        expect(err.name).toBe("GitHubRateLimitError");
        expect(err.resetAt).toEqual(new Date(resetUnixSeconds * 1000));
      }
    });

    it("rethrows standard errors when not related to rate limits", async () => {
      const genericError = new Error("Network connection dropped");

      await expect(
        withRateLimitGuard(mockOctokit, async () => {
          throw genericError;
        })
      ).rejects.toThrow("Network connection dropped");
    });
  });

  describe("parseRepoUrl", () => {
    it("parses a plain github.com repo URL into owner/repo", () => {
      expect(parseRepoUrl("https://github.com/octocat/Hello-World")).toEqual({
        owner: "octocat",
        repo: "Hello-World",
      });
    });

    it("strips a trailing .git and trailing slash", () => {
      expect(parseRepoUrl("https://github.com/octocat/Hello-World.git")).toEqual({
        owner: "octocat",
        repo: "Hello-World",
      });
      expect(parseRepoUrl("https://github.com/octocat/Hello-World/")).toEqual({
        owner: "octocat",
        repo: "Hello-World",
      });
    });

    it("rejects non-github.com hosts (SSRF prevention)", () => {
      expect(parseRepoUrl("https://evil.com/octocat/Hello-World")).toBeNull();
      expect(parseRepoUrl("https://github.com.evil.com/octocat/Hello-World")).toBeNull();
    });

    it("rejects URLs with extra path segments, query strings, or fragments", () => {
      expect(parseRepoUrl("https://github.com/octocat/Hello-World/issues/1")).toBeNull();
      expect(parseRepoUrl("https://github.com/octocat/Hello-World?tab=readme")).toBeNull();
    });

    it("rejects non-URL garbage", () => {
      expect(parseRepoUrl("not a url")).toBeNull();
      expect(parseRepoUrl("javascript:alert(1)")).toBeNull();
    });
  });
});
