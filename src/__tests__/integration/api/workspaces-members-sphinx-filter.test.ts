import { describe, test, expect, beforeEach, afterEach, vi } from "vitest";
import { GET } from "@/app/api/workspaces/[slug]/members/route";
import { db } from "@/lib/db";
import { generateUniqueId } from "@/__tests__/support/helpers";
import { createTestUser } from "@/__tests__/support/factories/user.factory";
import { createTestWorkspace } from "@/__tests__/support/factories/workspace.factory";
import { getServerSession } from "next-auth/next";

// Helper to create authenticated GET request with session mock
const createAuthenticatedRequest = (
  url: string,
  user: { id: string; email: string; name: string | null }
) => {
  vi.mocked(getServerSession).mockResolvedValue({
    user: { id: user.id, email: user.email, name: user.name! },
    expires: new Date(Date.now() + 86400000).toISOString(),
  });
  
  return new Request(url, {
    method: "GET",
    headers: { "Content-Type": "application/json" },
  });
};

describe("GET /api/workspaces/[slug]/members?sphinxLinkedOnly=true Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    // Clean up test data
    await db.workspaceMember.deleteMany({});
    await db.workspace.deleteMany({});
    await db.user.deleteMany({});
  });

  test("returns 401 when unauthenticated", async () => {
    // Mock no session
    vi.mocked(getServerSession).mockResolvedValue(null);
    
    const request = new Request("http://localhost:3000/api/workspaces/test/members?sphinxLinkedOnly=true", {
      method: "GET",
    });

    const response = await GET(request, { params: { slug: "test" } });
    expect(response.status).toBe(401);
  });

  test("returns only members with both sphinxAlias and lightningPubkey when sphinxLinkedOnly=true", async () => {
    // Create workspace owner with Sphinx linked
    const owner = await createTestUser({
      email: `owner-${generateUniqueId()}@example.com`,
      name: "Workspace Owner",
      sphinxAlias: "owner_sphinx",
      lightningPubkey: "owner-pubkey-123",
    });

    const workspace = await createTestWorkspace({
      ownerId: owner.id,
      slug: `test-ws-${generateUniqueId()}`,
    });

    // Create member with Sphinx linked
    const linkedMember = await createTestUser({
      email: `linked-${generateUniqueId()}@example.com`,
      name: "Linked Member",
      sphinxAlias: "linked_sphinx",
      lightningPubkey: "linked-pubkey-123",
    });

    await db.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: linkedMember.id,
        role: "DEVELOPER",
      },
    });

    // Create member without Sphinx alias
    const noAliasMember = await createTestUser({
      email: `no-alias-${generateUniqueId()}@example.com`,
      name: "No Alias Member",
      lightningPubkey: "no-alias-pubkey",
    });

    await db.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: noAliasMember.id,
        role: "DEVELOPER",
      },
    });

    // Create member without pubkey
    const noPubkeyMember = await createTestUser({
      email: `no-pubkey-${generateUniqueId()}@example.com`,
      name: "No Pubkey Member",
      sphinxAlias: "no_pubkey_sphinx",
    });

    await db.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: noPubkeyMember.id,
        role: "DEVELOPER",
      },
    });

    const request = createAuthenticatedRequest(
      `http://localhost:3000/api/workspaces/${workspace.slug}/members?sphinxLinkedOnly=true`,
      owner
    );

    const response = await GET(request, { params: { slug: workspace.slug } });
    expect(response.status).toBe(200);

    const data = await response.json();
    
    // Should return linkedMember in members array (owner is separate)
    expect(data.members).toHaveLength(1);
    expect(data.owner).toBeDefined();
    expect(data.owner.id).toBe(owner.id);
    
    // Only linkedMember should be in members array
    expect(data.members[0].userId).toBe(linkedMember.id);
    expect(data.members[0].user.sphinxAlias).toBe("linked_sphinx");
    
    // Owner should have Sphinx fields
    expect(data.owner.user.sphinxAlias).toBe("owner_sphinx");
    expect(data.owner.user.lightningPubkey).toBe("owner-pubkey-123");
  });

  test("returns empty members array when owner doesn't have Sphinx linked and sphinxLinkedOnly=true", async () => {
    // Create workspace owner WITHOUT Sphinx linked
    const owner = await createTestUser({
      email: `owner-${generateUniqueId()}@example.com`,
      name: "Workspace Owner",
      // No sphinxAlias or lightningPubkey
    });

    const workspace = await createTestWorkspace({
      ownerId: owner.id,
      slug: `test-ws-${generateUniqueId()}`,
    });

    const request = createAuthenticatedRequest(
      `http://localhost:3000/api/workspaces/${workspace.slug}/members?sphinxLinkedOnly=true`,
      owner
    );

    const response = await GET(request, { params: { slug: workspace.slug } });
    expect(response.status).toBe(200);

    const data = await response.json();
    
    // Should return empty members array and null owner
    expect(data.members).toHaveLength(0);
    expect(data.owner).toBeNull();
  });

  test("excludes system assignees when sphinxLinkedOnly=true even if includeSystemAssignees=true", async () => {
    const owner = await createTestUser({
      email: `owner-${generateUniqueId()}@example.com`,
      name: "Workspace Owner",
      sphinxAlias: "owner_sphinx",
      lightningPubkey: "owner-pubkey-123",
    });

    const workspace = await createTestWorkspace({
      ownerId: owner.id,
      slug: `test-ws-${generateUniqueId()}`,
    });

    const request = createAuthenticatedRequest(
      `http://localhost:3000/api/workspaces/${workspace.slug}/members?sphinxLinkedOnly=true&includeSystemAssignees=true`,
      owner
    );

    const response = await GET(request, { params: { slug: workspace.slug } });
    expect(response.status).toBe(200);

    const data = await response.json();
    
    // System assignees should NOT be included even though includeSystemAssignees=true
    // because they don't have sphinxAlias + lightningPubkey
    expect(data.systemAssignees).toBeUndefined();
    
    // Only owner should be returned (in owner field, not members array)
    expect(data.members).toHaveLength(0);
    expect(data.owner).toBeDefined();
    expect(data.owner.id).toBe(owner.id);
  });
});
