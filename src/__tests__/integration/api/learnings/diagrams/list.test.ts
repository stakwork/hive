import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GET } from "@/app/api/learnings/diagrams/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import {
  createTestWorkspaceScenario,
  createTestSwarm,
} from "@/__tests__/support/fixtures";
import {
  createGetRequest,
  createAuthenticatedGetRequest,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import type { User, Workspace, Swarm } from "@prisma/client";

describe("GET /api/learnings/diagrams", () => {
  let owner: User;
  let workspace: Workspace;
  let swarm: Swarm;
  let otherOwner: User;
  let otherWorkspace: Workspace;
  let nonMember: User;

  beforeEach(async () => {
    await db.$transaction(async (tx) => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: "Diagram List Owner" },
        members: [{ role: "VIEWER" }],
      });

      owner = scenario.owner;
      workspace = scenario.workspace;

      const encryptionService = EncryptionService.getInstance();
      const encryptedApiKey = encryptionService.encryptField(
        "swarmApiKey",
        "test-diagram-list-swarm-api-key"
      );

      swarm = await createTestSwarm({
        workspaceId: workspace.id,
        name: `test-diagram-list-swarm-${generateUniqueId("swarm")}`,
        status: "ACTIVE",
      });

      await tx.swarm.update({
        where: { id: swarm.id },
        data: {
          swarmUrl: "https://test-diagram-list.sphinx.chat",
          swarmApiKey: JSON.stringify(encryptedApiKey),
        },
      });

      // A second workspace owned by a different user
      const otherScenario = await createTestWorkspaceScenario({
        owner: { name: "Other Workspace Owner" },
      });
      otherOwner = otherScenario.owner;
      otherWorkspace = otherScenario.workspace;

      nonMember = await tx.user.create({
        data: {
          name: "Non Member User",
          email: `non-member-diagram-list-${generateUniqueId("user")}@example.com`,
        },
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return 401 for unauthenticated requests", async () => {
    const request = createGetRequest("/api/learnings/diagrams", {
      workspace: workspace.slug,
    });
    const response = await GET(request);

    expect(response.status).toBe(401);
  });

  it("should return 400 when workspace param is missing", async () => {
    const request = createAuthenticatedGetRequest(
      "/api/learnings/diagrams",
      owner
    );
    const response = await GET(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("workspace");
  });

  it("should return 403 for non-member access", async () => {
    const request = createAuthenticatedGetRequest(
      "/api/learnings/diagrams",
      nonMember,
      { workspace: workspace.slug }
    );
    const response = await GET(request);

    expect(response.status).toBe(403);
  });

  it("should return empty array when workspace has no diagrams", async () => {
    const request = createAuthenticatedGetRequest(
      "/api/learnings/diagrams",
      owner,
      { workspace: workspace.slug }
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(0);
  });

  it("should return only diagrams linked to the queried workspace", async () => {
    // Create a diagram for the target workspace
    const diagram1 = await db.diagram.create({
      data: { name: "Auth Flow", body: "graph TD\n  A --> B", description: null, createdBy: owner.id, groupId: generateUniqueId("group") },
    });
    await db.diagramWorkspace.create({
      data: { diagramId: diagram1.id, workspaceId: workspace.id },
    });

    // Create a diagram for the OTHER workspace (should not be returned)
    const diagram2 = await db.diagram.create({
      data: { name: "Other Flow", body: "graph TD\n  X --> Y", description: null, createdBy: otherOwner.id, groupId: generateUniqueId("group") },
    });
    await db.diagramWorkspace.create({
      data: { diagramId: diagram2.id, workspaceId: otherWorkspace.id },
    });

    const request = createAuthenticatedGetRequest(
      "/api/learnings/diagrams",
      owner,
      { workspace: workspace.slug }
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(1);
    expect(data[0].name).toBe("Auth Flow");
    expect(data[0].body).toBe("graph TD\n  A --> B");
    expect(data[0]).toHaveProperty("id");
    expect(data[0]).toHaveProperty("createdAt");
  });

  it("should return diagrams ordered by createdAt descending", async () => {
    const diagramA = await db.diagram.create({
      data: {
        name: "First Diagram",
        body: "graph TD\n  A --> B",
        description: null,
        createdBy: owner.id,
        groupId: generateUniqueId("group"),
        createdAt: new Date("2024-01-01T10:00:00Z"),
      },
    });
    await db.diagramWorkspace.create({
      data: { diagramId: diagramA.id, workspaceId: workspace.id },
    });

    const diagramB = await db.diagram.create({
      data: {
        name: "Second Diagram",
        body: "graph TD\n  C --> D",
        description: null,
        createdBy: owner.id,
        groupId: generateUniqueId("group"),
        createdAt: new Date("2024-06-01T10:00:00Z"),
      },
    });
    await db.diagramWorkspace.create({
      data: { diagramId: diagramB.id, workspaceId: workspace.id },
    });

    const request = createAuthenticatedGetRequest(
      "/api/learnings/diagrams",
      owner,
      { workspace: workspace.slug }
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveLength(2);
    // Most recent first
    expect(data[0].name).toBe("Second Diagram");
    expect(data[1].name).toBe("First Diagram");
  });

  it("should include description field in response (null if not set)", async () => {
    const diagram = await db.diagram.create({
      data: { name: "Null Desc", body: "graph TD\n  A --> B", description: null, createdBy: owner.id },
    });
    await db.diagramWorkspace.create({
      data: { diagramId: diagram.id, workspaceId: workspace.id },
    });

    const request = createAuthenticatedGetRequest(
      "/api/learnings/diagrams",
      owner,
      { workspace: workspace.slug }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(data[0].description).toBeNull();
  });

  it("should return only the latest version per groupId when multiple versions exist", async () => {
    const groupId = `group-dedup-${Date.now()}`;

    // Version 1 (older)
    const v1 = await db.diagram.create({
      data: {
        name: "Auth Flow",
        body: "graph TD\n  A --> B",
        description: null,
        createdBy: owner.id,
        groupId,
        createdAt: new Date("2024-01-01T10:00:00Z"),
      },
    });
    await db.diagramWorkspace.create({ data: { diagramId: v1.id, workspaceId: workspace.id } });

    // Version 2 (newer — should be returned)
    const v2 = await db.diagram.create({
      data: {
        name: "Auth Flow",
        body: "graph TD\n  A --> B\n  B --> C",
        description: null,
        createdBy: owner.id,
        groupId,
        createdAt: new Date("2024-06-01T10:00:00Z"),
      },
    });
    await db.diagramWorkspace.create({ data: { diagramId: v2.id, workspaceId: workspace.id } });

    const request = createAuthenticatedGetRequest(
      "/api/learnings/diagrams",
      owner,
      { workspace: workspace.slug }
    );
    const response = await GET(request);

    expect(response.status).toBe(200);
    const data = await response.json();

    // Only one entry for this groupId
    const forGroup = data.filter((d: { groupId: string }) => d.groupId === groupId);
    expect(forGroup).toHaveLength(1);
    expect(forGroup[0].id).toBe(v2.id);
    expect(forGroup[0].body).toBe("graph TD\n  A --> B\n  B --> C");
  });

  it("should include groupId in each response item", async () => {
    const groupId = `group-field-${Date.now()}`;
    const diagram = await db.diagram.create({
      data: {
        name: "Field Check",
        body: "graph TD\n  A --> B",
        description: null,
        createdBy: owner.id,
        groupId,
      },
    });
    await db.diagramWorkspace.create({ data: { diagramId: diagram.id, workspaceId: workspace.id } });

    const request = createAuthenticatedGetRequest(
      "/api/learnings/diagrams",
      owner,
      { workspace: workspace.slug }
    );
    const response = await GET(request);
    const data = await response.json();

    expect(data[0]).toHaveProperty("groupId");
    expect(data[0].groupId).toBe(groupId);
  });
});
