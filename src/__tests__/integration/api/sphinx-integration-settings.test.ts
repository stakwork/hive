import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GET, PUT } from "@/app/api/workspaces/[slug]/settings/sphinx-integration/route";
import { db } from "@/lib/db";
import { invokeRoute } from "@/__tests__/harness/route";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import {
  createTestWorkspace,
  createTestMembership,
  createSphinxEnabledWorkspace,
} from "@/__tests__/support/factories/workspace.factory";

describe("GET /api/workspaces/[slug]/settings/sphinx-integration", () => {
  let workspaceSlug: string;
  let workspaceId: string;
  let ownerId: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    const owner = await createTestUser({ idempotent: false });
    ownerId = owner.id;

    const workspace = await createSphinxEnabledWorkspace({ ownerId });
    workspaceSlug = workspace.slug;
    workspaceId = workspace.id;
  });

  afterEach(async () => {
    await db.workspace_members.deleteMany({ where: { workspaceId } });
    await db.workspaces.deleteMany({ where: { id: workspaceId } });
    await db.users.deleteMany({ where: { id: ownerId } });
  });

  it("returns 401 for unauthenticated requests", async () => {
    const result = await invokeRoute(GET, {
      session: null,
      params: { slug: workspaceSlug },
    });

    expect(result.status).toBe(401);
    const data = await result.json();
    expect(data).toMatchObject({ error: "Unauthorized" });
  });

  it("returns 200 with sphinx config for ADMIN user (no raw secret)", async () => {
    const admin = await createTestUser({ idempotent: false });
    await createTestMembership({ workspaceId,user_id: admin.id, role: "ADMIN" });

    const result = await invokeRoute(GET, {
      session: { user: { id: admin.id, email: admin.email, name: admin.name }, expires: "" },
      params: { slug: workspaceSlug },
    });

    expect(result.status).toBe(200);
    const data = await result.json<Record<string, unknown>>();
    expect(data).toHaveProperty("sphinxEnabled");
    expect(data).toHaveProperty("sphinxChatPubkey");
    expect(data).toHaveProperty("sphinxBotId");
    expect(data).toHaveProperty("hasBotSecret", true);
    // Raw secret must never be returned
    expect(data).not.toHaveProperty("sphinxBotSecret");

    await db.workspace_members.deleteMany({ where: {user_id: admin.id } });
    await db.users.delete({ where: { id: admin.id } });
  });

  it("returns 200 for DEVELOPER member (no longer 403)", async () => {
    const developer = await createTestUser({ idempotent: false });
    await createTestMembership({ workspaceId,user_id: developer.id, role: "DEVELOPER" });

    const result = await invokeRoute(GET, {
      session: { user: { id: developer.id, email: developer.email, name: developer.name }, expires: "" },
      params: { slug: workspaceSlug },
    });

    expect(result.status).toBe(200);
    const data = await result.json<Record<string, unknown>>();
    expect(data).toHaveProperty("hasBotSecret", true);
    expect(data).not.toHaveProperty("sphinxBotSecret");

    await db.workspace_members.deleteMany({ where: {user_id: developer.id } });
    await db.users.delete({ where: { id: developer.id } });
  });

  it("returns 200 for VIEWER member (no longer 403)", async () => {
    const viewer = await createTestUser({ idempotent: false });
    await createTestMembership({ workspaceId,user_id: viewer.id, role: "VIEWER" });

    const result = await invokeRoute(GET, {
      session: { user: { id: viewer.id, email: viewer.email, name: viewer.name }, expires: "" },
      params: { slug: workspaceSlug },
    });

    expect(result.status).toBe(200);
    const data = await result.json<Record<string, unknown>>();
    expect(data).toHaveProperty("hasBotSecret", true);
    expect(data).not.toHaveProperty("sphinxBotSecret");

    await db.workspace_members.deleteMany({ where: {user_id: viewer.id } });
    await db.users.delete({ where: { id: viewer.id } });
  });
});

describe("PUT /api/workspaces/[slug]/settings/sphinx-integration", () => {
  let workspaceSlug: string;
  let workspaceId: string;
  let ownerId: string;

  beforeEach(async () => {
    vi.clearAllMocks();

    const owner = await createTestUser({ idempotent: false });
    ownerId = owner.id;

    const workspace = await createTestWorkspace({ ownerId, idempotent: false });
    workspaceSlug = workspace.slug;
    workspaceId = workspace.id;
  });

  afterEach(async () => {
    await db.workspace_members.deleteMany({ where: { workspaceId } });
    await db.workspaces.deleteMany({ where: { id: workspaceId } });
    await db.users.deleteMany({ where: { id: ownerId } });
  });

  it("returns 403 for non-admin member (PUT guard unchanged)", async () => {
    const developer = await createTestUser({ idempotent: false });
    await createTestMembership({ workspaceId,user_id: developer.id, role: "DEVELOPER" });

    const result = await invokeRoute(PUT, {
      method: "PUT",
      session: { user: { id: developer.id, email: developer.email, name: developer.name }, expires: "" },
      params: { slug: workspaceSlug },
      body: {sphinx_enabled: true,sphinx_chat_pubkey: "pubkey",sphinx_bot_id: "botid" },
    });

    expect(result.status).toBe(403);

    await db.workspace_members.deleteMany({ where: {user_id: developer.id } });
    await db.users.delete({ where: { id: developer.id } });
  });

  it("returns 200 for ADMIN member (no regression)", async () => {
    const admin = await createTestUser({ idempotent: false });
    await createTestMembership({ workspaceId,user_id: admin.id, role: "ADMIN" });

    const result = await invokeRoute(PUT, {
      method: "PUT",
      session: { user: { id: admin.id, email: admin.email, name: admin.name }, expires: "" },
      params: { slug: workspaceSlug },
      body: {sphinx_enabled: true,sphinx_chat_pubkey: "test-pubkey",sphinx_bot_id: "test-bot-id",sphinx_bot_secret: "test-secret",
      },
    });

    expect(result.status).toBe(200);
    const data = await result.json<Record<string, unknown>>();
    expect(data).toMatchObject({ success: true });

    await db.workspace_members.deleteMany({ where: {user_id: admin.id } });
    await db.users.delete({ where: { id: admin.id } });
  });
});
