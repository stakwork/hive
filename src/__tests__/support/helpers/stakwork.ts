import { NextRequest } from "next/server";
import { vi } from "vitest";

/**
 * Sets up successful mocks for Stakwork API tests
 */
export const setupStakworkSuccessfulMocks = async (
  testUserId: string = "user-123",
  testWorkspaceId: string = "workspace-456"
) => {
  const { getServerSession } = await import("next-auth/next");
  const { getWorkspaceById } = await import("@/services/workspace");
  const { getGithubUsernameAndPAT } = await import("@/lib/auth/nextauth");
  const { db } = await import("@/lib/db");
  
  const { createMockSession, createMockWorkspace, createMockWorkspaceData, createMockGithubProfile, createMockSwarm } = await import("@/__tests__/support/fixtures/stakwork");

  vi.mocked(getServerSession).mockResolvedValue(createMockSession(testUserId));
  vi.mocked(getWorkspaceById).mockResolvedValue(createMockWorkspace({ id: testWorkspaceId }));
  vi.mocked(db.workspace.findUnique).mockResolvedValue(createMockWorkspaceData({ id: testWorkspaceId }));
  vi.mocked(getGithubUsernameAndPAT).mockResolvedValue(createMockGithubProfile());
  vi.mocked(db.swarm.findUnique).mockResolvedValue(createMockSwarm());
  vi.mocked(global.fetch).mockResolvedValue({
    ok: true,
    json: async () => ({
      success: true,
      data: { id: "workflow-123", status: "created" },
    }),
  } as Response);
};

/**
 * Creates a test request for Stakwork API endpoints
 */
export const createStakworkTestRequest = (body: Record<string, unknown>): NextRequest => {
  return new NextRequest("http://localhost:3000/api/stakwork/user-journey", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
};
