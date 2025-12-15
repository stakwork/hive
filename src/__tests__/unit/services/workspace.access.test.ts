import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { validateWorkspaceAccess, validateWorkspaceAccessById } from "@/services/workspace";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import { WorkspaceRole } from "@prisma/client";

// Mock the database
vi.mock("@/lib/db", () => ({
  db: {
    workspace: {
      findFirst: vi.fn(),
    },
    workspaceMember: {
      findFirst: vi.fn(),
    },
  },
}));

// Mock the encryption service
vi.mock("@/lib/encryption", () => ({
  EncryptionService: {
    getInstance: vi.fn(() => ({
      decryptField: vi.fn().mockReturnValue(""),
    })),
  },
}));

const mockedDb = vi.mocked(db);

describe("Workspace Access Validation", () => {
  let mockEncryptionService: any;

  beforeEach(() => {
    vi.clearAllMocks();

    // Setup encryption service mock
    mockEncryptionService = {
      decryptField: vi.fn().mockReturnValue(""),
    };
    (EncryptionService.getInstance as Mock).mockReturnValue(mockEncryptionService);
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

  describe("validateWorkspaceAccessById", () => {
    const mockWorkspaceData = {
      id: "ws-123",
      name: "Test Workspace",
      description: "A test workspace",
      slug: "test-workspace",
      ownerId: "owner-123",
      stakworkApiKey: null,
      deleted: false,
      deletedAt: null,
      createdAt: new Date("2024-01-01T00:00:00.000Z"),
      updatedAt: new Date("2024-01-01T00:00:00.000Z"),
      containerFilesSetUp: null,
      repositoryDraft: null,
      owner: {
        id: "owner-123",
        name: "Workspace Owner",
        email: "owner@example.com",
      },
      swarm: null,
      repositories: [],
    };

    describe("Permission Levels - Owner", () => {
      test("should return full permissions for workspace owner", async () => {
        const userId = "owner-123";
        mockEncryptionService.decryptField.mockReturnValue("");
        mockedDb.workspace.findFirst.mockResolvedValue(mockWorkspaceData);

        const result = await validateWorkspaceAccessById("ws-123", userId);

        expect(result).toEqual({
          hasAccess: true,
          userRole: "OWNER",
          workspace: {
            id: "ws-123",
            name: "Test Workspace",
            description: "A test workspace",
            slug: "test-workspace",
            ownerId: "owner-123",
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
          },
          canRead: true,
          canWrite: true,
          canAdmin: true,
        });
      });
    });

    describe("Permission Levels - Admin", () => {
      test("should return admin permissions for admin member", async () => {
        const userId = "admin-123";
        const memberWorkspace = {
          ...mockWorkspaceData,
          ownerId: "different-owner-123",
        };

        const mockMembership = {
          id: "membership-123",
          workspaceId: "ws-123",
          userId: "admin-123",
          role: WorkspaceRole.ADMIN,
          leftAt: null,
        };

        mockEncryptionService.decryptField.mockReturnValue("");
        mockedDb.workspace.findFirst.mockResolvedValue(memberWorkspace);
        mockedDb.workspaceMember.findFirst.mockResolvedValue(mockMembership);

        const result = await validateWorkspaceAccessById("ws-123", userId);

        expect(result).toEqual({
          hasAccess: true,
          userRole: "ADMIN",
          workspace: {
            id: "ws-123",
            name: "Test Workspace",
            description: "A test workspace",
            slug: "test-workspace",
            ownerId: "different-owner-123",
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
          },
          canRead: true,
          canWrite: true,
          canAdmin: true,
        });
      });
    });

    describe("Permission Levels - PM", () => {
      test("should return write permissions but not admin for PM member", async () => {
        const userId = "pm-123";
        const memberWorkspace = {
          ...mockWorkspaceData,
          ownerId: "different-owner-123",
        };

        const mockMembership = {
          id: "membership-123",
          workspaceId: "ws-123",
          userId: "pm-123",
          role: WorkspaceRole.PM,
          leftAt: null,
        };

        mockEncryptionService.decryptField.mockReturnValue("");
        mockedDb.workspace.findFirst.mockResolvedValue(memberWorkspace);
        mockedDb.workspaceMember.findFirst.mockResolvedValue(mockMembership);

        const result = await validateWorkspaceAccessById("ws-123", userId);

        expect(result).toEqual({
          hasAccess: true,
          userRole: "PM",
          workspace: {
            id: "ws-123",
            name: "Test Workspace",
            description: "A test workspace",
            slug: "test-workspace",
            ownerId: "different-owner-123",
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
          },
          canRead: true,
          canWrite: true,
          canAdmin: false,
        });
      });
    });

    describe("Permission Levels - Developer", () => {
      test("should return write permissions but not admin for developer member", async () => {
        const userId = "dev-123";
        const memberWorkspace = {
          ...mockWorkspaceData,
          ownerId: "different-owner-123",
        };

        const mockMembership = {
          id: "membership-123",
          workspaceId: "ws-123",
          userId: "dev-123",
          role: WorkspaceRole.DEVELOPER,
          leftAt: null,
        };

        mockEncryptionService.decryptField.mockReturnValue("");
        mockedDb.workspace.findFirst.mockResolvedValue(memberWorkspace);
        mockedDb.workspaceMember.findFirst.mockResolvedValue(mockMembership);

        const result = await validateWorkspaceAccessById("ws-123", userId);

        expect(result).toEqual({
          hasAccess: true,
          userRole: "DEVELOPER",
          workspace: {
            id: "ws-123",
            name: "Test Workspace",
            description: "A test workspace",
            slug: "test-workspace",
            ownerId: "different-owner-123",
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
          },
          canRead: true,
          canWrite: true,
          canAdmin: false,
        });
      });
    });

    describe("Permission Levels - Stakeholder", () => {
      test("should return read-only permissions for stakeholder member", async () => {
        const userId = "stakeholder-123";
        const memberWorkspace = {
          ...mockWorkspaceData,
          ownerId: "different-owner-123",
        };

        const mockMembership = {
          id: "membership-123",
          workspaceId: "ws-123",
          userId: "stakeholder-123",
          role: WorkspaceRole.STAKEHOLDER,
          leftAt: null,
        };

        mockEncryptionService.decryptField.mockReturnValue("");
        mockedDb.workspace.findFirst.mockResolvedValue(memberWorkspace);
        mockedDb.workspaceMember.findFirst.mockResolvedValue(mockMembership);

        const result = await validateWorkspaceAccessById("ws-123", userId);

        expect(result).toEqual({
          hasAccess: true,
          userRole: "STAKEHOLDER",
          workspace: {
            id: "ws-123",
            name: "Test Workspace",
            description: "A test workspace",
            slug: "test-workspace",
            ownerId: "different-owner-123",
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
          },
          canRead: true,
          canWrite: false,
          canAdmin: false,
        });
      });
    });

    describe("Permission Levels - Viewer", () => {
      test("should return read-only permissions for viewer member", async () => {
        const userId = "viewer-123";
        const memberWorkspace = {
          ...mockWorkspaceData,
          ownerId: "different-owner-123",
        };

        const mockMembership = {
          id: "membership-123",
          workspaceId: "ws-123",
          userId: "viewer-123",
          role: WorkspaceRole.VIEWER,
          leftAt: null,
        };

        mockEncryptionService.decryptField.mockReturnValue("");
        mockedDb.workspace.findFirst.mockResolvedValue(memberWorkspace);
        mockedDb.workspaceMember.findFirst.mockResolvedValue(mockMembership);

        const result = await validateWorkspaceAccessById("ws-123", userId);

        expect(result).toEqual({
          hasAccess: true,
          userRole: "VIEWER",
          workspace: {
            id: "ws-123",
            name: "Test Workspace",
            description: "A test workspace",
            slug: "test-workspace",
            ownerId: "different-owner-123",
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
          },
          canRead: true,
          canWrite: false,
          canAdmin: false,
        });
      });
    });

    describe("Access Denied Scenarios", () => {
      test("should return no access when workspace does not exist", async () => {
        const userId = "any-user-123";
        mockedDb.workspace.findFirst.mockResolvedValue(null);

        const result = await validateWorkspaceAccessById("non-existent-ws", userId);

        expect(result).toEqual({
          hasAccess: false,
          canRead: false,
          canWrite: false,
          canAdmin: false,
        });
        expect(mockedDb.workspaceMember.findFirst).not.toHaveBeenCalled();
      });

      test("should return no access when workspace is deleted", async () => {
        const userId = "any-user-123";
        // Prisma query excludes deleted workspaces via where clause
        mockedDb.workspace.findFirst.mockResolvedValue(null);

        const result = await validateWorkspaceAccessById("deleted-ws", userId);

        expect(result).toEqual({
          hasAccess: false,
          canRead: false,
          canWrite: false,
          canAdmin: false,
        });
      });

      test("should return no access when user is not owner and not a member", async () => {
        const userId = "unauthorized-user-123";
        const memberWorkspace = {
          ...mockWorkspaceData,
          ownerId: "different-owner-123",
        };

        mockedDb.workspace.findFirst.mockResolvedValue(memberWorkspace);
        mockedDb.workspaceMember.findFirst.mockResolvedValue(null);

        const result = await validateWorkspaceAccessById("ws-123", userId);

        expect(mockedDb.workspaceMember.findFirst).toHaveBeenCalledWith({
          where: {
            workspaceId: "ws-123",
            userId: "unauthorized-user-123",
            leftAt: null,
          },
        });

        expect(result).toEqual({
          hasAccess: false,
          canRead: false,
          canWrite: false,
          canAdmin: false,
        });
      });

      test("should return no access when user has left the workspace", async () => {
        const userId = "former-member-123";
        const memberWorkspace = {
          ...mockWorkspaceData,
          ownerId: "different-owner-123",
        };

        mockedDb.workspace.findFirst.mockResolvedValue(memberWorkspace);
        mockedDb.workspaceMember.findFirst.mockResolvedValue(null); // leftAt is not null, so no membership found

        const result = await validateWorkspaceAccessById("ws-123", userId);

        expect(result).toEqual({
          hasAccess: false,
          canRead: false,
          canWrite: false,
          canAdmin: false,
        });
      });
    });

    describe("Edge Cases", () => {
      test("should handle null workspace ID", async () => {
        const userId = "any-user-123";
        mockedDb.workspace.findFirst.mockResolvedValue(null);

        const result = await validateWorkspaceAccessById(null as any, userId);

        expect(result).toEqual({
          hasAccess: false,
          canRead: false,
          canWrite: false,
          canAdmin: false,
        });
      });

      test("should handle undefined workspace ID", async () => {
        const userId = "any-user-123";
        mockedDb.workspace.findFirst.mockResolvedValue(null);

        const result = await validateWorkspaceAccessById(undefined as any, userId);

        expect(result).toEqual({
          hasAccess: false,
          canRead: false,
          canWrite: false,
          canAdmin: false,
        });
      });

      test("should handle empty workspace ID", async () => {
        const userId = "any-user-123";
        mockedDb.workspace.findFirst.mockResolvedValue(null);

        const result = await validateWorkspaceAccessById("", userId);

        expect(result).toEqual({
          hasAccess: false,
          canRead: false,
          canWrite: false,
          canAdmin: false,
        });
      });

      test("should handle null user ID", async () => {
        mockEncryptionService.decryptField.mockReturnValue("");
        mockedDb.workspace.findFirst.mockResolvedValue(mockWorkspaceData);
        mockedDb.workspaceMember.findFirst.mockResolvedValue(null);

        const result = await validateWorkspaceAccessById("ws-123", null as any);

        // Since workspace ownerId doesn't match null, should check membership
        expect(mockedDb.workspaceMember.findFirst).toHaveBeenCalled();
        expect(result).toEqual({
          hasAccess: false,
          canRead: false,
          canWrite: false,
          canAdmin: false,
        });
      });

      test("should handle undefined user ID", async () => {
        mockEncryptionService.decryptField.mockReturnValue("");
        mockedDb.workspace.findFirst.mockResolvedValue(mockWorkspaceData);
        mockedDb.workspaceMember.findFirst.mockResolvedValue(null);

        const result = await validateWorkspaceAccessById("ws-123", undefined as any);

        // Since workspace ownerId doesn't match undefined, should check membership
        expect(mockedDb.workspaceMember.findFirst).toHaveBeenCalled();
        expect(result).toEqual({
          hasAccess: false,
          canRead: false,
          canWrite: false,
          canAdmin: false,
        });
      });

      test("should handle workspace with null description", async () => {
        const userId = "owner-123";
        const workspaceWithNullDesc = {
          ...mockWorkspaceData,
          description: null,
        };

        mockEncryptionService.decryptField.mockReturnValue("");
        mockedDb.workspace.findFirst.mockResolvedValue(workspaceWithNullDesc);

        const result = await validateWorkspaceAccessById("ws-123", userId);

        expect(result.workspace?.description).toBeNull();
      });

      test("should properly convert Date objects to ISO strings", async () => {
        const userId = "owner-123";
        const testDate = new Date("2024-03-15T10:30:00.000Z");
        const workspaceWithDates = {
          ...mockWorkspaceData,
          createdAt: testDate,
          updatedAt: testDate,
        };

        mockEncryptionService.decryptField.mockReturnValue("");
        mockedDb.workspace.findFirst.mockResolvedValue(workspaceWithDates);

        const result = await validateWorkspaceAccessById("ws-123", userId);

        expect(result.workspace?.createdAt).toBe("2024-03-15T10:30:00.000Z");
        expect(result.workspace?.updatedAt).toBe("2024-03-15T10:30:00.000Z");
      });
    });

    describe("Error Handling", () => {
      test("should handle database connection errors", async () => {
        const userId = "any-user-123";
        const dbError = new Error("Database connection failed");
        mockedDb.workspace.findFirst.mockRejectedValue(dbError);

        await expect(validateWorkspaceAccessById("ws-123", userId)).rejects.toThrow(
          "Database connection failed"
        );
      });

      test("should handle membership query errors", async () => {
        const userId = "member-123";
        const memberWorkspace = {
          ...mockWorkspaceData,
          ownerId: "different-owner-123",
        };
        const membershipError = new Error("Membership query failed");

        mockEncryptionService.decryptField.mockReturnValue("");
        mockedDb.workspace.findFirst.mockResolvedValue(memberWorkspace);
        mockedDb.workspaceMember.findFirst.mockRejectedValue(membershipError);

        await expect(validateWorkspaceAccessById("ws-123", userId)).rejects.toThrow(
          "Membership query failed"
        );
      });
    });

    describe("Data Integrity", () => {
      test("should validate workspace data structure is preserved", async () => {
        const userId = "owner-123";
        mockEncryptionService.decryptField.mockReturnValue("");
        mockedDb.workspace.findFirst.mockResolvedValue(mockWorkspaceData);

        const result = await validateWorkspaceAccessById("ws-123", userId);

        // Ensure workspace object contains all required fields
        expect(result.workspace).toHaveProperty("id");
        expect(result.workspace).toHaveProperty("name");
        expect(result.workspace).toHaveProperty("description");
        expect(result.workspace).toHaveProperty("slug");
        expect(result.workspace).toHaveProperty("ownerId");
        expect(result.workspace).toHaveProperty("createdAt");
        expect(result.workspace).toHaveProperty("updatedAt");
      });

      test("should ensure permission flags are always boolean", async () => {
        const userId = "owner-123";
        mockEncryptionService.decryptField.mockReturnValue("");
        mockedDb.workspace.findFirst.mockResolvedValue(mockWorkspaceData);

        const result = await validateWorkspaceAccessById("ws-123", userId);

        expect(typeof result.hasAccess).toBe("boolean");
        expect(typeof result.canRead).toBe("boolean");
        expect(typeof result.canWrite).toBe("boolean");
        expect(typeof result.canAdmin).toBe("boolean");
      });

      test("should correctly map all workspace roles", async () => {
        const roles: WorkspaceRole[] = [
          WorkspaceRole.OWNER,
          WorkspaceRole.ADMIN,
          WorkspaceRole.PM,
          WorkspaceRole.DEVELOPER,
          WorkspaceRole.STAKEHOLDER,
          WorkspaceRole.VIEWER,
        ];

        for (const role of roles) {
          const userId = role === WorkspaceRole.OWNER ? "owner-123" : "member-123";
          const memberWorkspace = {
            ...mockWorkspaceData,
            ownerId: role === WorkspaceRole.OWNER ? "owner-123" : "different-owner-123",
          };

          mockEncryptionService.decryptField.mockReturnValue("");
          mockedDb.workspace.findFirst.mockResolvedValue(memberWorkspace);

          if (role !== WorkspaceRole.OWNER) {
            const mockMembership = {
              id: "membership-123",
              workspaceId: "ws-123",
              userId: "member-123",
              role,
              leftAt: null,
            };
            mockedDb.workspaceMember.findFirst.mockResolvedValue(mockMembership);
          }

          const result = await validateWorkspaceAccessById("ws-123", userId);

          expect(result.hasAccess).toBe(true);
          expect(result.userRole).toBe(role);
        }
      });
    });
  });
});
