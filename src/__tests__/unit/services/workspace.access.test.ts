import { describe, test, expect, vi, beforeEach } from "vitest";
import { validateWorkspaceAccess } from "@/services/workspace";
import { db } from "@/lib/db";

const mockedDb = vi.mocked(db);

describe("Workspace Access Validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("validateWorkspaceAccess", () => {
    test("should return access details for valid user", async () => {
      const mockWorkspace = {
        id: "ws1",
        name: "Test Workspace",
        description: "A test workspace",
        slug: "test-workspace",
        ownerId: "user1",
        userRole: "ADMIN" as const,
        hasKey: true,
        owner: { id: "user1", name: "Owner", email: "owner@example.com" },
        isCodeGraphSetup: true,
        createdAt: "2024-01-01T00:00:00.000Z",
        updatedAt: "2024-01-01T00:00:00.000Z",
      };

      mockedDb.workspace.findFirst.mockResolvedValue({
        ...mockWorkspace,
        createdAt: new Date("2024-01-01"),
        updatedAt: new Date("2024-01-01"),
        owner: mockWorkspace.owner,
        swarm: { id: "swarm1", status: "ACTIVE", ingestRefId: "ingest-123" },
      });

      const result = await validateWorkspaceAccess("test-workspace", "user1");

      expect(result).toEqual({
        hasAccess: true,
        userRole: "OWNER",
        workspace: {
          id: "ws1",
          name: "Test Workspace",
          description: "A test workspace",
          slug: "test-workspace",
          ownerId: "user1",
          createdAt: "2024-01-01T00:00:00.000Z",
          updatedAt: "2024-01-01T00:00:00.000Z",
        },
        canRead: true,
        canWrite: true,
        canAdmin: true,
      });
    });

    test("should return no access for invalid user", async () => {
      mockedDb.workspace.findFirst.mockResolvedValue(null);

      const result = await validateWorkspaceAccess("test-workspace", "user1");

      expect(result).toEqual({
        hasAccess: false,
        canRead: false,
        canWrite: false,
        canAdmin: false,
      });
    });
  });
});