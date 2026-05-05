import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GET } from "@/app/api/learnings/diagrams/[id]/route";
import { db } from "@/lib/db";
import {
  createTestWorkspaceScenario,
} from "@/__tests__/support/fixtures";
import {
  createGetRequest,
  createAuthenticatedGetRequest,
  generateUniqueId,
} from "@/__tests__/support/helpers";
import type { User, Workspace } from "@prisma/client";

function makeRequest(id: string, workspaceSlug: string, user?: User) {
  const url = `/api/learnings/diagrams/${id}`;
  if (user) {
    return createAuthenticatedGetRequest(url, user, { workspace: workspaceSlug });
  }
  return createGetRequest(url, { workspace: workspaceSlug });
}

async function routeHandler(request: ReturnType<typeof createGetRequest>, id: string) {
  return GET(request, { params: Promise.resolve({ id }) });
}

describe("GET /api/learnings/diagrams/[id]", () => {
  let owner: User;
  let workspace: Workspace;
  let otherOwner: User;
  let otherWorkspace: Workspace;
  let nonMember: User;

  beforeEach(async () => {
    await db.$transaction(async (tx) => {
      const scenario = await createTestWorkspaceScenario({
        owner: { name: `Diagram GetById Owner ${generateUniqueId("u")}` },
      });
      owner = scenario.owner;
      workspace = scenario.workspace;

      const otherScenario = await createTestWorkspaceScenario({
        owner: { name: `Other Workspace Owner ${generateUniqueId("u")}` },
      });
      otherOwner = otherScenario.owner;
      otherWorkspace = otherScenario.workspace;

      nonMember = await tx.user.create({
        data: {
          name: "Non Member",
          email: `non-member-getbyid-${generateUniqueId("u")}@example.com`,
        },
      });
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 401 for unauthenticated requests", async () => {
    const diagram = await db.diagram.create({
      data: { name: "Test", body: "graph TD\n A-->B", createdBy: owner.id, groupId: generateUniqueId("g") },
    });
    await db.diagramWorkspace.create({ data: { diagramId: diagram.id, workspaceId: workspace.id } });

    const request = makeRequest(diagram.id, workspace.slug);
    const response = await routeHandler(request, diagram.id);

    expect(response.status).toBe(401);
  });

  it("returns 400 when workspace param is missing", async () => {
    const diagram = await db.diagram.create({
      data: { name: "Test", body: "graph TD\n A-->B", createdBy: owner.id, groupId: generateUniqueId("g") },
    });
    const request = createAuthenticatedGetRequest(`/api/learnings/diagrams/${diagram.id}`, owner);
    const response = await routeHandler(request, diagram.id);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("workspace");
  });

  it("returns 403 for non-member access", async () => {
    const diagram = await db.diagram.create({
      data: { name: "Test", body: "graph TD\n A-->B", createdBy: owner.id, groupId: generateUniqueId("g") },
    });
    await db.diagramWorkspace.create({ data: { diagramId: diagram.id, workspaceId: workspace.id } });

    const request = makeRequest(diagram.id, workspace.slug, nonMember);
    const response = await routeHandler(request, diagram.id);

    expect(response.status).toBe(403);
  });

  it("returns { id, groupId } for a valid in-workspace diagram", async () => {
    const groupId = generateUniqueId("g");
    const diagram = await db.diagram.create({
      data: { name: "Auth Flow", body: "graph TD\n A-->B", createdBy: owner.id, groupId },
    });
    await db.diagramWorkspace.create({ data: { diagramId: diagram.id, workspaceId: workspace.id } });

    const request = makeRequest(diagram.id, workspace.slug, owner);
    const response = await routeHandler(request, diagram.id);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.id).toBe(diagram.id);
    expect(data.groupId).toBe(groupId);
  });

  it("returns 404 for an unknown diagram ID", async () => {
    const request = makeRequest("non-existent-id-xyz", workspace.slug, owner);
    const response = await routeHandler(request, "non-existent-id-xyz");

    expect(response.status).toBe(404);
  });

  it("returns 404 when diagram exists but belongs to a different workspace", async () => {
    // Diagram is in otherWorkspace, not workspace
    const diagram = await db.diagram.create({
      data: { name: "Other Diagram", body: "graph TD\n X-->Y", createdBy: otherOwner.id, groupId: generateUniqueId("g") },
    });
    await db.diagramWorkspace.create({ data: { diagramId: diagram.id, workspaceId: otherWorkspace.id } });

    // Request as owner of `workspace` — should not see diagram from otherWorkspace
    const request = makeRequest(diagram.id, workspace.slug, owner);
    const response = await routeHandler(request, diagram.id);

    expect(response.status).toBe(404);
  });

  it("returns groupId for an older version diagram", async () => {
    const groupId = generateUniqueId("g");

    // Older version
    const v1 = await db.diagram.create({
      data: {
        name: "Flow",
        body: "graph TD\n A-->B",
        createdBy: owner.id,
        groupId,
        createdAt: new Date("2024-01-01T10:00:00Z"),
      },
    });
    await db.diagramWorkspace.create({ data: { diagramId: v1.id, workspaceId: workspace.id } });

    // Newer version (same group)
    const v2 = await db.diagram.create({
      data: {
        name: "Flow",
        body: "graph TD\n A-->B\n B-->C",
        createdBy: owner.id,
        groupId,
        createdAt: new Date("2024-06-01T10:00:00Z"),
      },
    });
    await db.diagramWorkspace.create({ data: { diagramId: v2.id, workspaceId: workspace.id } });

    // Requesting v1 (older) should still return its groupId
    const request = makeRequest(v1.id, workspace.slug, owner);
    const response = await routeHandler(request, v1.id);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.id).toBe(v1.id);
    expect(data.groupId).toBe(groupId);
  });
});
