import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "@/app/api/learnings/docs/learn/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import {
  createTestWorkspaceScenario,
  createTestSwarm,
} from "@/__tests__/support/factories";
import {
  createPostRequest,
  createAuthenticatedPostRequest,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import type { User, Workspace, Swarm } from "@prisma/client";

// Mock fetch for swarm calls
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

describe("POST /api/learnings/docs/learn", () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;

  beforeEach(async () => {
    vi.clearAllMocks();

    await db.$transaction(async (tx) => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "Learn Docs Owner" },
        members: [],
      });

      owner = scenario.owner;
      workspace = scenario.workspace;

      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField(
        "swarmApiKey",
        "test-learn-docs-api-key"
      );

      swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: `test-learn-docs-swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
      });

      await tx.swarm.update({
        where: { id: swarm.id },
        data: {
          swarmUrl: "https://test-learn-docs-swarm.sphinx.chat",
          swarmApiKey: JSON.stringify(encryptedApiKey),
        },
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("Authentication", () => {
    it("returns 401 for unauthenticated requests", async () => {
      const request = createPostRequest("/api/learnings/docs/learn", {
        workspace: workspace.slug,
        repo_url: "https://github.com/org/repo",
      });

      const response = await POST(request);

      expect(response.status).toBe(401);
    });
  });

  describe("Validation", () => {
    it("returns 400 when workspace is missing", async () => {
      const request = createAuthenticatedPostRequest(
        "/api/learnings/docs/learn",
        owner,
        { repo_url: "https://github.com/org/repo" }
      );

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("workspace");
    });

    it("returns 400 when repo_url is missing", async () => {
      const request = createAuthenticatedPostRequest(
        "/api/learnings/docs/learn",
        owner,
        { workspace: workspace.slug }
      );

      const response = await POST(request);

      expect(response.status).toBe(400);
      const data = await response.json();
      expect(data.error).toContain("repo_url");
    });
  });

  describe("Success", () => {
    it("proxies to swarm /learn_docs and returns swarm response", async () => {
      const swarmResponse = {
        message: "Documentation learned",
        summaries: {},
        usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => swarmResponse,
      });

      const repoUrl = "https://github.com/org/my-repo";
      const request = createAuthenticatedPostRequest(
        "/api/learnings/docs/learn",
        owner,
        { workspace: workspace.slug, repo_url: repoUrl }
      );

      const response = await POST(request);

      expect(response.status).toBe(200);
      const data = await response.json();
      expect(data).toEqual(swarmResponse);

      // Verify the swarm was called correctly
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining("/learn_docs"),
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ repo_url: repoUrl }),
          headers: expect.objectContaining({
            "x-api-token": "test-learn-docs-api-key",
          }),
        })
      );
    });
  });

  describe("Error handling", () => {
    it("returns 500 when swarm fetch fails", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
      });

      const request = createAuthenticatedPostRequest(
        "/api/learnings/docs/learn",
        owner,
        { workspace: workspace.slug, repo_url: "https://github.com/org/repo" }
      );

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe("Failed to trigger documentation learning");
    });

    it("returns 500 when swarm fetch throws", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      const request = createAuthenticatedPostRequest(
        "/api/learnings/docs/learn",
        owner,
        { workspace: workspace.slug, repo_url: "https://github.com/org/repo" }
      );

      const response = await POST(request);

      expect(response.status).toBe(500);
      const data = await response.json();
      expect(data.error).toBe("Failed to trigger documentation learning");
    });
  });
});
