import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "@/app/api/learnings/diagrams/create/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import {
  createTestWorkspaceScenario,
  createTestSwarm,
  createTestRepository,
} from "@/__tests__/support/fixtures";
import {
  createAuthenticatedPostRequest,
  createPostRequest,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import type { User, Workspace, Swarm, Repository } from "@prisma/client";

vi.mock("@/lib/ai/askTools", () => ({
  repoAgent: vi.fn(),
}));

import { repoAgent } from "@/lib/ai/askTools";

async function createGitHubAuth(
user_id: string,
  username = "test-diagram-user",
  token = "test-diagram-pat"
) {
  const encryptionService = EncryptionService.getInstance();
  const encryptedToken = encryptionService.encryptField("access_token", token);

  await db.github_auth.create({
    data: {
      userId,github_user_id: generateUniqueId("github"),github_username: username,
    },
  });

  await db.accounts.create({
    data: {
      userId,
      type: "oauth",
      provider: "github",provider_account_id: generateUniqueId("provider"),
      access_token: JSON.stringify(encryptedToken),
      token_type: "bearer",scope: "repo,user",
    },
  });
}

describe("POST /api/learnings/diagrams/create", () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;
  let repository: Repository;
  let memberViewer: User;
  let nonMember: User;

  beforeEach(async () => {
    await db.$transaction(async (tx) => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "Diagram Create Owner" },
        members: [{ role: "VIEWER" }],
      });

      owner = scenario.owner;
      workspace = scenario.workspace;
      memberViewer = scenario.members[0];

      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField(
        "swarmApiKey",
        "test-diagram-create-swarm-api-key"
      );

      swarm = await createTestSwarm({workspace_id: workspace.id,
        name: `test-diagram-create-swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
      });

      await tx.swarm.update({
        where: { id: swarm.id },
        data: {swarm_url: "https://test-diagram-create.sphinx.chat",swarm_api_key: JSON.stringify(encryptedApiKey),
        },
      });

      repository = await createTestRepository({workspace_id: workspace.id,repository_url: "https://github.com/test-owner/test-diagram-repo",
        branch: "main",
      });

      // GitHub auth for owner
      await tx.gitHubAuth.create({
        data: {user_id: owner.id,github_user_id: generateUniqueId("github"),github_username: "test-diagram-owner",
        },
      });
      const encryptedToken = encryptionService.encryptField(
        "access_token",
        "test-owner-diagram-pat"
      );
      await tx.account.create({
        data: {user_id: owner.id,
          type: "oauth",
          provider: "github",provider_account_id: generateUniqueId("provider"),
          access_token: JSON.stringify(encryptedToken),
          token_type: "bearer",scope: "repo,user",
        },
      });

      nonMember = await tx.user.create({
        data: {
          name: "Non Member User",
          email: `non-member-diagram-create-${generateUniqueId("user")}@example.com`,
        },
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return 401 for unauthenticated requests", async () => {
    const request = createPostRequest("/api/learnings/diagrams/create", {
      workspace: workspace.slug,
      name: "Test Diagram",
      prompt: "Show the auth flow",
    });
    const response = await POST(request);

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("should return 400 when workspace is missing", async () => {
    const request = createAuthenticatedPostRequest(
      "/api/learnings/diagrams/create",
      { name: "Test Diagram", prompt: "Show the auth flow" },
      owner
    );
    const response = await POST(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Missing required fields");
  });

  it("should return 400 when name is missing", async () => {
    const request = createAuthenticatedPostRequest(
      "/api/learnings/diagrams/create",
      { workspace: workspace.slug, prompt: "Show the auth flow" },
      owner
    );
    const response = await POST(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Missing required fields");
  });

  it("should return 400 when prompt is missing", async () => {
    const request = createAuthenticatedPostRequest(
      "/api/learnings/diagrams/create",
      { workspace: workspace.slug, name: "Test Diagram" },
      owner
    );
    const response = await POST(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Missing required fields");
  });

  it("should return 403 for non-member access", async () => {
    const request = createAuthenticatedPostRequest(
      "/api/learnings/diagrams/create",
      { workspace: workspace.slug, name: "Test Diagram", prompt: "Show auth flow" },
      nonMember
    );
    const response = await POST(request);

    expect(response.status).toBe(403);
  });

  it("should return 422 when repoAgent response contains no mermaid block", async () => {
    vi.mocked(repoAgent).mockResolvedValue({ content: "Here is some plain text with no mermaid block." });

    const request = createAuthenticatedPostRequest(
      "/api/learnings/diagrams/create",
      { workspace: workspace.slug, name: "No Mermaid", prompt: "Describe the system" },
      owner
    );
    const response = await POST(request);

    expect(response.status).toBe(422);
    const data = await response.json();
    expect(data.error).toBe("No mermaid diagram found in response");
  });

  it("should save diagram and return 200 when repoAgent returns a valid mermaid block", async () => {
    const mermaidBody = "graph TD\n  A[Client] --> B[API]\n  B --> C[DB]";
    vi.mocked(repoAgent).mockResolvedValue({ content: "```mermaid\n" + mermaidBody + "\n```" });

    const request = createAuthenticatedPostRequest(
      "/api/learnings/diagrams/create",
      { workspace: workspace.slug, name: "Auth Flow", prompt: "Show the auth flow" },
      owner
    );
    const response = await POST(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.diagram.name).toBe("Auth Flow");
    expect(data.diagram.body).toBe(mermaidBody);
    expect(data.diagram.description).toBeNull();

    // Verify DB record
    const saved = await db.diagrams.findUnique({ where: { id: data.diagram.id } });
    expect(saved).not.toBeNull();
    expect(saved?.name).toBe("Auth Flow");
    expect(saved?.createdBy).toBe(owner.id);

    // Verify groupId is set to the diagram's own id (versioning root)
    expect(saved?.groupId).toBe(data.diagram.id);
    expect(data.diagram.groupId).toBe(data.diagram.id);

    // Verify workspace link
    const link = await db.diagram_workspaces.findFirst({
      where: { diagramId: data.diagram.id,workspace_id: workspace.id },
    });
    expect(link).not.toBeNull();
  });

  it("should return 500 when repoAgent throws", async () => {
    vi.mocked(repoAgent).mockRejectedValue(new Error("No request_id returned from repo agent"));

    const request = createAuthenticatedPostRequest(
      "/api/learnings/diagrams/create",
      { workspace: workspace.slug, name: "No ID", prompt: "Test" },
      owner
    );
    const response = await POST(request);

    expect(response.status).toBe(500);
  });
});
