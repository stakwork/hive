import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { claimPodAndGetFrontend, getWorkspaceFromPool, type PodWorkspace } from "@/lib/pods/utils";
import { POD_PORTS } from "@/lib/pods/constants";

// Define ProcessInfo interface for test data
interface ProcessInfo {
  pid: number;
  name: string;
  status: string;
  pm_uptime: number;
  port?: string;
  cwd?: string;
}

// Mock env config before importing modules that use it
vi.mock("@/lib/env", () => ({
  config: {
    POOL_MANAGER_BASE_URL: "https://pool-manager.example.com",
  },
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe("claimPodAndGetFrontend", () => {
  const mockPoolName = "test-pool";
  const mockPoolApiKey = "test-api-key-secure-123";

  const mockWorkspace: PodWorkspace = {
    id: "workspace-abc123",
    password: "secure-pod-password",
    fqdn: "workspace.pool.example.com",
    portMappings: {
      "15552": "https://control-abc123.example.com",
      "3000": "https://app-abc123.example.com",
      "8080": "https://api-abc123.example.com",
    },
    state: "running",
    url: "https://ide-abc123.example.com",
    subdomain: "workspace-abc123",
    image: "stakwork/hive:latest",
    customImage: false,
    created: "2024-01-15T10:30:00Z",
    marked_at: null,
    usage_status: "available",
    flagged_for_recreation: false,
    primaryRepo: null,
    repoName: null,
    repositories: [],
    branches: [],
    useDevContainer: false,
  };

  const mockProcessList: ProcessInfo[] = [
    {
      pid: 1234,
      name: "frontend",
      status: "online",
      pm_uptime: 123456,
      port: "3000",
      cwd: "/workspace/app",
    },
    {
      pid: 5678,
      name: "api",
      status: "online",
      pm_uptime: 123456,
      port: "8080",
      cwd: "/workspace/api",
    },
  ];

  beforeEach(() => {
    mockFetch.mockClear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("successful pod claiming", () => {
    it("should claim pod and return frontend URL with process list", async () => {
      // Arrange - Mock API calls in sequence
      mockFetch
        // getWorkspaceFromPool
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ workspace: mockWorkspace }),
        })
        // markWorkspaceAsUsed
        .mockResolvedValueOnce({
          ok: true,
          text: async () => "Success",
        })
        // getProcessList
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockProcessList,
        });

      // Act
      const result = await claimPodAndGetFrontend(mockPoolName, mockPoolApiKey);

      // Assert
      expect(mockFetch).toHaveBeenCalledTimes(3);

      // Verify getWorkspaceFromPool call
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining(`/pools/${mockPoolName}/workspace`),
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: `Bearer ${mockPoolApiKey}`,
          }),
        }),
      );

      // Verify markWorkspaceAsUsed call
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining(`/pools/${mockPoolName}/workspaces/${mockWorkspace.id}/mark-used`),
        expect.objectContaining({
          method: "POST",
          headers: expect.objectContaining({
            Authorization: `Bearer ${mockPoolApiKey}`,
          }),
        }),
      );

      // Verify getProcessList call
      expect(mockFetch).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining("/jlist"),
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: `Bearer ${mockWorkspace.password}`,
          }),
        }),
      );

      expect(result).toEqual({
        frontend: "https://app-abc123.example.com",
        workspace: mockWorkspace,
        processList: mockProcessList,
      });
    });

    it("should pass workspace password to getProcessList", async () => {
      // Arrange
      const workspaceWithSpecialPassword: PodWorkspace = {
        ...mockWorkspace,
        password: "p@ssw0rd!#$%^&*()",
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ workspace: workspaceWithSpecialPassword }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => "Success",
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockProcessList,
        });

      // Act
      await claimPodAndGetFrontend(mockPoolName, mockPoolApiKey);

      // Assert - Check the Authorization header for getProcessList call
      expect(mockFetch).toHaveBeenNthCalledWith(
        3,
        expect.any(String),
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer p@ssw0rd!#$%^&*()`,
          }),
        }),
      );
    });
  });

  describe("fallback behavior when control port is missing", () => {
    it("should fallback to port 3000 when control port is not in portMappings", async () => {
      // Arrange
      const workspaceWithoutControlPort: PodWorkspace = {
        ...mockWorkspace,
        portMappings: {
          "3000": "https://app-abc123.example.com",
          "8080": "https://api-abc123.example.com",
        },
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ workspace: workspaceWithoutControlPort }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => "Success",
        });

      // Act
      const result = await claimPodAndGetFrontend(mockPoolName, mockPoolApiKey);

      // Assert - Should only call getWorkspaceFromPool and markWorkspaceAsUsed, not getProcessList
      expect(mockFetch).toHaveBeenCalledTimes(2);

      expect(result).toEqual({
        frontend: "https://app-abc123.example.com",
        workspace: workspaceWithoutControlPort,
        processList: undefined,
      });
    });

    it("should log fallback message when using port 3000 due to missing control port", async () => {
      // Arrange
      const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

      const workspaceWithoutControlPort: PodWorkspace = {
        ...mockWorkspace,
        portMappings: {
          "3000": "https://app-abc123.example.com",
        },
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ workspace: workspaceWithoutControlPort }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => "Success",
        });

      // Act
      await claimPodAndGetFrontend(mockPoolName, mockPoolApiKey);

      // Assert
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining(`Control port (${POD_PORTS.CONTROL}) not found in port mappings`),
      );
      // consoleSpy receives multiple log calls, need to check any of them
      const logCalls = consoleSpy.mock.calls;
      const hasFallbackLog = logCalls.some((call) =>
        call.some(
          (arg) =>
            typeof arg === "string" && arg.includes(`Using fallback frontend on port ${POD_PORTS.FRONTEND_FALLBACK}`),
        ),
      );
      expect(hasFallbackLog).toBe(true);

      consoleSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });
  });

  describe("fallback behavior when process discovery fails", () => {
    it("should fallback to port 3000 when getProcessList throws error", async () => {
      // Arrange
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ workspace: mockWorkspace }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => "Success",
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => "Internal Server Error",
        });

      // Act
      const result = await claimPodAndGetFrontend(mockPoolName, mockPoolApiKey);

      // Assert
      expect(mockFetch).toHaveBeenCalledTimes(3);

      expect(result).toEqual({
        frontend: "https://app-abc123.example.com",
        workspace: mockWorkspace,
        processList: undefined,
      });
    });

    it("should fallback to port 3000 when frontend process not found", async () => {
      // Arrange - Empty process list
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ workspace: mockWorkspace }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => "Success",
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [],
        });

      // Act
      const result = await claimPodAndGetFrontend(mockPoolName, mockPoolApiKey);

      // Assert - Empty array is successfully retrieved, but getFrontendUrl fails
      expect(result.frontend).toBe("https://app-abc123.example.com");
      // processList is set to empty array from getProcessList before getFrontendUrl fails,
      // so it remains as empty array in the return value
      expect(result.processList).toEqual([]);
    });
  });

  describe("error handling", () => {
    it("should use final fallback URL when both process discovery fails and port 3000 is missing", async () => {
      // Arrange
      const workspaceWithoutPort3000: PodWorkspace = {
        ...mockWorkspace,
        portMappings: {
          "15552": "https://control-abc123.example.com",
          "8080": "https://api-abc123.example.com",
        },
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ workspace: workspaceWithoutPort3000 }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => "Success",
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => "Control API unavailable",
        });

      // Act
      const result = await claimPodAndGetFrontend(mockPoolName, mockPoolApiKey);

      // Assert - Should use final fallback (replace port 15552 with 3000 in control URL)
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(result.frontend).toBe("https://control-abc123.example.com".replace("15552", "3000"));
      expect(result.workspace).toEqual(workspaceWithoutPort3000);
      expect(result.processList).toBeUndefined();
    });

    it("should use final fallback URL when frontend port not found in mappings and no port 3000", async () => {
      // Arrange
      const workspaceWithControlButNoFallback: PodWorkspace = {
        ...mockWorkspace,
        portMappings: {
          "15552": "https://control-abc123.example.com",
          "8080": "https://api-abc123.example.com",
        },
      };

      const processListWithoutMappedPort: ProcessInfo[] = [
        {
          pid: 1234,
          name: "frontend",
          status: "online",
          pm_uptime: 123456,
          port: "5000", // Port that doesn't exist in portMappings
          cwd: "/workspace/app",
        },
      ];

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ workspace: workspaceWithControlButNoFallback }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => "Success",
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => processListWithoutMappedPort,
        });

      // Act
      const result = await claimPodAndGetFrontend(mockPoolName, mockPoolApiKey);

      // Assert - Should use final fallback (replace port 15552 with 3000 in control URL)
      expect(result.frontend).toBe("https://control-abc123.example.com".replace("15552", "3000"));
      expect(result.workspace).toEqual(workspaceWithControlButNoFallback);
      expect(result.processList).toEqual(processListWithoutMappedPort);
    });

    it("should propagate errors from getWorkspaceFromPool", async () => {
      // Arrange
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 503,
        text: async () => "Pool exhausted - no available workspaces",
      });

      // Act & Assert
      await expect(claimPodAndGetFrontend(mockPoolName, mockPoolApiKey)).rejects.toThrow(
        "Failed to get workspace from pool: 503",
      );

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("should propagate errors from markWorkspaceAsUsed", async () => {
      // Arrange
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ workspace: mockWorkspace }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => "Failed to mark workspace as used",
        });

      // Act & Assert
      await expect(claimPodAndGetFrontend(mockPoolName, mockPoolApiKey)).rejects.toThrow(
        "Failed to mark workspace as used: 500",
      );

      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("should handle network errors during workspace claiming", async () => {
      // Arrange
      mockFetch.mockRejectedValueOnce(new Error("Network timeout after 30s"));

      // Act & Assert
      await expect(claimPodAndGetFrontend(mockPoolName, mockPoolApiKey)).rejects.toThrow("Network timeout after 30s");
    });
  });

  describe("return value validation", () => {
    it("should return correct structure with all required fields when successful", async () => {
      // Arrange
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ workspace: mockWorkspace }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => "Success",
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockProcessList,
        });

      // Act
      const result = await claimPodAndGetFrontend(mockPoolName, mockPoolApiKey);

      // Assert
      expect(result).toHaveProperty("frontend");
      expect(result).toHaveProperty("workspace");
      expect(result).toHaveProperty("processList");

      expect(typeof result.frontend).toBe("string");
      expect(result.frontend).toMatch(/^https?:\/\//);

      expect(result.workspace).toEqual(mockWorkspace);
      expect(result.workspace).toHaveProperty("id");
      expect(result.workspace).toHaveProperty("password");
      expect(result.workspace).toHaveProperty("portMappings");

      expect(Array.isArray(result.processList)).toBe(true);
      expect(result.processList).toHaveLength(mockProcessList.length);
    });

    it("should return processList as undefined when fallback is used", async () => {
      // Arrange
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ workspace: mockWorkspace }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => "Success",
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => "Failed to get processes",
        });

      // Act
      const result = await claimPodAndGetFrontend(mockPoolName, mockPoolApiKey);

      // Assert
      expect(result).toHaveProperty("frontend");
      expect(result).toHaveProperty("workspace");
      expect(result).toHaveProperty("processList");

      expect(result.processList).toBeUndefined();
      expect(result.frontend).toBe("https://app-abc123.example.com");
      expect(result.workspace).toEqual(mockWorkspace);
    });

    it("should return workspace object with all properties intact", async () => {
      // Arrange
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ workspace: mockWorkspace }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => "Success",
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockProcessList,
        });

      // Act
      const result = await claimPodAndGetFrontend(mockPoolName, mockPoolApiKey);

      // Assert
      expect(result.workspace.id).toBe(mockWorkspace.id);
      expect(result.workspace.password).toBe(mockWorkspace.password);
      expect(result.workspace.fqdn).toBe(mockWorkspace.fqdn);
      expect(result.workspace.portMappings).toEqual(mockWorkspace.portMappings);
      expect(result.workspace.state).toBe(mockWorkspace.state);
    });
  });

  describe("edge cases", () => {
    it("should handle workspace with minimal port mappings", async () => {
      // Arrange
      const minimalWorkspace: PodWorkspace = {
        ...mockWorkspace,
        portMappings: {
          "15552": "https://control-abc123.example.com",
          "3000": "https://app-abc123.example.com",
        },
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ workspace: minimalWorkspace }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => "Success",
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          text: async () => "Process discovery failed",
        });

      // Act
      const result = await claimPodAndGetFrontend(mockPoolName, mockPoolApiKey);

      // Assert
      expect(result.frontend).toBe("https://app-abc123.example.com");
      expect(result.workspace).toEqual(minimalWorkspace);
      expect(result.processList).toBeUndefined();
    });

    it("should handle workspace with many port mappings", async () => {
      // Arrange
      const workspaceWithManyPorts: PodWorkspace = {
        ...mockWorkspace,
        portMappings: {
          "15552": "https://control-abc123.example.com",
          "3000": "https://app-abc123.example.com",
          "8080": "https://api-abc123.example.com",
          "5432": "https://db-abc123.example.com",
          "6379": "https://redis-abc123.example.com",
          "9200": "https://search-abc123.example.com",
        },
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ workspace: workspaceWithManyPorts }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => "Success",
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockProcessList,
        });

      // Act
      const result = await claimPodAndGetFrontend(mockPoolName, mockPoolApiKey);

      // Assert
      expect(result.frontend).toBe("https://app-abc123.example.com");
      expect(result.workspace.portMappings).toHaveProperty("15552");
      expect(result.workspace.portMappings).toHaveProperty("3000");
      expect(Object.keys(result.workspace.portMappings).length).toBe(6);
    });

    it("should handle process list with many processes", async () => {
      // Arrange
      const largeProcessList: ProcessInfo[] = [
        { pid: 1, name: "frontend", status: "online", pm_uptime: 1000, port: "3000" },
        { pid: 2, name: "api", status: "online", pm_uptime: 1000, port: "8080" },
        { pid: 3, name: "worker-1", status: "online", pm_uptime: 1000 },
        { pid: 4, name: "worker-2", status: "online", pm_uptime: 1000 },
        { pid: 5, name: "cron", status: "online", pm_uptime: 1000 },
      ];

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ workspace: mockWorkspace }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => "Success",
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => largeProcessList,
        });

      // Act
      const result = await claimPodAndGetFrontend(mockPoolName, mockPoolApiKey);

      // Assert
      expect(result.processList).toEqual(largeProcessList);
      expect(result.processList?.length).toBe(5);
    });

    it("should handle workspace with null or undefined optional fields", async () => {
      // Arrange
      const workspaceWithNulls: PodWorkspace = {
        id: "workspace-xyz",
        password: "password",
        fqdn: "xyz.example.com",
        portMappings: {
          "3000": "https://app-xyz.example.com",
        },
        state: "running",
        url: null,
        subdomain: "xyz",
        image: "default",
        customImage: null,
        created: "2024-01-01T00:00:00Z",
        marked_at: null,
        usage_status: "available",
        flagged_for_recreation: false,
        primaryRepo: null,
        repoName: null,
        repositories: [],
        branches: [],
        useDevContainer: false,
      };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ workspace: workspaceWithNulls }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => "Success",
        });

      // Act
      const result = await claimPodAndGetFrontend(mockPoolName, mockPoolApiKey);

      // Assert
      expect(result.workspace.url).toBeNull();
      expect(result.workspace.customImage).toBeNull();
      expect(result.workspace.primaryRepo).toBeNull();
      expect(result.frontend).toBe("https://app-xyz.example.com");
    });

    it("should handle pool names with special characters", async () => {
      // Arrange
      const specialPoolName = "pool-name-with-dashes_and_underscores.dots";

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ workspace: mockWorkspace }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => "Success",
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockProcessList,
        });

      // Act
      await claimPodAndGetFrontend(specialPoolName, mockPoolApiKey);

      // Assert
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        expect.stringContaining(encodeURIComponent(specialPoolName)),
        expect.any(Object),
      );
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        expect.stringContaining(encodeURIComponent(specialPoolName)),
        expect.any(Object),
      );
    });
  });

  describe("integration scenarios", () => {
    it("should handle complete workflow from claim to frontend discovery", async () => {
      // Arrange - simulate complete successful flow
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ workspace: mockWorkspace }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => "Success",
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockProcessList,
        });

      // Act
      const result = await claimPodAndGetFrontend(mockPoolName, mockPoolApiKey);

      // Assert - verify complete workflow
      expect(mockFetch).toHaveBeenCalledTimes(3);

      expect(result.frontend).toBeTruthy();
      expect(result.workspace.id).toBeTruthy();
      expect(result.processList).toBeTruthy();
    });

    it("should maintain workspace state through claiming process", async () => {
      // Arrange
      const workspaceBeforeClaim = { ...mockWorkspace };

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ workspace: workspaceBeforeClaim }),
        })
        .mockResolvedValueOnce({
          ok: true,
          text: async () => "Success",
        })
        .mockResolvedValueOnce({
          ok: true,
          json: async () => mockProcessList,
        });

      // Act
      const result = await claimPodAndGetFrontend(mockPoolName, mockPoolApiKey);

      // Assert - workspace object should be unchanged
      expect(result.workspace).toEqual(workspaceBeforeClaim);
      expect(result.workspace.state).toBe("running");
      expect(result.workspace.usage_status).toBe("available");
    });
  });
});
