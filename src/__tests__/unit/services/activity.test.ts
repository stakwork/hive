import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { getWorkspaceActivity } from "@/services/activity";
import { swarmGraphQuery } from "@/services/swarm/api/swarm";
import { db } from "@/lib/db";

// Mock the database
vi.mock("@/lib/db", () => ({
  db: {
    workspace: {
      findUnique: vi.fn(),
    },
  },
}));

// Mock the swarm API
vi.mock("@/services/swarm/api/swarm", () => ({
  swarmGraphQuery: vi.fn(),
}));

const mockDb = db as {
  workspace: {
    findUnique: Mock;
  };
};

const mockSwarmGraphQuery = swarmGraphQuery as Mock;

describe("Activity Service - Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("getWorkspaceActivity", () => {
    test("should return error when workspace not found", async () => {
      // Arrange
      mockDb.workspace.findUnique.mockResolvedValue(null);

      // Act
      const result = await getWorkspaceActivity("nonexistent-workspace");

      // Assert
      expect(result).toEqual({
        success: false,
        data: [],
        error: "Workspace not found"
      });
      expect(mockDb.workspace.findUnique).toHaveBeenCalledWith({
        where: { slug: "nonexistent-workspace" },
        include: {
          swarm: {
            where: {
              status: "ACTIVE",
              swarmUrl: { not: null },
              swarmApiKey: { not: null }
            }
          }
        }
      });
    });

    test("should return error when no active swarm configured", async () => {
      // Arrange
      const mockWorkspace = {
        id: "workspace-1",
        slug: "test-workspace",
        swarm: null
      };
      mockDb.workspace.findUnique.mockResolvedValue(mockWorkspace);

      // Act
      const result = await getWorkspaceActivity("test-workspace");

      // Assert
      expect(result).toEqual({
        success: true,
        data: [],
        error: "No active swarm configured for this workspace"
      });
    });

    test("should return error when swarm configuration incomplete", async () => {
      // Arrange
      const mockWorkspace = {
        id: "workspace-1",
        slug: "test-workspace",
        swarm: {
          id: "swarm-1",
          swarmUrl: null,
          swarmApiKey: "encrypted-key"
        }
      };
      mockDb.workspace.findUnique.mockResolvedValue(mockWorkspace);

      // Act
      const result = await getWorkspaceActivity("test-workspace");

      // Assert
      expect(result).toEqual({
        success: true,
        data: [],
        error: "Swarm configuration incomplete"
      });
    });

    test("should return error when swarm API fails", async () => {
      // Arrange
      const mockWorkspace = {
        id: "workspace-1",
        slug: "test-workspace",
        swarm: {
          id: "swarm-1",
          swarmUrl: "https://test.sphinx.chat/api",
          swarmApiKey: "encrypted-key"
        }
      };
      mockDb.workspace.findUnique.mockResolvedValue(mockWorkspace);
      mockSwarmGraphQuery.mockResolvedValue({
        ok: false,
        status: 500,
        data: null
      });

      // Act
      const result = await getWorkspaceActivity("test-workspace");

      // Assert
      expect(result).toEqual({
        success: false,
        data: [],
        error: "Failed to fetch activity from swarm: 500"
      });
      expect(mockSwarmGraphQuery).toHaveBeenCalledWith({
        swarmUrl: "https://test.sphinx.chat/api",
        apiKey: "encrypted-key",
        nodeType: ["Episode"],
        topNodeCount: 5,
        depth: 0,
        sortBy: "date_added_to_graph"
      });
    });

    test("should successfully return transformed activities", async () => {
      // Arrange
      const mockWorkspace = {
        id: "workspace-1",
        slug: "test-workspace",
        swarm: {
          id: "swarm-1",
          swarmUrl: "https://test.sphinx.chat/api",
          swarmApiKey: "encrypted-key"
        }
      };
      
      const mockSwarmResponse = {
        ok: true,
        status: 200,
        data: {
          nodes: [
            {
              ref_id: "episode-1",
              node_type: "Episode",
              date_added_to_graph: 1700000000,
              properties: {
                episode_title: "Test Episode 1"
              }
            },
            {
              ref_id: "episode-2", 
              node_type: "Episode",
              date_added_to_graph: 1700001000,
              properties: {
                episode_title: "Test Episode 2"
              }
            }
          ]
        }
      };

      mockDb.workspace.findUnique.mockResolvedValue(mockWorkspace);
      mockSwarmGraphQuery.mockResolvedValue(mockSwarmResponse);

      // Act
      const result = await getWorkspaceActivity("test-workspace", 2);

      // Assert
      expect(result.success).toBe(true);
      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toEqual({
        id: "episode-1",
        type: "episode",
        summary: "Test Episode 1",
        user: "System",
        timestamp: new Date(1700000000 * 1000),
        status: "active",
        metadata: expect.objectContaining({
          nodeType: "Episode",
          originalData: expect.any(Object)
        })
      });
      expect(mockSwarmGraphQuery).toHaveBeenCalledWith({
        swarmUrl: "https://test.sphinx.chat/api",
        apiKey: "encrypted-key", 
        nodeType: ["Episode"],
        topNodeCount: 2,
        depth: 0,
        sortBy: "date_added_to_graph"
      });
    });

    test("should handle empty swarm response", async () => {
      // Arrange
      const mockWorkspace = {
        id: "workspace-1",
        slug: "test-workspace",
        swarm: {
          id: "swarm-1",
          swarmUrl: "https://test.sphinx.chat/api",
          swarmApiKey: "encrypted-key"
        }
      };
      
      mockDb.workspace.findUnique.mockResolvedValue(mockWorkspace);
      mockSwarmGraphQuery.mockResolvedValue({
        ok: true,
        status: 200,
        data: { nodes: [] }
      });

      // Act
      const result = await getWorkspaceActivity("test-workspace");

      // Assert
      expect(result).toEqual({
        success: true,
        data: []
      });
    });

    test("should handle unexpected errors gracefully", async () => {
      // Arrange
      mockDb.workspace.findUnique.mockRejectedValue(new Error("Database error"));

      // Act
      const result = await getWorkspaceActivity("test-workspace");

      // Assert
      expect(result).toEqual({
        success: false,
        data: [],
        error: "Internal server error"
      });
    });
  });
});