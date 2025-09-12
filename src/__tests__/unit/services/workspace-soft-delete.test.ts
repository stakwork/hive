import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { softDeleteWorkspace } from "@/services/workspace";
import { db } from "@/lib/db";

// Mock the database
vi.mock("@/lib/db", () => ({
  db: {
    workspace: {
      update: vi.fn(),
    },
  },
}));

describe("softDeleteWorkspace - Database Write Operations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();
  });

  test("should successfully update workspace with deleted flag and timestamp", async () => {
    // Mock successful database update
    const mockUpdatedWorkspace = {
      id: "workspace-123",
      name: "Test Workspace",
      slug: "test-workspace",
      deleted: true,
      deletedAt: new Date("2024-01-15T10:30:00.000Z"),
    };

    (db.workspace.update as Mock).mockResolvedValue(mockUpdatedWorkspace);

    // Execute the function
    await softDeleteWorkspace("workspace-123");

    // Verify the database update was called with correct parameters
    expect(db.workspace.update).toHaveBeenCalledOnce();
    expect(db.workspace.update).toHaveBeenCalledWith({
      where: { id: "workspace-123" },
      data: {
        deleted: true,
        deletedAt: expect.any(Date),
      },
    });

    // Verify the deletedAt timestamp is recent (within last 5 seconds)
    const updateCall = (db.workspace.update as Mock).mock.calls[0][0];
    const deletedAtTime = updateCall.data.deletedAt;
    const now = new Date();
    const timeDifference = now.getTime() - deletedAtTime.getTime();
    expect(timeDifference).toBeLessThan(5000); // Less than 5 seconds ago
  });

  test("should handle database errors gracefully", async () => {
    // Mock database error (workspace not found)
    const databaseError = new Error("Record to update not found");
    (db.workspace.update as Mock).mockRejectedValue(databaseError);

    // Verify the function throws the database error
    await expect(softDeleteWorkspace("non-existent-workspace")).rejects.toThrow(
      "Record to update not found"
    );

    // Verify the database was called with correct parameters
    expect(db.workspace.update).toHaveBeenCalledOnce();
    expect(db.workspace.update).toHaveBeenCalledWith({
      where: { id: "non-existent-workspace" },
      data: {
        deleted: true,
        deletedAt: expect.any(Date),
      },
    });
  });

  test("should handle Prisma constraint violations", async () => {
    // Mock Prisma constraint error
    const constraintError = {
      code: "P2025",
      message: "An operation failed because it depends on one or more records that were required but not found.",
      meta: {
        cause: "Record to update not found.",
      },
    };
    (db.workspace.update as Mock).mockRejectedValue(constraintError);

    // Verify the function throws the Prisma error
    await expect(softDeleteWorkspace("invalid-workspace-id")).rejects.toMatchObject({
      code: "P2025",
      message: expect.stringContaining("operation failed"),
    });

    // Verify database interaction
    expect(db.workspace.update).toHaveBeenCalledOnce();
  });

  test("should work with different workspace ID formats", async () => {
    const testCases = [
      "ws-uuid-12345",
      "workspace_123",
      "01234567-89ab-cdef-0123-456789abcdef", // UUID format
      "short-id",
    ];

    for (const workspaceId of testCases) {
      // Reset mocks for each test case
      vi.clearAllMocks();
      (db.workspace.update as Mock).mockResolvedValue({ id: workspaceId });

      await softDeleteWorkspace(workspaceId);

      expect(db.workspace.update).toHaveBeenCalledWith({
        where: { id: workspaceId },
        data: {
          deleted: true,
          deletedAt: expect.any(Date),
        },
      });
    }
  });

  test("should set consistent timestamp format", async () => {
    (db.workspace.update as Mock).mockResolvedValue({ id: "test" });

    await softDeleteWorkspace("test-workspace");

    const updateCall = (db.workspace.update as Mock).mock.calls[0][0];
    const deletedAtTime = updateCall.data.deletedAt;

    // Verify timestamp is a Date object
    expect(deletedAtTime).toBeInstanceOf(Date);
    // Verify timestamp is valid
    expect(deletedAtTime.getTime()).toBeGreaterThan(0);
    // Verify timestamp is not in the future (with 1 second tolerance)
    expect(deletedAtTime.getTime()).toBeLessThanOrEqual(Date.now() + 1000);
  });

  test("should handle concurrent deletion attempts", async () => {
    // Simulate concurrent calls to the same workspace
    const workspaceId = "concurrent-workspace";
    let updateCallCount = 0;

    (db.workspace.update as Mock).mockImplementation(() => {
      updateCallCount++;
      if (updateCallCount === 1) {
        // First call succeeds
        return Promise.resolve({ id: workspaceId, deleted: true });
      } else {
        // Subsequent calls might fail if already deleted
        return Promise.reject({
          code: "P2025",
          message: "Record to update not found",
        });
      }
    });

    // First deletion should succeed
    await expect(softDeleteWorkspace(workspaceId)).resolves.not.toThrow();

    // Second concurrent deletion should handle the error appropriately
    await expect(softDeleteWorkspace(workspaceId)).rejects.toMatchObject({
      code: "P2025",
    });

    expect(db.workspace.update).toHaveBeenCalledTimes(2);
  });

  test("should preserve data integrity with exact field updates", async () => {
    (db.workspace.update as Mock).mockResolvedValue({ id: "test" });

    await softDeleteWorkspace("integrity-test-workspace");

    const updateCall = (db.workspace.update as Mock).mock.calls[0][0];

    // Verify only the expected fields are being updated
    expect(Object.keys(updateCall.data)).toEqual(['deleted', 'deletedAt']);
    expect(updateCall.data.deleted).toBe(true);
    expect(updateCall.data.deletedAt).toBeInstanceOf(Date);

    // Verify no other fields are accidentally modified
    expect(updateCall.data).not.toHaveProperty('name');
    expect(updateCall.data).not.toHaveProperty('slug');
    expect(updateCall.data).not.toHaveProperty('ownerId');
    expect(updateCall.data).not.toHaveProperty('updatedAt');
  });

  test("should handle database timeout scenarios", async () => {
    // Mock timeout error
    const timeoutError = new Error("Query timeout");
    timeoutError.name = "QueryTimeout";
    (db.workspace.update as Mock).mockRejectedValue(timeoutError);

    await expect(softDeleteWorkspace("timeout-workspace")).rejects.toThrow(
      "Query timeout"
    );

    expect(db.workspace.update).toHaveBeenCalledOnce();
  });
});