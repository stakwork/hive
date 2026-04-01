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
  userId: string,
  username = "test-diagram-user",
  token = "test-diagram-pat"
) {
  const encryptionService = EncryptionService.getInstance();
  const encryptedToken = encryptionService.encryptField("access_token", token);

  await db.gitHubAuth.create({
    data: {
      userId,
      githubUserId: generateUniqueId("github"),
      githubUsername: username,
    },
  });

  await db.account.create({
    data: {
      userId,
      type: "oauth",
      provider: "github",
      providerAccountId: generateUniqueId("provider"),
      access_token: JSON.stringify(encryptedToken),
      token_type: "bearer",
      scope: "repo,user",
    },
  });
}

describe("POST /api/learnings/diagrams/create", () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;
  let repository: Repository;
  let repository2: Repository;
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

      swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: `test-diagram-create-swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
      });

      await tx.swarm.update({
        where: { id: swarm.id },
        data: {
          swarmUrl: "https://test-diagram-create.sphinx.chat",
          swarmApiKey: JSON.stringify(encryptedApiKey),
        },
      });

      repository = await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test-owner/test-diagram-repo",
        branch: "main",
      });

      repository2 = await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test-owner/test-diagram-repo-2",
        branch: "main",
      });

      // GitHub auth for owner
      await tx.gitHubAuth.create({
        data: {
          userId: owner.id,
          githubUserId: generateUniqueId("github"),
          githubUsername: "test-diagram-owner",
        },
      });
      const encryptedToken = encryptionService.encryptField(
        "access_token",
        "test-owner-diagram-pat"
      );
      await tx.account.create({
        data: {
          userId: owner.id,
          type: "oauth",
          provider: "github",
          providerAccountId: generateUniqueId("provider"),
          access_token: JSON.stringify(encryptedToken),
          token_type: "bearer",
          scope: "repo,user",
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
    const saved = await db.diagram.findUnique({ where: { id: data.diagram.id } });
    expect(saved).not.toBeNull();
    expect(saved?.name).toBe("Auth Flow");
    expect(saved?.createdBy).toBe(owner.id);

    // Verify groupId is set to the diagram's own id (versioning root)
    expect(saved?.groupId).toBe(data.diagram.id);
    expect(data.diagram.groupId).toBe(data.diagram.id);

    // Verify workspace link
    const link = await db.diagramWorkspace.findFirst({
      where: { diagramId: data.diagram.id, workspaceId: workspace.id },
    });
    expect(link).not.toBeNull();
  });

  it("should call repoAgent with all workspace repo URLs joined by comma", async () => {
    const mermaidBody = "graph TD\n  A --> B";
    vi.mocked(repoAgent).mockResolvedValue({ content: "```mermaid\n" + mermaidBody + "\n```" });

    const request = createAuthenticatedPostRequest(
      "/api/learnings/diagrams/create",
      { workspace: workspace.slug, name: "Multi Repo Diagram", prompt: "Show the system" },
      owner
    );
    const response = await POST(request);

    expect(response.status).toBe(200);
    const callArg = vi.mocked(repoAgent).mock.calls[0][2];
    expect(callArg.repo_url).toBe(
      "https://github.com/test-owner/test-diagram-repo,https://github.com/test-owner/test-diagram-repo-2"
    );
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
