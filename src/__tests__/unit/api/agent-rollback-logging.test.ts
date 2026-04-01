/**
 * Unit tests for silent no-op pod release fix in agent route.
 *
 * `claimPodForTask` now uses `claimPodForTaskAtomically` (from @/lib/pods/queries)
 * instead of `claimPodAndGetFrontend`. We mock it to return a pod with no port
 * mappings so `controlUrl` is undefined → throws "Pod control port not available"
 * → goes to the inner catch → rollback fires.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next-auth/next", () => ({
  getServerSession: vi.fn(),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/db", () => ({
  db: {
    workspace: {
      findUnique: vi.fn(),
    },
    task: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    chatMessage: {
      findMany: vi.fn(),
      create: vi.fn(),
      count: vi.fn(),
    },
  },
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn().mockReturnValue({
      encryptField: vi.fn().mockReturnValue({ data: "enc", iv: "iv", tag: "tag" }),
      decryptField: vi.fn().mockReturnValue("decrypted"),
    }),
  },
}));

vi.mock("@/lib/pods", () => ({
  claimPodAndGetFrontend: vi.fn(),
  updatePodRepositories: vi.fn().mockResolvedValue(undefined),
  POD_PORTS: { CONTROL: "15552", FRONTEND_FALLBACK: "3000" },
  releasePodById: vi.fn(),
}));

// Mock claimPodForTaskAtomically — agent/route.ts uses this instead of claimPodAndGetFrontend
vi.mock("@/lib/pods/queries", () => ({
  claimPodForTaskAtomically: vi.fn(),
  buildPodUrl: vi.fn((podId: string, port: number) => `https://${podId}-${port}.workspaces.sphinx.chat`),
}));

vi.mock("@/lib/auth/agent-jwt", () => ({
  createWebhookToken: vi.fn().mockReturnValue("mock-token"),
  generateWebhookSecret: vi.fn().mockReturnValue("mock-secret"),
}));

vi.mock("@/lib/ai/models", () => ({
  isValidModel: vi.fn().mockReturnValue(false),
  getApiKeyForModel: vi.fn().mockReturnValue("key"),
}));

vi.mock("@/lib/feature-flags", () => ({
  canAccessServerFeature: vi.fn().mockReturnValue(true),
  FEATURE_FLAGS: { TASK_AGENT_MODE: "TASK_AGENT_MODE" },
}));

describe("POST /api/agent — claimPodForTask rollback logging", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  const mockWorkspace = {
    id: "workspace-1",
    swarm: {
      id: "swarm-1",
      services: [],
      poolApiKey: JSON.stringify({ data: "enc" }),
    },
    repositories: [],
  };

  // Task with no podId so the claim path is taken; mode must be "agent"
  const mockTask = {
    id: "task-1",
    workspaceId: "workspace-1",
    podId: null,
    agentUrl: null,
    agentPassword: null,
    agentWebhookSecret: null,
    mode: "agent",
    model: null,
  };

  // Pod with no portMappings → controlUrl will be undefined → throws "Pod control port not available"
  // → goes straight to the inner catch → rollback fires
  const mockClaimedPodNoControl = {
    id: "db-id-1",
    podId: "pod-abc123",
    swarmId: "swarm-1",
    status: "RUNNING",
    usageStatus: "USED",
    usageStatusMarkedAt: new Date(),
    usageStatusMarkedBy: "task-1",
    usageStatusReason: null,
    password: "pass",
    portMappings: [], // empty → no control port
    flaggedForRecreation: false,
    flaggedAt: null,
    flaggedReason: null,
    lastHealthCheck: null,
    healthStatus: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    consoleLogSpy.mockRestore();
  });

  function buildAuthedRequest(body: object) {
    const headers = new Headers({ "Content-Type": "application/json" });
    headers.set("x-middleware-auth-status", "authenticated");
    headers.set("x-middleware-user-id", "user-1");
    return new NextRequest("http://localhost/api/agent", {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
  }

  it("logs console.error ([Agent] Rollback failed) when releasePodById returns null after pod setup failure", async () => {
    const { getServerSession } = await import("next-auth/next");
    const { db } = await import("@/lib/db");
    const { releasePodById } = await import("@/lib/pods");
    const { claimPodForTaskAtomically } = await import("@/lib/pods/queries");

    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "user-1", name: "Test", email: "test@test.com" },
    } as any);
    vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspace as any);
    vi.mocked(db.task.findUnique).mockResolvedValue(mockTask as any);
    vi.mocked(db.chatMessage.count).mockResolvedValue(0);

    // Atomic claim succeeds, but pod has no control port → throws in claimPodForTask
    vi.mocked(claimPodForTaskAtomically).mockResolvedValue(mockClaimedPodNoControl as any);

    // releasePodById returns null (pod not found in DB)
    vi.mocked(releasePodById).mockResolvedValue(null);

    const { POST } = await import("@/app/api/agent/route");
    const response = await POST(
      buildAuthedRequest({ taskId: "task-1", workspaceId: "workspace-1", message: "hello" }),
    );

    // claimPodForTask throws → caught by POST handler → 503
    expect(response.status).toBe(503);

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Rollback failed"),
    );

    // Must NOT log the success "Released pod" message
    const releasedLogs = consoleLogSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((m) => m.includes("Released pod"));
    expect(releasedLogs).toHaveLength(0);
  });

  it("logs console.log ([Agent] Released pod) when releasePodById succeeds after pod setup failure", async () => {
    const { getServerSession } = await import("next-auth/next");
    const { db } = await import("@/lib/db");
    const { releasePodById } = await import("@/lib/pods");
    const { claimPodForTaskAtomically } = await import("@/lib/pods/queries");

    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "user-1", name: "Test", email: "test@test.com" },
    } as any);
    vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspace as any);
    vi.mocked(db.task.findUnique).mockResolvedValue(mockTask as any);
    vi.mocked(db.chatMessage.count).mockResolvedValue(0);

    // Atomic claim succeeds, but pod has no control port → throws in claimPodForTask
    vi.mocked(claimPodForTaskAtomically).mockResolvedValue(mockClaimedPodNoControl as any);

    // releasePodById returns the pod (success)
    vi.mocked(releasePodById).mockResolvedValue({ id: "pod-abc123" } as any);

    const { POST } = await import("@/app/api/agent/route");
    const response = await POST(
      buildAuthedRequest({ taskId: "task-1", workspaceId: "workspace-1", message: "hello" }),
    );

    expect(response.status).toBe(503);

    expect(consoleLogSpy).toHaveBeenCalledWith(
      expect.stringContaining("Released pod"),
    );

    // Must NOT log the "Rollback failed" error
    const rollbackErrors = consoleErrorSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((m) => m.includes("Rollback failed"));
    expect(rollbackErrors).toHaveLength(0);
  });
});
