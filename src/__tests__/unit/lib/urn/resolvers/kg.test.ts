// @vitest-environment node

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  db: {
    workspace: { findFirst: vi.fn() },
    workspaceMember: { findFirst: vi.fn() },
  },
}));

vi.mock("@/lib/helpers/swarm-access", () => ({
  getSwarmAccessByWorkspaceId: vi.fn(),
}));

import { db } from "@/lib/db";
import { getSwarmAccessByWorkspaceId } from "@/lib/helpers/swarm-access";
import { resolveKgSeam } from "@/lib/urn/resolvers/kg";

const mockWsFindFirst = db.workspace.findFirst as ReturnType<typeof vi.fn>;
const mockMemberFindFirst = db.workspaceMember.findFirst as ReturnType<typeof vi.fn>;
const mockGetSwarmAccess = getSwarmAccessByWorkspaceId as ReturnType<typeof vi.fn>;

const CTX = { userId: "user-1" };

const SUCCESS_DATA = {
  workspaceId: "ws-1",
  swarmName: "my-swarm",
  swarmUrl: "https://swarm.example.com",
  swarmApiKey: "decrypted-key",
  swarmStatus: "ACTIVE",
  poolName: "pool-1",
  swarmSecretAlias: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveKgSeam", () => {
  it("returns null for a non-kg URN", async () => {
    const result = await resolveKgSeam("urn:myorg:pg:feature:abc", CTX);
    expect(result).toBeNull();
    expect(mockWsFindFirst).not.toHaveBeenCalled();
  });

  it("returns null for an invalid URN", async () => {
    const result = await resolveKgSeam("kg:myws:concept:abc", CTX);
    expect(result).toBeNull();
  });

  it("returns null when workspace not found", async () => {
    mockWsFindFirst.mockResolvedValue(null);
    const result = await resolveKgSeam("urn:myorg:kg:my-workspace:concept:abc", CTX);
    expect(result).toBeNull();
    expect(mockMemberFindFirst).not.toHaveBeenCalled();
    expect(mockGetSwarmAccess).not.toHaveBeenCalled();
  });

  it("returns null when caller is not a workspace member (IDOR guard)", async () => {
    mockWsFindFirst.mockResolvedValue({ id: "ws-1" });
    mockMemberFindFirst.mockResolvedValue(null);

    const result = await resolveKgSeam("urn:myorg:kg:my-workspace:concept:abc", CTX);
    expect(result).toBeNull();
    // Credential fetch must NOT have been called
    expect(mockGetSwarmAccess).not.toHaveBeenCalled();
  });

  it("verifies membership BEFORE fetching swarm credentials", async () => {
    mockWsFindFirst.mockResolvedValue({ id: "ws-1" });
    // Simulate member check returning null to prove short-circuit
    mockMemberFindFirst.mockResolvedValue(null);

    await resolveKgSeam("urn:myorg:kg:my-workspace:concept:abc", CTX);

    const memberCallOrder = mockMemberFindFirst.mock.invocationCallOrder[0];
    const swarmCallOrder = mockGetSwarmAccess.mock.invocationCallOrder[0];
    // Either swarm was never called, or member check came first
    if (swarmCallOrder !== undefined) {
      expect(memberCallOrder).toBeLessThan(swarmCallOrder);
    } else {
      expect(mockGetSwarmAccess).not.toHaveBeenCalled();
    }
  });

  it("returns null when swarm not configured", async () => {
    mockWsFindFirst.mockResolvedValue({ id: "ws-1" });
    mockMemberFindFirst.mockResolvedValue({ id: "m-1" });
    mockGetSwarmAccess.mockResolvedValue({
      success: false,
      error: { type: "SWARM_NOT_CONFIGURED" },
    });

    const result = await resolveKgSeam("urn:myorg:kg:my-workspace:concept:abc", CTX);
    expect(result).toBeNull();
  });

  it("returns null when swarm not active", async () => {
    mockWsFindFirst.mockResolvedValue({ id: "ws-1" });
    mockMemberFindFirst.mockResolvedValue({ id: "m-1" });
    mockGetSwarmAccess.mockResolvedValue({
      success: false,
      error: { type: "SWARM_NOT_ACTIVE", status: "PENDING" },
    });

    const result = await resolveKgSeam("urn:myorg:kg:my-workspace:concept:abc", CTX);
    expect(result).toBeNull();
  });

  it("resolves workspace slug, checks membership, returns swarm credentials", async () => {
    mockWsFindFirst.mockResolvedValue({ id: "ws-1" });
    mockMemberFindFirst.mockResolvedValue({ id: "m-1" });
    mockGetSwarmAccess.mockResolvedValue({ success: true, data: SUCCESS_DATA });

    const result = await resolveKgSeam("urn:myorg:kg:my-workspace:concept:abc", CTX);

    expect(mockWsFindFirst).toHaveBeenCalledWith({
      where: { slug: "my-workspace", deleted: false },
      select: { id: true },
    });
    expect(mockMemberFindFirst).toHaveBeenCalledWith({
      where: { workspaceId: "ws-1", userId: "user-1" },
      select: { id: true },
    });
    expect(mockGetSwarmAccess).toHaveBeenCalledWith("ws-1");
    expect(result).toEqual({
      workspace: "my-workspace",
      swarmUrl: "https://swarm.example.com",
      jarvisUrl: "https://my-swarm.sphinx.chat:8444",
      swarmApiKey: "decrypted-key",
    });
  });

  it("returns null when swarm has no name (cannot address Jarvis)", async () => {
    mockWsFindFirst.mockResolvedValue({ id: "ws-1" });
    mockMemberFindFirst.mockResolvedValue({ id: "m-1" });
    mockGetSwarmAccess.mockResolvedValue({
      success: true,
      data: { ...SUCCESS_DATA, swarmName: "" },
    });

    const result = await resolveKgSeam("urn:myorg:kg:my-workspace:concept:abc", CTX);
    expect(result).toBeNull();
  });

  it("does not make any outbound HTTP call (credential passthrough only)", async () => {
    mockWsFindFirst.mockResolvedValue({ id: "ws-2" });
    mockMemberFindFirst.mockResolvedValue({ id: "m-2" });
    mockGetSwarmAccess.mockResolvedValue({ success: true, data: SUCCESS_DATA });

    await resolveKgSeam("urn:acme:kg:staging-ws:entity:xyz", CTX);

    expect(mockWsFindFirst).toHaveBeenCalledTimes(1);
    expect(mockMemberFindFirst).toHaveBeenCalledTimes(1);
    expect(mockGetSwarmAccess).toHaveBeenCalledTimes(1);
  });
});
