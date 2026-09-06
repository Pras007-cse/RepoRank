import { describe, it, expect, vi } from "vitest";
import {
  withRateLimitGuard,
  GitHubRateLimitError,
  isRepoStarredByUser,
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

  describe("isRepoStarredByUser", () => {
    it("returns true when GitHub confirms the star (HTTP 204)", async () => {
      const mockOctokit = {
        request: vi.fn().mockResolvedValue({ status: 204 }),
      } as unknown as Octokit;

      const result = await isRepoStarredByUser(mockOctokit, "testowner", "testrepo");
      expect(result).toBe(true);
      expect(mockOctokit.request).toHaveBeenCalledWith(
        "GET /user/starred/{owner}/{repo}",
        { owner: "testowner", repo: "testrepo" }
      );
    });

    it("returns false when GitHub reports the repo is not starred (HTTP 404)", async () => {
      const notFoundErr = { status: 404, message: "Not Found" };
      const mockOctokit = {
        request: vi.fn().mockRejectedValue(notFoundErr),
      } as unknown as Octokit;

      const result = await isRepoStarredByUser(mockOctokit, "testowner", "testrepo");
      expect(result).toBe(false);
    });

    it("rethrows unexpected API errors (e.g. HTTP 500 internal server error)", async () => {
      const serverErr = { status: 500, message: "Internal Server Error" };
      const mockOctokit = {
        request: vi.fn().mockRejectedValue(serverErr),
      } as unknown as Octokit;

      await expect(
        isRepoStarredByUser(mockOctokit, "testowner", "testrepo")
      ).rejects.toEqual(serverErr);
    });
  });
});
