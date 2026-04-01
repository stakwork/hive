import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { POST } from "@/app/api/whiteboards/[whiteboardId]/move/route";
import { db } from "@/lib/db";
import {
  createAuthenticatedPostRequest,
  expectForbidden,
} from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import {
  createTestWorkspace,
  createTestMembership,
} from "@/__tests__/support/factories/workspace.factory";
import { createTestWhiteboardMessage } from "@/__tests__/support/factories/whiteboard-message.factory";

async function createTestWhiteboard(
  workspaceId: string,
  opts: { createdById?: string; featureId?: string } = {}
) {
  return db.whiteboard.create({
    data: {
      name: "Test Whiteboard",
      workspaceId,
      featureId: opts.featureId ?? null,
      createdById: opts.createdById ?? null,
      elements: [],
      appState: {},
      files: {},
    },
  });
}

function makeParams(whiteboardId: string) {
  return { params: Promise.resolve({ whiteboardId }) };
}

describe("POST /api/whiteboards/[whiteboardId]/move", () => {
  let owner: Awaited<ReturnType<typeof createTestUser>>;
  let sourceWorkspace: Awaited<ReturnType<typeof createTestWorkspace>>;
  let destWorkspace: Awaited<ReturnType<typeof createTestWorkspace>>;

  beforeEach(async () => {
    owner = await createTestUser();
    sourceWorkspace = await createTestWorkspace({ ownerId: owner.id });
    destWorkspace = await createTestWorkspace({ ownerId: owner.id });
  });

  afterEach(async () => {
    await db.whiteboardMessage.deleteMany({});
    await db.whiteboard.deleteMany({
      where: { workspaceId: { in: [sourceWorkspace.id, destWorkspace.id] } },
    });
    await db.workspaceMember.deleteMany({
      where: { workspaceId: { in: [sourceWorkspace.id, destWorkspace.id] } },
    });
    await db.workspace.deleteMany({
      where: { id: { in: [sourceWorkspace.id, destWorkspace.id] } },
    });
    await db.user.deleteMany({ where: { id: owner.id } });
  });

  it("returns 403 when a VIEWER in the source workspace tries to move", async () => {
    const viewer = await createTestUser();
    await createTestMembership({
      workspaceId: sourceWorkspace.id,
      userId: viewer.id,
      role: "VIEWER",
    });
    // Give viewer DEVELOPER access in dest so only source check fails
    await createTestMembership({
      workspaceId: destWorkspace.id,
      userId: viewer.id,
      role: "DEVELOPER",
    });
    const wb = await createTestWhiteboard(sourceWorkspace.id);

    const req = createAuthenticatedPostRequest(
      `http://localhost/api/whiteboards/${wb.id}/move`,
      viewer,
      { targetWorkspaceId: destWorkspace.id }
    );
    const res = await POST(req, makeParams(wb.id));

    await expectForbidden(res);

    await db.user.delete({ where: { id: viewer.id } });
  });

  it("returns 403 when a STAKEHOLDER in the source workspace tries to move", async () => {
    const stakeholder = await createTestUser();
    await createTestMembership({
      workspaceId: sourceWorkspace.id,
      userId: stakeholder.id,
      role: "STAKEHOLDER",
    });
    await createTestMembership({
      workspaceId: destWorkspace.id,
      userId: stakeholder.id,
      role: "DEVELOPER",
    });
    const wb = await createTestWhiteboard(sourceWorkspace.id);

    const req = createAuthenticatedPostRequest(
      `http://localhost/api/whiteboards/${wb.id}/move`,
      stakeholder,
      { targetWorkspaceId: destWorkspace.id }
    );
    const res = await POST(req, makeParams(wb.id));

    await expectForbidden(res);

    await db.user.delete({ where: { id: stakeholder.id } });
  });

  it("returns 403 when a PM who is not the creator tries to move", async () => {
    const pm = await createTestUser();
    const creator = await createTestUser();
    await createTestMembership({
      workspaceId: sourceWorkspace.id,
      userId: pm.id,
      role: "PM",
    });
    await createTestMembership({
      workspaceId: destWorkspace.id,
      userId: pm.id,
      role: "DEVELOPER",
    });
    const wb = await createTestWhiteboard(sourceWorkspace.id, {
      createdById: creator.id,
    });

    const req = createAuthenticatedPostRequest(
      `http://localhost/api/whiteboards/${wb.id}/move`,
      pm,
      { targetWorkspaceId: destWorkspace.id }
    );
    const res = await POST(req, makeParams(wb.id));

    await expectForbidden(res);

    await db.user.deleteMany({ where: { id: { in: [pm.id, creator.id] } } });
  });

  it("returns 403 when the destination role is VIEWER", async () => {
    const user = await createTestUser();
    await createTestMembership({
      workspaceId: sourceWorkspace.id,
      userId: user.id,
      role: "ADMIN",
    });
    await createTestMembership({
      workspaceId: destWorkspace.id,
      userId: user.id,
      role: "VIEWER",
    });
    const wb = await createTestWhiteboard(sourceWorkspace.id);

    const req = createAuthenticatedPostRequest(
      `http://localhost/api/whiteboards/${wb.id}/move`,
      user,
      { targetWorkspaceId: destWorkspace.id }
    );
    const res = await POST(req, makeParams(wb.id));

    await expectForbidden(res);

    await db.user.delete({ where: { id: user.id } });
  });

  it("returns 403 when the destination role is STAKEHOLDER", async () => {
    const user = await createTestUser();
    await createTestMembership({
      workspaceId: sourceWorkspace.id,
      userId: user.id,
      role: "ADMIN",
    });
    await createTestMembership({
      workspaceId: destWorkspace.id,
      userId: user.id,
      role: "STAKEHOLDER",
    });
    const wb = await createTestWhiteboard(sourceWorkspace.id);

    const req = createAuthenticatedPostRequest(
      `http://localhost/api/whiteboards/${wb.id}/move`,
      user,
      { targetWorkspaceId: destWorkspace.id }
    );
    const res = await POST(req, makeParams(wb.id));

    await expectForbidden(res);

    await db.user.delete({ where: { id: user.id } });
  });

  it("successfully moves a whiteboard (ADMIN), clears featureId, remaps orphaned messages", async () => {
    const admin = await createTestUser();
    const orphanUser = await createTestUser(); // member of source, NOT dest
    await createTestMembership({
      workspaceId: sourceWorkspace.id,
      userId: admin.id,
      role: "ADMIN",
    });
    await createTestMembership({
      workspaceId: sourceWorkspace.id,
      userId: orphanUser.id,
      role: "DEVELOPER",
    });
    await createTestMembership({
      workspaceId: destWorkspace.id,
      userId: admin.id,
      role: "DEVELOPER",
    });
    // orphanUser has NO membership in destWorkspace

    // Create a feature to link, so we can verify featureId is cleared
    const feature = await db.feature.create({
      data: {
        title: "Test Feature",
        workspaceId: sourceWorkspace.id,
        createdById: owner.id,
        updatedById: owner.id,
      },
    });

    const wb = await createTestWhiteboard(sourceWorkspace.id, {
      featureId: feature.id,
      createdById: owner.id,
    });

    // Message from orphanUser (not in dest)
    const orphanMsg = await createTestWhiteboardMessage({
      whiteboardId: wb.id,
      role: "USER",
      userId: orphanUser.id,
    });
    // Message from admin (in dest) — should NOT be remapped
    const adminMsg = await createTestWhiteboardMessage({
      whiteboardId: wb.id,
      role: "USER",
      userId: admin.id,
    });

    const req = createAuthenticatedPostRequest(
      `http://localhost/api/whiteboards/${wb.id}/move`,
      admin,
      { targetWorkspaceId: destWorkspace.id }
    );
    const res = await POST(req, makeParams(wb.id));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);
    expect(json.data.slug).toBe(destWorkspace.slug);

    // Whiteboard is now in the destination workspace
    const moved = await db.whiteboard.findUnique({ where: { id: wb.id } });
    expect(moved?.workspaceId).toBe(destWorkspace.id);
    expect(moved?.featureId).toBeNull();

    // Orphaned message author remapped to admin
    const updatedOrphan = await db.whiteboardMessage.findUnique({
      where: { id: orphanMsg.id },
    });
    expect(updatedOrphan?.userId).toBe(admin.id);

    // Admin's own message unchanged
    const unchangedAdmin = await db.whiteboardMessage.findUnique({
      where: { id: adminMsg.id },
    });
    expect(unchangedAdmin?.userId).toBe(admin.id);

    // cleanup
    await db.feature.delete({ where: { id: feature.id } });
    await db.user.deleteMany({ where: { id: { in: [admin.id, orphanUser.id] } } });
  });

  it("successfully moves a whiteboard with no orphaned messages", async () => {
    const dev = await createTestUser();
    await createTestMembership({
      workspaceId: sourceWorkspace.id,
      userId: dev.id,
      role: "DEVELOPER",
    });
    await createTestMembership({
      workspaceId: destWorkspace.id,
      userId: dev.id,
      role: "DEVELOPER",
    });

    const wb = await createTestWhiteboard(sourceWorkspace.id, {
      createdById: dev.id,
    });

    // Message from the moving user themselves — they are in dest, so no remap needed
    await createTestWhiteboardMessage({
      whiteboardId: wb.id,
      role: "USER",
      userId: dev.id,
    });

    const req = createAuthenticatedPostRequest(
      `http://localhost/api/whiteboards/${wb.id}/move`,
      dev,
      { targetWorkspaceId: destWorkspace.id }
    );
    const res = await POST(req, makeParams(wb.id));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);

    const moved = await db.whiteboard.findUnique({ where: { id: wb.id } });
    expect(moved?.workspaceId).toBe(destWorkspace.id);

    await db.user.delete({ where: { id: dev.id } });
  });

  it("workspace OWNER can move without explicit membership record", async () => {
    // owner is the workspace owner — no WorkspaceMember record needed
    const wb = await createTestWhiteboard(sourceWorkspace.id, {
      createdById: owner.id,
    });

    const req = createAuthenticatedPostRequest(
      `http://localhost/api/whiteboards/${wb.id}/move`,
      owner,
      { targetWorkspaceId: destWorkspace.id }
    );
    const res = await POST(req, makeParams(wb.id));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.success).toBe(true);

    const moved = await db.whiteboard.findUnique({ where: { id: wb.id } });
    expect(moved?.workspaceId).toBe(destWorkspace.id);
  });
});
