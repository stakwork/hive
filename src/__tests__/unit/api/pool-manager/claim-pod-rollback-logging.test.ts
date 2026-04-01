/**
 * Unit tests for silent no-op pod release fix in claim-pod route.
 *
 * The outer catch in the route fires when an uncaught exception escapes after
 * `claimedPodId` is set. We trigger it by returning `portMappings: null` from
 * the `claimPodAndGetFrontend` mock, which causes a TypeError at the unwrapped
 * `podWorkspace.portMappings[POD_PORTS.CONTROL]` line.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/auth/api-token", () => ({
  requireAuthOrApiToken: vi.fn(),
  // API token auth bypasses session checks
  validateApiToken: vi.fn().mockReturnValue(true),
}));

vi.mock("@/lib/auth/nextauth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/db", () => ({
  db: {
    workspace: {
      findFirst: vi.fn(),
    },
    task: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn().mockReturnValue({
      encryptField: vi.fn().mockReturnValue({ data: "enc", iv: "iv", tag: "tag" }),
    }),
  },
}));

vi.mock("@/lib/pods", () => ({
  claimPodAndGetFrontend: vi.fn(),
  updatePodRepositories: vi.fn(),
  POD_PORTS: { CONTROL: "15552" },
}));

vi.mock("@/lib/pods/queries", () => ({
  releasePodById: vi.fn(),
  POD_BASE_DOMAIN: "test.domain.com",
}));

describe("POST /api/pool-manager/claim-pod/[workspaceId] — rollback logging", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;

  const mockWorkspace = {
    id: "workspace-1",
    ownerId: "user-1",
    members: [],
    swarm: {
      id: "swarm-1",
      services: [],
      poolApiKey: JSON.stringify({ data: "enc" }),
    },
    repositories: [],
  };

  // Returning portMappings: null triggers an uncaught TypeError after claimedPodId is set,
  // which propagates to the outer catch and activates the rollback path.
  const mockPodWorkspaceNullMappings = {
    id: "pod-abc123",
    password: "pass",
    portMappings: null, // intentionally null to trigger outer catch
    url: null,
  };

  const mockPodWorkspaceValid = {
    id: "pod-abc123",
    password: "pass",
    portMappings: { "15552": "https://ctrl.example.com" },
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

  function buildRequest(workspaceId: string) {
    return new NextRequest(`http://localhost/api/pool-manager/claim-pod/${workspaceId}`, {
      method: "POST",
    });
  }

  it("logs console.error (Rollback failed) when releasePodById returns null after post-claim failure", async () => {
    const { db } = await import("@/lib/db");
    const { claimPodAndGetFrontend } = await import("@/lib/pods");
    const { releasePodById } = await import("@/lib/pods/queries");

    vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspace as any);
    vi.mocked(db.task.findUnique).mockResolvedValue(null);
    // claimPodAndGetFrontend returns null portMappings — TypeError fires in the outer try
    vi.mocked(claimPodAndGetFrontend).mockResolvedValue({
      frontend: "https://frontend.example.com",
      workspace: mockPodWorkspaceNullMappings as any,
      processList: [],
    });
    // releasePodById returns null — pod not found
    vi.mocked(releasePodById).mockResolvedValue(null);

    const { POST } = await import("@/app/api/pool-manager/claim-pod/[workspaceId]/route");
    const response = await POST(buildRequest("workspace-1"), {
      params: Promise.resolve({ workspaceId: "workspace-1" }),
    });

    expect(response.status).toBe(500);
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Rollback failed"),
    );
    // Must NOT log the success "Released pod" message
    const releasedLogs = consoleLogSpy.mock.calls
      .map((c) => String(c[0]))
      .filter((m) => m.includes("Released pod"));
    expect(releasedLogs).toHaveLength(0);
  });

  it("logs console.log (Released pod) when releasePodById succeeds after post-claim failure", async () => {
    const { db } = await import("@/lib/db");
    const { claimPodAndGetFrontend } = await import("@/lib/pods");
    const { releasePodById } = await import("@/lib/pods/queries");

    vi.mocked(db.workspace.findFirst).mockResolvedValue(mockWorkspace as any);
    vi.mocked(db.task.findUnique).mockResolvedValue(null);
    vi.mocked(claimPodAndGetFrontend).mockResolvedValue({
      frontend: "https://frontend.example.com",
      workspace: mockPodWorkspaceNullMappings as any,
      processList: [],
    });
    // releasePodById returns the pod — success
    vi.mocked(releasePodById).mockResolvedValue(mockPodWorkspaceValid as any);

    const { POST } = await import("@/app/api/pool-manager/claim-pod/[workspaceId]/route");
    await POST(buildRequest("workspace-1"), {
      params: Promise.resolve({ workspaceId: "workspace-1" }),
    });

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
