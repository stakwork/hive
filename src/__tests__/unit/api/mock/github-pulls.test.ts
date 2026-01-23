import { describe, it, expect, beforeEach } from "vitest";
import { GET } from "@/app/api/mock/github/repos/[owner]/[repo]/pulls/route.ts";
import { NextRequest } from "next/server";
import { MockGitHubState } from "@/lib/mock/github-state";

describe("Mock GitHub Pull Requests API Endpoint", () => {
  let mockState: ReturnType<typeof MockGitHubState.getInstance>;

  beforeEach(() => {
    mockState = MockGitHubState.getInstance();
    mockState.reset();
  });

  describe("GET /api/mock/github/repos/[owner]/[repo]/pulls", () => {
    it("requires authentication", async () => {
      const request = new NextRequest(
        "http://localhost:3000/api/mock/github/repos/testowner/testrepo/pulls"
      );

      const params = Promise.resolve({ owner: "testowner", repo: "testrepo" });
      const response = await GET(request, { params });

      expect(response.status).toBe(401);
      const data = await response.json();
      expect(data.message).toBe("Requires authentication");
    });

    it("returns open PRs by default", async () => {
      const request = new NextRequest(
        "http://localhost:3000/api/mock/github/repos/testowner/testrepo/pulls",
        {
          headers: {
            Authorization: "Bearer test_token",
          },
        }
      );

      const params = Promise.resolve({ owner: "testowner", repo: "testrepo" });
      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(Array.isArray(data)).toBe(true);
      expect(data.length).toBe(3); // 3 open PRs in seed data
      expect(data.every((pr: any) => pr.state === "open")).toBe(true);
    });

    it("filters by state: closed", async () => {
      const request = new NextRequest(
        "http://localhost:3000/api/mock/github/repos/testowner/testrepo/pulls?state=closed",
        {
          headers: {
            Authorization: "Bearer test_token",
          },
        }
      );

      const params = Promise.resolve({ owner: "testowner", repo: "testrepo" });
      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(data.length).toBe(7); // 7 closed PRs in seed data
      expect(data.every((pr: any) => pr.state === "closed")).toBe(true);
    });

    it("filters by state: all", async () => {
      const request = new NextRequest(
        "http://localhost:3000/api/mock/github/repos/testowner/testrepo/pulls?state=all",
        {
          headers: {
            Authorization: "Bearer test_token",
          },
        }
      );

      const params = Promise.resolve({ owner: "testowner", repo: "testrepo" });
      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(data.length).toBe(10); // All 10 PRs
    });

    it("supports per_page parameter", async () => {
      const request = new NextRequest(
        "http://localhost:3000/api/mock/github/repos/testowner/testrepo/pulls?state=all&per_page=5",
        {
          headers: {
            Authorization: "Bearer test_token",
          },
        }
      );

      const params = Promise.resolve({ owner: "testowner", repo: "testrepo" });
      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(data.length).toBe(5);
    });

    it("supports pagination with page parameter", async () => {
      const request = new NextRequest(
        "http://localhost:3000/api/mock/github/repos/testowner/testrepo/pulls?state=all&per_page=5&page=2",
        {
          headers: {
            Authorization: "Bearer test_token",
          },
        }
      );

      const params = Promise.resolve({ owner: "testowner", repo: "testrepo" });
      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(data.length).toBe(5); // Second page of 5
    });

    it("limits per_page to maximum of 100", async () => {
      // Create more PRs to test limit
      for (let i = 0; i < 120; i++) {
        mockState.createPullRequest("testowner", "largerepo", {
          title: `PR ${i}`,
          head: `feature/${i}`,
          base: "main",
        });
      }

      const request = new NextRequest(
        "http://localhost:3000/api/mock/github/repos/testowner/largerepo/pulls?state=all&per_page=150",
        {
          headers: {
            Authorization: "Bearer test_token",
          },
        }
      );

      const params = Promise.resolve({ owner: "testowner", repo: "largerepo" });
      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(data.length).toBeLessThanOrEqual(100);
    });

    it("supports sort by created", async () => {
      const request = new NextRequest(
        "http://localhost:3000/api/mock/github/repos/testowner/testrepo/pulls?state=all&sort=created",
        {
          headers: {
            Authorization: "Bearer test_token",
          },
        }
      );

      const params = Promise.resolve({ owner: "testowner", repo: "testrepo" });
      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      const data = await response.json();
      
      // Verify descending order by default
      for (let i = 0; i < data.length - 1; i++) {
        const date1 = new Date(data[i].created_at).getTime();
        const date2 = new Date(data[i + 1].created_at).getTime();
        expect(date1).toBeGreaterThanOrEqual(date2);
      }
    });

    it("supports sort by updated", async () => {
      const request = new NextRequest(
        "http://localhost:3000/api/mock/github/repos/testowner/testrepo/pulls?state=all&sort=updated",
        {
          headers: {
            Authorization: "Bearer test_token",
          },
        }
      );

      const params = Promise.resolve({ owner: "testowner", repo: "testrepo" });
      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      const data = await response.json();
      
      // Verify descending order by default
      for (let i = 0; i < data.length - 1; i++) {
        const date1 = new Date(data[i].updated_at).getTime();
        const date2 = new Date(data[i + 1].updated_at).getTime();
        expect(date1).toBeGreaterThanOrEqual(date2);
      }
    });

    it("supports direction=asc", async () => {
      const request = new NextRequest(
        "http://localhost:3000/api/mock/github/repos/testowner/testrepo/pulls?state=all&direction=asc",
        {
          headers: {
            Authorization: "Bearer test_token",
          },
        }
      );

      const params = Promise.resolve({ owner: "testowner", repo: "testrepo" });
      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      const data = await response.json();
      
      // Verify ascending order
      for (let i = 0; i < data.length - 1; i++) {
        const date1 = new Date(data[i].created_at).getTime();
        const date2 = new Date(data[i + 1].created_at).getTime();
        expect(date1).toBeLessThanOrEqual(date2);
      }
    });

    it("auto-creates repository if not exists", async () => {
      const request = new NextRequest(
        "http://localhost:3000/api/mock/github/repos/newowner/newrepo/pulls",
        {
          headers: {
            Authorization: "Bearer test_token",
          },
        }
      );

      const params = Promise.resolve({ owner: "newowner", repo: "newrepo" });
      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      
      const repo = mockState.getRepository("newowner", "newrepo");
      expect(repo).toBeDefined();
    });

    it("returns valid PR structure", async () => {
      const request = new NextRequest(
        "http://localhost:3000/api/mock/github/repos/testowner/testrepo/pulls?state=all",
        {
          headers: {
            Authorization: "Bearer test_token",
          },
        }
      );

      const params = Promise.resolve({ owner: "testowner", repo: "testrepo" });
      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(data.length).toBeGreaterThan(0);
      const pr = data[0];
      
      // Verify PR structure
      expect(pr).toHaveProperty("number");
      expect(pr).toHaveProperty("state");
      expect(pr).toHaveProperty("title");
      expect(pr).toHaveProperty("body");
      expect(pr).toHaveProperty("created_at");
      expect(pr).toHaveProperty("updated_at");
      expect(pr).toHaveProperty("merged_at");
      expect(pr).toHaveProperty("closed_at");
      expect(pr).toHaveProperty("head");
      expect(pr).toHaveProperty("base");
      expect(pr).toHaveProperty("user");
      expect(pr).toHaveProperty("html_url");
      expect(pr).toHaveProperty("merged");
      expect(pr).toHaveProperty("mergeable");
      expect(pr).toHaveProperty("draft");

      // Verify nested structures
      expect(pr.head).toHaveProperty("ref");
      expect(pr.head).toHaveProperty("sha");
      expect(pr.head).toHaveProperty("repo");
      expect(pr.base).toHaveProperty("ref");
      expect(pr.base).toHaveProperty("sha");
      expect(pr.base).toHaveProperty("repo");
      expect(pr.user).toHaveProperty("login");
      expect(pr.user).toHaveProperty("id");
      expect(pr.user).toHaveProperty("avatar_url");
    });

    it("handles empty results for non-existent state", async () => {
      // Create repo with only closed PRs
      mockState.createPullRequest("testowner", "closedonly", {
        title: "Closed PR",
        head: "feature/closed",
        base: "main",
        state: "closed",
        merged: true,
      });

      const request = new NextRequest(
        "http://localhost:3000/api/mock/github/repos/testowner/closedonly/pulls?state=open",
        {
          headers: {
            Authorization: "Bearer test_token",
          },
        }
      );

      const params = Promise.resolve({ owner: "testowner", repo: "closedonly" });
      const response = await GET(request, { params });

      expect(response.status).toBe(200);
      const data = await response.json();
      
      expect(data.length).toBe(0);
    });
  });
});
