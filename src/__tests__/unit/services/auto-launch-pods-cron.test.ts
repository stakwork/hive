import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeAutoLaunchPods } from "@/services/auto-launch-pods-cron";
import { db } from "@/lib/db";
import { PoolState } from "@prisma/client";

vi.mock("@/lib/db");

const mockedDb = vi.mocked(db);

describe("Auto-launch Pods Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(db, {
      workspace: {
        findMany: vi.fn(),
      },
    });
  });

  describe("executeAutoLaunchPods", () => {
    it("should return 0 processed when no eligible workspaces exist", async () => {
      vi.mocked(mockedDb.workspace.findMany).mockResolvedValue([]);

      const result = await executeAutoLaunchPods();

      expect(result.success).toBe(true);
      expect(result.workspacesProcessed).toBe(0);
      expect(result.launchesTriggered).toBe(0);
      expect(result.errors).toEqual([]);
      expect(result.timestamp).toBeInstanceOf(Date);
    });

    it("should query workspaces with correct filters", async () => {
      vi.mocked(mockedDb.workspace.findMany).mockResolvedValue([]);

      await executeAutoLaunchPods();

      expect(mockedDb.workspace.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            swarm: {
              containerFilesSetUp: true,
              poolState: PoolState.NOT_STARTED,
              services: {
                not: {
                  equals: [],
                },
              },
            },
          },
        })
      );
    });

    it("should process eligible workspaces with non-empty services", async () => {
      const mockWorkspaces = [
        {
          id: "ws-1",
          slug: "test-workspace-1",
          name: "Test Workspace 1",
          swarm: {
            id: "swarm-1",
            name: "test-swarm-1",
            containerFiles: [],
            services: [{ name: "frontend", port: 3000 }],
            poolState: PoolState.NOT_STARTED,
            containerFilesSetUp: true,
          },
        },
        {
          id: "ws-2",
          slug: "test-workspace-2",
          name: "Test Workspace 2",
          swarm: {
            id: "swarm-2",
            name: "test-swarm-2",
            containerFiles: [],
            services: [{ name: "backend", port: 4000 }],
            poolState: PoolState.NOT_STARTED,
            containerFilesSetUp: true,
          },
        },
      ];

      vi.mocked(mockedDb.workspace.findMany).mockResolvedValue(mockWorkspaces as any);

      const result = await executeAutoLaunchPods();

      expect(result.success).toBe(true);
      expect(result.workspacesProcessed).toBe(2);
      expect(result.launchesTriggered).toBe(2);
      expect(result.errors).toEqual([]);
    });

    it("should filter out workspaces with empty services array", async () => {
      const mockWorkspaces = [
        {
          id: "ws-1",
          slug: "test-workspace-1",
          name: "Test Workspace 1",
          swarm: {
            id: "swarm-1",
            name: "test-swarm-1",
            containerFiles: [],
            services: [],
            poolState: PoolState.NOT_STARTED,
            containerFilesSetUp: true,
          },
        },
        {
          id: "ws-2",
          slug: "test-workspace-2",
          name: "Test Workspace 2",
          swarm: {
            id: "swarm-2",
            name: "test-swarm-2",
            containerFiles: [],
            services: [{ name: "backend", port: 4000 }],
            poolState: PoolState.NOT_STARTED,
            containerFilesSetUp: true,
          },
        },
      ];

      vi.mocked(mockedDb.workspace.findMany).mockResolvedValue(mockWorkspaces as any);

      const result = await executeAutoLaunchPods();

      expect(result.success).toBe(true);
      expect(result.workspacesProcessed).toBe(1); // Only workspace 2 processed
      expect(result.launchesTriggered).toBe(1);
      expect(result.errors).toEqual([]);
    });

    it("should handle database query errors gracefully", async () => {
      vi.mocked(mockedDb.workspace.findMany).mockRejectedValue(
        new Error("Database connection failed")
      );

      const result = await executeAutoLaunchPods();

      expect(result.success).toBe(false);
      expect(result.workspacesProcessed).toBe(0);
      expect(result.launchesTriggered).toBe(0);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0].workspaceSlug).toBe("SYSTEM");
      expect(result.errors[0].error).toBe("Database connection failed");
    });

    it("should include select fields for workspace and swarm data", async () => {
      vi.mocked(mockedDb.workspace.findMany).mockResolvedValue([]);

      await executeAutoLaunchPods();

      expect(mockedDb.workspace.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          select: {
            id: true,
            slug: true,
            name: true,
            swarm: {
              select: {
                id: true,
                name: true,
                containerFiles: true,
                services: true,
                poolState: true,
                containerFilesSetUp: true,
              },
            },
          },
        })
      );
    });

    it("should return timestamp with result", async () => {
      vi.mocked(mockedDb.workspace.findMany).mockResolvedValue([]);

      const beforeTime = new Date();
      const result = await executeAutoLaunchPods();
      const afterTime = new Date();

      expect(result.timestamp.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime());
      expect(result.timestamp.getTime()).toBeLessThanOrEqual(afterTime.getTime());
    });
  });
});
