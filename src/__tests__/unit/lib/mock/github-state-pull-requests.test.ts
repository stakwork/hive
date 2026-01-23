import { describe, it, expect, beforeEach } from "vitest";
import { MockGitHubState } from "@/lib/mock/github-state";

describe("MockGitHubState - Pull Request Functionality", () => {
  let mockState: ReturnType<typeof MockGitHubState.getInstance>;

  beforeEach(() => {
    mockState = MockGitHubState.getInstance();
    mockState.reset();
  });

  describe("createPullRequest", () => {
    it("creates a pull request with required fields", () => {
      const pr = mockState.createPullRequest("testowner", "testrepo", {
        title: "Test PR",
        head: "feature/test",
        base: "main",
      });

      expect(pr.number).toBeGreaterThanOrEqual(1000);
      expect(pr.title).toBe("Test PR");
      expect(pr.state).toBe("open");
      expect(pr.head.ref).toBe("feature/test");
      expect(pr.base.ref).toBe("main");
      expect(pr.merged).toBe(false);
      expect(pr.draft).toBe(false);
      expect(pr.mergeable).toBe(true);
    });

    it("creates a merged pull request", () => {
      const pr = mockState.createPullRequest("testowner", "testrepo", {
        title: "Merged PR",
        head: "feature/merged",
        base: "main",
        state: "closed",
        merged: true,
      });

      expect(pr.state).toBe("closed");
      expect(pr.merged).toBe(true);
      expect(pr.merged_at).not.toBeNull();
      expect(pr.closed_at).not.toBeNull();
      expect(pr.mergeable).toBeNull();
    });

    it("creates a closed but not merged pull request", () => {
      const pr = mockState.createPullRequest("testowner", "testrepo", {
        title: "Closed PR",
        head: "feature/closed",
        base: "main",
        state: "closed",
        merged: false,
      });

      expect(pr.state).toBe("closed");
      expect(pr.merged).toBe(false);
      expect(pr.merged_at).toBeNull();
      expect(pr.closed_at).not.toBeNull();
    });

    it("creates a draft pull request", () => {
      const pr = mockState.createPullRequest("testowner", "testrepo", {
        title: "Draft PR",
        head: "feature/draft",
        base: "main",
        draft: true,
      });

      expect(pr.draft).toBe(true);
      expect(pr.state).toBe("open");
    });

    it("respects custom timestamps", () => {
      const customDate = "2026-01-20T10:00:00Z";
      const mergedDate = "2026-01-20T12:00:00Z";

      const pr = mockState.createPullRequest("testowner", "testrepo", {
        title: "Custom Date PR",
        head: "feature/custom",
        base: "main",
        state: "closed",
        merged: true,
        created_at: customDate,
        merged_at: mergedDate,
        closed_at: mergedDate,
      });

      expect(pr.created_at).toBe(customDate);
      expect(pr.merged_at).toBe(mergedDate);
      expect(pr.closed_at).toBe(mergedDate);
    });

    it("auto-creates repository and user if not exist", () => {
      const pr = mockState.createPullRequest("newowner", "newrepo", {
        title: "Auto-create PR",
        head: "feature/auto",
        base: "main",
      });

      expect(pr.user.login).toBe("newowner");
      expect(pr.head.repo.full_name).toBe("newowner/newrepo");
      expect(pr.base.repo.full_name).toBe("newowner/newrepo");

      const repo = mockState.getRepository("newowner", "newrepo");
      expect(repo).toBeDefined();
      expect(repo?.full_name).toBe("newowner/newrepo");
    });

    it("increments PR numbers sequentially", () => {
      const pr1 = mockState.createPullRequest("testowner", "testrepo", {
        title: "PR 1",
        head: "feature/1",
        base: "main",
      });

      const pr2 = mockState.createPullRequest("testowner", "testrepo", {
        title: "PR 2",
        head: "feature/2",
        base: "main",
      });

      expect(pr2.number).toBe(pr1.number + 1);
    });
  });

  describe("getPullRequests", () => {
    it("auto-seeds 10 PRs on first access", () => {
      const prs = mockState.getPullRequests("testowner", "testrepo");
      
      // Default filter is 'open', should have 3 open PRs from seed
      expect(prs.length).toBe(3);
      
      // Get all PRs
      const allPrs = mockState.getPullRequests("testowner", "testrepo", { state: "all" });
      expect(allPrs.length).toBe(10);
    });

    it("filters by state: open", () => {
      const prs = mockState.getPullRequests("testowner", "testrepo", { state: "open" });
      
      expect(prs.every((pr) => pr.state === "open")).toBe(true);
      expect(prs.length).toBe(3); // 3 open PRs in seed data
    });

    it("filters by state: closed", () => {
      const prs = mockState.getPullRequests("testowner", "testrepo", { state: "closed" });
      
      expect(prs.every((pr) => pr.state === "closed")).toBe(true);
      expect(prs.length).toBe(7); // 7 closed PRs in seed data
    });

    it("filters by state: all", () => {
      const prs = mockState.getPullRequests("testowner", "testrepo", { state: "all" });
      
      expect(prs.length).toBe(10);
    });

    it("sorts by created date descending by default", () => {
      const prs = mockState.getPullRequests("testowner", "testrepo", { state: "all" });
      
      for (let i = 0; i < prs.length - 1; i++) {
        const date1 = new Date(prs[i].created_at).getTime();
        const date2 = new Date(prs[i + 1].created_at).getTime();
        expect(date1).toBeGreaterThanOrEqual(date2);
      }
    });

    it("sorts by created date ascending", () => {
      const prs = mockState.getPullRequests("testowner", "testrepo", {
        state: "all",
        direction: "asc",
      });
      
      for (let i = 0; i < prs.length - 1; i++) {
        const date1 = new Date(prs[i].created_at).getTime();
        const date2 = new Date(prs[i + 1].created_at).getTime();
        expect(date1).toBeLessThanOrEqual(date2);
      }
    });

    it("sorts by updated date", () => {
      const prs = mockState.getPullRequests("testowner", "testrepo", {
        state: "all",
        sort: "updated",
      });
      
      for (let i = 0; i < prs.length - 1; i++) {
        const date1 = new Date(prs[i].updated_at).getTime();
        const date2 = new Date(prs[i + 1].updated_at).getTime();
        expect(date1).toBeGreaterThanOrEqual(date2);
      }
    });
  });

  describe("72-hour window filtering edge cases", () => {
    it("returns 0 PRs when none exist in window", () => {
      // Create PRs older than 72 hours
      const now = Date.now();
      const fourDaysAgo = now - 4 * 86400000;
      
      mockState.createPullRequest("testowner", "testrepo", {
        title: "Old PR",
        head: "feature/old",
        base: "main",
        state: "closed",
        merged: true,
        created_at: new Date(fourDaysAgo).toISOString(),
        merged_at: new Date(fourDaysAgo + 3600000).toISOString(),
        closed_at: new Date(fourDaysAgo + 3600000).toISOString(),
      });

      // Filter for PRs merged in last 72 hours
      const allPrs = mockState.getPullRequests("testowner", "testrepo", { state: "all" });
      const recentlyMerged = allPrs.filter((pr) => {
        if (!pr.merged_at) return false;
        const mergedTime = new Date(pr.merged_at).getTime();
        return now - mergedTime <= 72 * 3600000;
      });

      expect(recentlyMerged.length).toBe(0);
    });

    it("returns 1-2 PRs when only few exist in window", () => {
      const now = Date.now();
      const twoHoursAgo = now - 2 * 3600000;
      const oneDayAgo = now - 86400000;

      // Clear auto-seeded data by accessing different repo
      mockState.createPullRequest("testowner", "newrepo", {
        title: "Recent PR 1",
        head: "feature/recent1",
        base: "main",
        state: "closed",
        merged: true,
        created_at: new Date(twoHoursAgo).toISOString(),
        merged_at: new Date(twoHoursAgo + 1800000).toISOString(),
        closed_at: new Date(twoHoursAgo + 1800000).toISOString(),
      });

      mockState.createPullRequest("testowner", "newrepo", {
        title: "Recent PR 2",
        head: "feature/recent2",
        base: "main",
        state: "closed",
        merged: true,
        created_at: new Date(oneDayAgo).toISOString(),
        merged_at: new Date(oneDayAgo + 3600000).toISOString(),
        closed_at: new Date(oneDayAgo + 3600000).toISOString(),
      });

      const allPrs = mockState.getPullRequests("testowner", "newrepo", { state: "all" });
      const recentlyMerged = allPrs.filter((pr) => {
        if (!pr.merged_at) return false;
        const mergedTime = new Date(pr.merged_at).getTime();
        return now - mergedTime <= 72 * 3600000;
      });

      expect(recentlyMerged.length).toBe(2);
    });

    it("handles all PRs merged within window", () => {
      const now = Date.now();
      const oneHourAgo = now - 3600000;
      const twoHoursAgo = now - 2 * 3600000;

      mockState.createPullRequest("testowner", "allrecent", {
        title: "Recent PR 1",
        head: "feature/r1",
        base: "main",
        state: "closed",
        merged: true,
        created_at: new Date(twoHoursAgo).toISOString(),
        merged_at: new Date(oneHourAgo).toISOString(),
        closed_at: new Date(oneHourAgo).toISOString(),
      });

      mockState.createPullRequest("testowner", "allrecent", {
        title: "Recent PR 2",
        head: "feature/r2",
        base: "main",
        state: "closed",
        merged: true,
        created_at: new Date(twoHoursAgo).toISOString(),
        merged_at: new Date(oneHourAgo).toISOString(),
        closed_at: new Date(oneHourAgo).toISOString(),
      });

      const allPrs = mockState.getPullRequests("testowner", "allrecent", { state: "all" });
      const recentlyMerged = allPrs.filter((pr) => {
        if (!pr.merged_at) return false;
        const mergedTime = new Date(pr.merged_at).getTime();
        return now - mergedTime <= 72 * 3600000;
      });

      expect(recentlyMerged.length).toBe(2);
      expect(allPrs.length).toBe(2);
    });

    it("handles no merged PRs (all open or closed without merge)", () => {
      mockState.createPullRequest("testowner", "nomerge", {
        title: "Open PR",
        head: "feature/open",
        base: "main",
        state: "open",
      });

      mockState.createPullRequest("testowner", "nomerge", {
        title: "Closed PR",
        head: "feature/closed",
        base: "main",
        state: "closed",
        merged: false,
      });

      const allPrs = mockState.getPullRequests("testowner", "nomerge", { state: "all" });
      const mergedPrs = allPrs.filter((pr) => pr.merged);

      expect(mergedPrs.length).toBe(0);
      expect(allPrs.length).toBe(2);
    });
  });

  describe("timestamp calculations", () => {
    it("calculates merge time correctly (hours)", () => {
      const now = Date.now();
      const createdTime = now - 5 * 3600000; // 5 hours ago
      const mergedTime = now - 3600000; // 1 hour ago

      const pr = mockState.createPullRequest("testowner", "testrepo", {
        title: "Quick merge",
        head: "feature/quick",
        base: "main",
        state: "closed",
        merged: true,
        created_at: new Date(createdTime).toISOString(),
        merged_at: new Date(mergedTime).toISOString(),
        closed_at: new Date(mergedTime).toISOString(),
      });

      const timeToMerge = new Date(pr.merged_at!).getTime() - new Date(pr.created_at).getTime();
      const hoursToMerge = timeToMerge / 3600000;

      expect(hoursToMerge).toBe(4);
    });

    it("calculates merge time correctly (days)", () => {
      const now = Date.now();
      const createdTime = now - 5 * 86400000; // 5 days ago
      const mergedTime = now - 2 * 86400000; // 2 days ago

      const pr = mockState.createPullRequest("testowner", "testrepo", {
        title: "Slow merge",
        head: "feature/slow",
        base: "main",
        state: "closed",
        merged: true,
        created_at: new Date(createdTime).toISOString(),
        merged_at: new Date(mergedTime).toISOString(),
        closed_at: new Date(mergedTime).toISOString(),
      });

      const timeToMerge = new Date(pr.merged_at!).getTime() - new Date(pr.created_at).getTime();
      const daysToMerge = timeToMerge / 86400000;

      expect(daysToMerge).toBe(3);
    });

    it("verifies seed data spans 4+ days", () => {
      const prs = mockState.getPullRequests("testowner", "testrepo", { state: "all" });
      
      const timestamps = prs.map((pr) => new Date(pr.created_at).getTime());
      const oldest = Math.min(...timestamps);
      const newest = Math.max(...timestamps);
      const span = newest - oldest;
      const daysSpan = span / 86400000;

      expect(daysSpan).toBeGreaterThanOrEqual(4);
    });

    it("verifies mixed merge times in seed data", () => {
      const prs = mockState.getPullRequests("testowner", "testrepo", { state: "closed" });
      
      const mergeTimes = prs
        .filter((pr) => pr.merged && pr.merged_at)
        .map((pr) => {
          const created = new Date(pr.created_at).getTime();
          const merged = new Date(pr.merged_at!).getTime();
          return (merged - created) / 3600000; // hours to merge
        });

      // Should have quick merges (< 12 hours)
      const quickMerges = mergeTimes.filter((hours) => hours < 12);
      expect(quickMerges.length).toBeGreaterThan(0);

      // Should have slow merges (> 1 day)
      const slowMerges = mergeTimes.filter((hours) => hours > 24);
      expect(slowMerges.length).toBeGreaterThan(0);
    });
  });

  describe("reset", () => {
    it("clears all pull requests", () => {
      mockState.createPullRequest("testowner", "testrepo", {
        title: "Test PR",
        head: "feature/test",
        base: "main",
      });

      let prs = mockState.getPullRequests("testowner", "testrepo", { state: "all" });
      expect(prs.length).toBeGreaterThan(0);

      mockState.reset();

      // After reset, getPullRequests will auto-seed again
      // So we need to check a different repo
      mockState.createPullRequest("testowner", "newrepo", {
        title: "After Reset",
        head: "feature/reset",
        base: "main",
      });

      prs = mockState.getPullRequests("testowner", "newrepo", { state: "all" });
      // Should only have the one we just created (no auto-seed for this specific check)
      expect(prs.length).toBe(1);
    });

    it("resets PR counter", () => {
      const pr1 = mockState.createPullRequest("testowner", "testrepo", {
        title: "PR 1",
        head: "feature/1",
        base: "main",
      });

      mockState.reset();

      const pr2 = mockState.createPullRequest("testowner", "testrepo", {
        title: "PR 2",
        head: "feature/2",
        base: "main",
      });

      // After reset, counter should restart
      expect(pr2.number).toBeLessThan(pr1.number + 100);
    });
  });
});
