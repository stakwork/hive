/**
 * Unit tests for silent no-op pod release fix in agent route.
 *
 * In `claimPodForTask`, `db.task.update` (storing credentials) is NOT wrapped
 * in an inner try-catch, so a DB failure propagates to the outer catch and
 * triggers the rollback path. We also set `portMappings: {}` so `controlUrl`
 * is undefined, which throws "Pod control port not available" immediately and
 * goes directly to the catch → rollback.
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

// releasePodById is imported from "@/lib/pods" in agent/route.ts
vi.mock("@/lib/pods", () => ({
  claimPodAndGetFrontend: vi.fn(),
  updatePodRepositories: vi.fn().mockResolvedValue(undefined),
  POD_PORTS: { CONTROL: "15552" },
  releasePodById: vi.fn(),
}));

vi.mock("@/lib/auth/agent-jwt", () => ({
  createWebhookToken: vi.fn().mockReturnValue("mock-token"),
  generateWebhookSecret: vi.fn().mockReturnValue("mock-secret"),
}));

vi.mock("@/lib/ai/models", () => ({
  isValidModel: vi.fn().mockReturnValue(false),
  getApiKeyForModel: vi.fn().mockReturnValue("key"),
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

  // Empty portMappings → controlUrl will be undefined → throws "Pod control port not available"
  // → goes straight to the inner catch → rollback fires
  const mockPodWorkspaceNoControl = {
    id: "pod-abc123",
    password: "pass",
    portMappings: {},
    url: null,
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
    const { claimPodAndGetFrontend, releasePodById } = await import("@/lib/pods");

    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "user-1", name: "Test", email: "test@test.com" },
    } as any);
    vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspace as any);
    vi.mocked(db.task.findUnique).mockResolvedValue(mockTask as any);
    vi.mocked(db.chatMessage.count).mockResolvedValue(0);

    // Pod claim succeeds but controlUrl is missing → throws in claimPodForTask
    vi.mocked(claimPodAndGetFrontend).mockResolvedValue({
      frontend: "https://frontend.example.com",
      workspace: mockPodWorkspaceNoControl as any,
      processList: [],
    });

    // releasePodById returns null (pod not found)
    vi.mocked(releasePodById).mockResolvedValue(null);

    const { POST } = await import("@/app/api/agent/route");
    const response = await POST(
      buildAuthedRequest({ taskId: "task-1", workspaceId: "workspace-1", message: "hello" }),
    );

    // claimPodForTask throws → caught by the POST handler → 503
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
    const { claimPodAndGetFrontend, releasePodById } = await import("@/lib/pods");

    vi.mocked(getServerSession).mockResolvedValue({
      user: { id: "user-1", name: "Test", email: "test@test.com" },
    } as any);
    vi.mocked(db.workspace.findUnique).mockResolvedValue(mockWorkspace as any);
    vi.mocked(db.task.findUnique).mockResolvedValue(mockTask as any);
    vi.mocked(db.chatMessage.count).mockResolvedValue(0);

    vi.mocked(claimPodAndGetFrontend).mockResolvedValue({
      frontend: "https://frontend.example.com",
      workspace: mockPodWorkspaceNoControl as any,
      processList: [],
    });

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
