import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "@/app/api/learnings/diagrams/edit/route";
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

describe("POST /api/learnings/diagrams/edit", () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;
  let repository: Repository;
  let repository2: Repository;
  let nonMember: User;

  beforeEach(async () => {
    await db.$transaction(async (tx) => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "Diagram Edit Owner" },
      });

      owner = scenario.owner;
      workspace = scenario.workspace;

      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField(
        "swarmApiKey",
        "test-diagram-edit-swarm-api-key"
      );

      swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: `test-diagram-edit-swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
      });

      await tx.swarm.update({
        where: { id: swarm.id },
        data: {
          swarmUrl: "https://test-diagram-edit.sphinx.chat",
          swarmApiKey: JSON.stringify(encryptedApiKey),
        },
      });

      repository = await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test-owner/test-diagram-edit-repo",
        branch: "main",
      });

      repository2 = await createTestRepository({
        workspaceId: workspace.id,
        repositoryUrl: "https://github.com/test-owner/test-diagram-edit-repo-2",
        branch: "main",
      });

      // GitHub auth for owner
      await tx.gitHubAuth.create({
        data: {
          userId: owner.id,
          githubUserId: generateUniqueId("github"),
          githubUsername: "test-diagram-edit-owner",
        },
      });
      const encryptedToken = encryptionService.encryptField(
        "access_token",
        "test-owner-edit-diagram-pat"
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
          name: "Non Member Edit User",
          email: `non-member-diagram-edit-${generateUniqueId("user")}@example.com`,
        },
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return 401 for unauthenticated requests", async () => {
    const request = createPostRequest("/api/learnings/diagrams/edit", {
      workspace: workspace.slug,
      diagramId: "some-id",
      prompt: "Add a DB node",
    });
    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("should return 400 when required fields are missing", async () => {
    const request = createAuthenticatedPostRequest(
      "/api/learnings/diagrams/edit",
      { workspace: workspace.slug, diagramId: "some-id" },
      owner
    );
    const response = await POST(request);
    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Missing required fields");
  });

  it("should return 403 for non-member access", async () => {
    const request = createAuthenticatedPostRequest(
      "/api/learnings/diagrams/edit",
      { workspace: workspace.slug, diagramId: "some-id", prompt: "Add a DB node" },
      nonMember
    );
    const response = await POST(request);
    expect(response.status).toBe(403);
  });

  it("should return 404 when diagram does not exist", async () => {
    const request = createAuthenticatedPostRequest(
      "/api/learnings/diagrams/edit",
      { workspace: workspace.slug, diagramId: "nonexistent-diagram-id", prompt: "Add a DB node" },
      owner
    );
    const response = await POST(request);
    expect(response.status).toBe(404);
    const data = await response.json();
    expect(data.error).toBe("Diagram not found");
  });

  it("should create a new Diagram row with the same groupId as the source diagram", async () => {
    const originalBody = "graph TD\n  A[Client] --> B[API]";
    const sourceGroupId = generateUniqueId("group");

    // Create the original diagram
    const sourceDiagram = await db.diagram.create({
      data: {
        name: "Auth Flow",
        body: originalBody,
        description: null,
        createdBy: owner.id,
        groupId: sourceGroupId,
      },
    });
    await db.diagramWorkspace.create({
      data: { diagramId: sourceDiagram.id, workspaceId: workspace.id },
    });

    const updatedBody = "graph TD\n  A[Client] --> B[API]\n  B --> C[DB]";
    vi.mocked(repoAgent).mockResolvedValue({ content: "```mermaid\n" + updatedBody + "\n```" });

    const request = createAuthenticatedPostRequest(
      "/api/learnings/diagrams/edit",
      { workspace: workspace.slug, diagramId: sourceDiagram.id, prompt: "Add a DB node connected to API" },
      owner
    );
    const response = await POST(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.diagram.name).toBe("Auth Flow");
    expect(data.diagram.body).toBe(updatedBody);
    expect(data.diagram.groupId).toBe(sourceGroupId);

    // Must be a NEW row — different id from source
    expect(data.diagram.id).not.toBe(sourceDiagram.id);

    // Verify DB record
    const newRow = await db.diagram.findUnique({ where: { id: data.diagram.id } });
    expect(newRow).not.toBeNull();
    expect(newRow?.groupId).toBe(sourceGroupId);
    expect(newRow?.name).toBe("Auth Flow");
    expect(newRow?.body).toBe(updatedBody);

    // Verify workspace link for new row
    const link = await db.diagramWorkspace.findFirst({
      where: { diagramId: data.diagram.id, workspaceId: workspace.id },
    });
    expect(link).not.toBeNull();

    // Original diagram must still exist
    const original = await db.diagram.findUnique({ where: { id: sourceDiagram.id } });
    expect(original).not.toBeNull();
  });

  it("should build an augmented prompt containing the current diagram body", async () => {
    const originalBody = "graph TD\n  X --> Y";
    const sourceDiagram = await db.diagram.create({
      data: {
        name: "Flow",
        body: originalBody,
        description: null,
        createdBy: owner.id,
        groupId: generateUniqueId("group"),
      },
    });
    await db.diagramWorkspace.create({
      data: { diagramId: sourceDiagram.id, workspaceId: workspace.id },
    });

    vi.mocked(repoAgent).mockResolvedValue({ content: "```mermaid\ngraph TD\n  X --> Y\n  Y --> Z\n```" });

    const request = createAuthenticatedPostRequest(
      "/api/learnings/diagrams/edit",
      { workspace: workspace.slug, diagramId: sourceDiagram.id, prompt: "Add Z node" },
      owner
    );
    await POST(request);

    const callArg = vi.mocked(repoAgent).mock.calls[0][2];
    expect(callArg.prompt).toContain("<current-diagram>");
    expect(callArg.prompt).toContain(originalBody);
    expect(callArg.prompt).toContain("</current-diagram>");
    expect(callArg.prompt).toContain("<user-prompt>");
    expect(callArg.prompt).toContain("Add Z node");
    expect(callArg.prompt).toContain("</user-prompt>");
  });

  it("should call repoAgent with all workspace repo URLs joined by comma", async () => {
    const sourceDiagram = await db.diagram.create({
      data: {
        name: "Multi Repo Flow",
        body: "graph TD\n  A --> B",
        description: null,
        createdBy: owner.id,
        groupId: generateUniqueId("group"),
      },
    });
    await db.diagramWorkspace.create({
      data: { diagramId: sourceDiagram.id, workspaceId: workspace.id },
    });

    vi.mocked(repoAgent).mockResolvedValue({ content: "```mermaid\ngraph TD\n  A --> B --> C\n```" });

    const request = createAuthenticatedPostRequest(
      "/api/learnings/diagrams/edit",
      { workspace: workspace.slug, diagramId: sourceDiagram.id, prompt: "Add C node" },
      owner
    );
    const response = await POST(request);

    expect(response.status).toBe(200);
    const callArg = vi.mocked(repoAgent).mock.calls[0][2];
    expect(callArg.repo_url).toBe(
      "https://github.com/test-owner/test-diagram-edit-repo,https://github.com/test-owner/test-diagram-edit-repo-2"
    );
  });

  it("should pass resolved subAgents to repoAgent when prompt contains @mentions", async () => {
    // Create the source diagram
    const sourceDiagram = await db.diagram.create({
      data: {
        name: "Flow",
        body: "graph TD\n  A --> B",
        description: null,
        createdBy: owner.id,
        groupId: generateUniqueId("group"),
      },
    });
    await db.diagramWorkspace.create({
      data: { diagramId: sourceDiagram.id, workspaceId: workspace.id },
    });

    // Create a second workspace with swarm + repository
    const scenario2 = await createTestWorkspaceScenario({
      owner: { name: "Second WS Edit Owner" },
      workspace: { slug: `second-ws-edit-${generateUniqueId("ws")}` },
    });
    const workspace2 = scenario2.workspace;

    // Add the original owner as a member of the second workspace
    await db.workspaceMember.create({
      data: {
        workspaceId: workspace2.id,
        userId: owner.id,
        role: "DEVELOPER",
      },
    });

    const encryptionService = EncryptionService.getInstance();
    const encryptedApiKey2 = encryptionService.encryptField(
      "swarmApiKey",
      "second-ws-edit-swarm-key"
    );

    const swarm2 = await createTestSwarm({
      workspaceId: workspace2.id,
      name: `second-ws-edit-swarm-${generateUniqueId("swarm")}`,
      status: "ACTIVE",
    });

    await db.swarm.update({
      where: { id: swarm2.id },
      data: {
        swarmUrl: "https://second-ws-edit.sphinx.chat",
        swarmApiKey: JSON.stringify(encryptedApiKey2),
      },
    });

    await createTestRepository({
      workspaceId: workspace2.id,
      repositoryUrl: "https://github.com/test-owner/second-ws-edit-repo",
      branch: "main",
    });

    const updatedBody = "graph TD\n  A --> B --> C";
    vi.mocked(repoAgent).mockResolvedValue({ content: "```mermaid\n" + updatedBody + "\n```" });

    const request = createAuthenticatedPostRequest(
      "/api/learnings/diagrams/edit",
      {
        workspace: workspace.slug,
        diagramId: sourceDiagram.id,
        prompt: `Add integration with @${workspace2.slug}`,
      },
      owner
    );
    const response = await POST(request);

    expect(response.status).toBe(200);
    const callArg = vi.mocked(repoAgent).mock.calls[0][2];
    expect(callArg.subAgents).toBeDefined();
    expect(callArg.subAgents).toHaveLength(1);
    expect(callArg.subAgents![0].name).toBe(workspace2.slug);
    expect(callArg.subAgents![0].url).toContain("second-ws-edit.sphinx.chat");
    expect(callArg.subAgents![0].repoUrl).toBe("https://github.com/test-owner/second-ws-edit-repo");
  });

  it("should call repoAgent without subAgents when mentions don't match any accessible workspace", async () => {
    const sourceDiagram = await db.diagram.create({
      data: {
        name: "Flow",
        body: "graph TD\n  A --> B",
        description: null,
        createdBy: owner.id,
        groupId: generateUniqueId("group"),
      },
    });
    await db.diagramWorkspace.create({
      data: { diagramId: sourceDiagram.id, workspaceId: workspace.id },
    });

    const updatedBody = "graph TD\n  A --> B --> C";
    vi.mocked(repoAgent).mockResolvedValue({ content: "```mermaid\n" + updatedBody + "\n```" });

    const request = createAuthenticatedPostRequest(
      "/api/learnings/diagrams/edit",
      {
        workspace: workspace.slug,
        diagramId: sourceDiagram.id,
        prompt: "Add integration with @nonexistent-workspace-slug",
      },
      owner
    );
    const response = await POST(request);

    expect(response.status).toBe(200);
    const callArg = vi.mocked(repoAgent).mock.calls[0][2];
    expect(callArg.subAgents).toBeUndefined();
  });

  it("should return 422 when repoAgent response has no mermaid block", async () => {
    const sourceDiagram = await db.diagram.create({
      data: {
        name: "Flow",
        body: "graph TD\n  A --> B",
        description: null,
        createdBy: owner.id,
        groupId: generateUniqueId("group"),
      },
    });
    await db.diagramWorkspace.create({
      data: { diagramId: sourceDiagram.id, workspaceId: workspace.id },
    });

    vi.mocked(repoAgent).mockResolvedValue({ content: "Here is some text without mermaid." });

    const request = createAuthenticatedPostRequest(
      "/api/learnings/diagrams/edit",
      { workspace: workspace.slug, diagramId: sourceDiagram.id, prompt: "Change something" },
      owner
    );
    const response = await POST(request);

    expect(response.status).toBe(422);
  });
});
