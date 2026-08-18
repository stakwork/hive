/**
 * Unit tests for resolveGraphJarvis (src/lib/ai/graphWriteAuth.ts).
 *
 * Tests:
 *  1. Non-member workspaceId/slug → collapsed error (indistinguishable from not-found)
 *  2. Slug belonging to a different org → same collapsed error
 *  3. VIEWER role → collapsed error
 *  4. STAKEHOLDER role → collapsed error
 *  5. DEVELOPER role → success
 *  6. PM / ADMIN / OWNER → success
 *  7. WORKSPACE_NOT_FOUND and ACCESS_DENIED return the same error string
 *  8. Resolved jarvisUrl is the :8444 host, not /api or :3355
 *  9. Mock mode overrides jarvisUrl to MOCK_BASE/api/mock/jarvis
 * 10. Swarm inactive → collapsed error
 * 11. Swarm missing api key → collapsed error
 * 12. Locating by workspaceId works (not just slug)
 */

// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (vi.mock factories must not reference top-level variables) ────────

vi.mock("@/lib/db", () => ({
  db: {
    workspace: { findFirst: vi.fn() },
    workspaceMember: { findFirst: vi.fn() },
    swarm: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: () => ({
      encryptField: vi.fn(),
      decryptField: vi.fn(() => "decrypted-api-key"),
    }),
  },
}));

vi.mock("@/config/env", () => ({
  config: { USE_MOCKS: false, MOCK_BASE: "http://localhost:3000" },
}));

vi.mock("@/lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

// ── Import after mocks ─────────────────────────────────────────────────────

import { db } from "@/lib/db";
import { config } from "@/config/env";
import {
  resolveGraphJarvis,
  GRAPH_JARVIS_ACCESS_DENIED,
} from "@/lib/ai/graphWriteAuth";

// ── Typed references to mocked fns ────────────────────────────────────────

const mockWorkspaceFindFirst = vi.mocked(db.workspace.findFirst);
const mockMemberFindFirst = vi.mocked(db.workspaceMember.findFirst);
const mockSwarmFindUnique = vi.mocked(db.swarm.findUnique);
const mutableConfig = config as { USE_MOCKS: boolean; MOCK_BASE: string };

// ── Fixtures ───────────────────────────────────────────────────────────────

const ORG_ID = "org-001";
const USER_ID = "user-001";
const WORKSPACE_ID = "ws-001";
const WORKSPACE_SLUG = "my-workspace";

const baseWorkspace = {
  id: WORKSPACE_ID,
  slug: WORKSPACE_SLUG,
  ownerId: "other-user",
};

const activeSwarm = {
  name: "my-swarm",
  status: "ACTIVE",
  swarmApiKey: JSON.stringify({ data: "encrypted", iv: "iv", tag: "tag" }),
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe("resolveGraphJarvis", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mutableConfig.USE_MOCKS = false;
    mutableConfig.MOCK_BASE = "http://localhost:3000";
  });

  // ── Workspace lookup failures ─────────────────────────────────────────

  it("returns the collapsed error when workspace is not found (slug)", async () => {
    mockWorkspaceFindFirst.mockResolvedValue(null);

    const result = await resolveGraphJarvis(ORG_ID, USER_ID, { slug: "unknown-slug" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(GRAPH_JARVIS_ACCESS_DENIED);
    // Swarm must never be fetched if workspace lookup failed (IDOR guard)
    expect(mockSwarmFindUnique).not.toHaveBeenCalled();
  });

  it("returns the collapsed error when workspace belongs to a different org", async () => {
    // Prisma returns null because org scope rejects it
    mockWorkspaceFindFirst.mockResolvedValue(null);

    const result = await resolveGraphJarvis("other-org", USER_ID, { slug: WORKSPACE_SLUG });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(GRAPH_JARVIS_ACCESS_DENIED);
  });

  it("returns the collapsed error when workspace is not found (workspaceId locator)", async () => {
    mockWorkspaceFindFirst.mockResolvedValue(null);

    const result = await resolveGraphJarvis(ORG_ID, USER_ID, { workspaceId: "no-such-ws" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(GRAPH_JARVIS_ACCESS_DENIED);
  });

  // ── Membership check runs before any swarm fetch ──────────────────────

  it("returns the collapsed error when user is not a member — swarm never fetched", async () => {
    mockWorkspaceFindFirst.mockResolvedValue(baseWorkspace);
    mockMemberFindFirst.mockResolvedValue(null);

    const result = await resolveGraphJarvis(ORG_ID, USER_ID, { slug: WORKSPACE_SLUG });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(GRAPH_JARVIS_ACCESS_DENIED);
    expect(mockSwarmFindUnique).not.toHaveBeenCalled();
  });

  // ── WORKSPACE_NOT_FOUND and ACCESS_DENIED are indistinguishable ──────

  it("collapsed error string is identical for not-found and access-denied", async () => {
    // Scenario A: workspace not found
    mockWorkspaceFindFirst.mockResolvedValue(null);
    const notFound = await resolveGraphJarvis(ORG_ID, USER_ID, { slug: "x" });

    // Scenario B: workspace found but not a member
    mockWorkspaceFindFirst.mockResolvedValue(baseWorkspace);
    mockMemberFindFirst.mockResolvedValue(null);
    const accessDenied = await resolveGraphJarvis(ORG_ID, USER_ID, { slug: WORKSPACE_SLUG });

    expect(notFound.ok).toBe(false);
    expect(accessDenied.ok).toBe(false);
    if (!notFound.ok && !accessDenied.ok) {
      expect(notFound.error).toBe(accessDenied.error);
      expect(notFound.error).toBe(GRAPH_JARVIS_ACCESS_DENIED);
    }
  });

  // ── Role gate ─────────────────────────────────────────────────────────

  it("rejects VIEWER role — swarm never fetched", async () => {
    mockWorkspaceFindFirst.mockResolvedValue(baseWorkspace);
    mockMemberFindFirst.mockResolvedValue({ role: "VIEWER" });

    const result = await resolveGraphJarvis(ORG_ID, USER_ID, { slug: WORKSPACE_SLUG });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(GRAPH_JARVIS_ACCESS_DENIED);
    expect(mockSwarmFindUnique).not.toHaveBeenCalled();
  });

  it("rejects STAKEHOLDER role — swarm never fetched", async () => {
    mockWorkspaceFindFirst.mockResolvedValue(baseWorkspace);
    mockMemberFindFirst.mockResolvedValue({ role: "STAKEHOLDER" });

    const result = await resolveGraphJarvis(ORG_ID, USER_ID, { slug: WORKSPACE_SLUG });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(GRAPH_JARVIS_ACCESS_DENIED);
    expect(mockSwarmFindUnique).not.toHaveBeenCalled();
  });

  it("accepts DEVELOPER role", async () => {
    mockWorkspaceFindFirst.mockResolvedValue(baseWorkspace);
    mockMemberFindFirst.mockResolvedValue({ role: "DEVELOPER" });
    mockSwarmFindUnique.mockResolvedValue(activeSwarm);

    const result = await resolveGraphJarvis(ORG_ID, USER_ID, { slug: WORKSPACE_SLUG });

    expect(result.ok).toBe(true);
  });

  it("accepts PM role", async () => {
    mockWorkspaceFindFirst.mockResolvedValue(baseWorkspace);
    mockMemberFindFirst.mockResolvedValue({ role: "PM" });
    mockSwarmFindUnique.mockResolvedValue(activeSwarm);

    const result = await resolveGraphJarvis(ORG_ID, USER_ID, { slug: WORKSPACE_SLUG });

    expect(result.ok).toBe(true);
  });

  it("accepts ADMIN role", async () => {
    mockWorkspaceFindFirst.mockResolvedValue(baseWorkspace);
    mockMemberFindFirst.mockResolvedValue({ role: "ADMIN" });
    mockSwarmFindUnique.mockResolvedValue(activeSwarm);

    const result = await resolveGraphJarvis(ORG_ID, USER_ID, { slug: WORKSPACE_SLUG });

    expect(result.ok).toBe(true);
  });

  it("accepts OWNER (workspace.ownerId === userId) — no member lookup", async () => {
    mockWorkspaceFindFirst.mockResolvedValue({
      ...baseWorkspace,
      ownerId: USER_ID, // user IS the owner
    });
    mockSwarmFindUnique.mockResolvedValue(activeSwarm);

    const result = await resolveGraphJarvis(ORG_ID, USER_ID, { slug: WORKSPACE_SLUG });

    expect(result.ok).toBe(true);
    expect(mockMemberFindFirst).not.toHaveBeenCalled();
  });

  // ── Swarm failures ────────────────────────────────────────────────────

  it("returns collapsed error when swarm row is missing", async () => {
    mockWorkspaceFindFirst.mockResolvedValue(baseWorkspace);
    mockMemberFindFirst.mockResolvedValue({ role: "DEVELOPER" });
    mockSwarmFindUnique.mockResolvedValue(null);

    const result = await resolveGraphJarvis(ORG_ID, USER_ID, { slug: WORKSPACE_SLUG });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(GRAPH_JARVIS_ACCESS_DENIED);
  });

  it("returns collapsed error when swarm status is not ACTIVE", async () => {
    mockWorkspaceFindFirst.mockResolvedValue(baseWorkspace);
    mockMemberFindFirst.mockResolvedValue({ role: "DEVELOPER" });
    mockSwarmFindUnique.mockResolvedValue({ ...activeSwarm, status: "PENDING" });

    const result = await resolveGraphJarvis(ORG_ID, USER_ID, { slug: WORKSPACE_SLUG });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(GRAPH_JARVIS_ACCESS_DENIED);
  });

  it("returns collapsed error when swarm has no name", async () => {
    mockWorkspaceFindFirst.mockResolvedValue(baseWorkspace);
    mockMemberFindFirst.mockResolvedValue({ role: "DEVELOPER" });
    mockSwarmFindUnique.mockResolvedValue({ ...activeSwarm, name: "" });

    const result = await resolveGraphJarvis(ORG_ID, USER_ID, { slug: WORKSPACE_SLUG });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(GRAPH_JARVIS_ACCESS_DENIED);
  });

  it("returns collapsed error when swarmApiKey is missing", async () => {
    mockWorkspaceFindFirst.mockResolvedValue(baseWorkspace);
    mockMemberFindFirst.mockResolvedValue({ role: "DEVELOPER" });
    mockSwarmFindUnique.mockResolvedValue({ ...activeSwarm, swarmApiKey: null });

    const result = await resolveGraphJarvis(ORG_ID, USER_ID, { slug: WORKSPACE_SLUG });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(GRAPH_JARVIS_ACCESS_DENIED);
  });

  // ── URL derivation ────────────────────────────────────────────────────

  it("resolved jarvisUrl is the :8444 Jarvis host (not /api or :3355)", async () => {
    mutableConfig.USE_MOCKS = false;
    mockWorkspaceFindFirst.mockResolvedValue(baseWorkspace);
    mockMemberFindFirst.mockResolvedValue({ role: "DEVELOPER" });
    mockSwarmFindUnique.mockResolvedValue(activeSwarm);

    const result = await resolveGraphJarvis(ORG_ID, USER_ID, { slug: WORKSPACE_SLUG });

    expect(result.ok).toBe(true);
    if (result.ok) {
      const { jarvisUrl } = result.access.config;
      expect(jarvisUrl).toContain(":8444");
      expect(jarvisUrl).not.toMatch(/\/api\b/);
      expect(jarvisUrl).not.toContain(":3355");
      // Derives from swarm.name via getJarvisUrl
      expect(jarvisUrl).toBe("https://my-swarm.sphinx.chat:8444");
    }
  });

  // ── Mock mode ─────────────────────────────────────────────────────────

  it("in mock mode, jarvisUrl is overridden to MOCK_BASE/api/mock/jarvis", async () => {
    mutableConfig.USE_MOCKS = true;
    mutableConfig.MOCK_BASE = "http://localhost:3000";

    mockWorkspaceFindFirst.mockResolvedValue(baseWorkspace);
    mockMemberFindFirst.mockResolvedValue({ role: "DEVELOPER" });
    mockSwarmFindUnique.mockResolvedValue(activeSwarm);

    const result = await resolveGraphJarvis(ORG_ID, USER_ID, { slug: WORKSPACE_SLUG });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.access.config.jarvisUrl).toBe(
        "http://localhost:3000/api/mock/jarvis",
      );
    }
  });

  // ── Return shape ──────────────────────────────────────────────────────

  it("returns correct workspaceId, workspaceSlug, and decrypted apiKey on success", async () => {
    mutableConfig.USE_MOCKS = false;
    mockWorkspaceFindFirst.mockResolvedValue(baseWorkspace);
    mockMemberFindFirst.mockResolvedValue({ role: "DEVELOPER" });
    mockSwarmFindUnique.mockResolvedValue(activeSwarm);

    const result = await resolveGraphJarvis(ORG_ID, USER_ID, { slug: WORKSPACE_SLUG });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.access.workspaceId).toBe(WORKSPACE_ID);
      expect(result.access.workspaceSlug).toBe(WORKSPACE_SLUG);
      expect(result.access.config.apiKey).toBe("decrypted-api-key");
    }
  });

  it("locates workspace by workspaceId (not only by slug)", async () => {
    mockWorkspaceFindFirst.mockResolvedValue(baseWorkspace);
    mockMemberFindFirst.mockResolvedValue({ role: "DEVELOPER" });
    mockSwarmFindUnique.mockResolvedValue(activeSwarm);

    await resolveGraphJarvis(ORG_ID, USER_ID, { workspaceId: WORKSPACE_ID });

    expect(mockWorkspaceFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: WORKSPACE_ID }),
      }),
    );
  });

  it("all errors (not-found, not-member, role, swarm) return identical collapsed string", async () => {
    const errors: string[] = [];

    // 1. not-found
    mockWorkspaceFindFirst.mockResolvedValue(null);
    const r1 = await resolveGraphJarvis(ORG_ID, USER_ID, { slug: "x" });
    if (!r1.ok) errors.push(r1.error);

    // 2. not-member
    mockWorkspaceFindFirst.mockResolvedValue(baseWorkspace);
    mockMemberFindFirst.mockResolvedValue(null);
    const r2 = await resolveGraphJarvis(ORG_ID, USER_ID, { slug: WORKSPACE_SLUG });
    if (!r2.ok) errors.push(r2.error);

    // 3. insufficient role
    mockMemberFindFirst.mockResolvedValue({ role: "VIEWER" });
    const r3 = await resolveGraphJarvis(ORG_ID, USER_ID, { slug: WORKSPACE_SLUG });
    if (!r3.ok) errors.push(r3.error);

    // 4. swarm missing
    mockMemberFindFirst.mockResolvedValue({ role: "DEVELOPER" });
    mockSwarmFindUnique.mockResolvedValue(null);
    const r4 = await resolveGraphJarvis(ORG_ID, USER_ID, { slug: WORKSPACE_SLUG });
    if (!r4.ok) errors.push(r4.error);

    expect(errors).toHaveLength(4);
    // All must be the same string
    expect(new Set(errors).size).toBe(1);
    expect(errors[0]).toBe(GRAPH_JARVIS_ACCESS_DENIED);
  });
});
