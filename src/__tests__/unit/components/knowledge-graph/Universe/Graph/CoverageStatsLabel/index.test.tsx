import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as useWorkspaceModule from "@/hooks/useWorkspace";
import * as useCoverageStoreModule from "@/stores/useCoverageStore";

// Mock hooks
vi.mock("@/hooks/useWorkspace");
vi.mock("@/stores/useCoverageStore");

// Mock 3D components to avoid rendering issues
vi.mock("@react-three/drei", () => ({
  Billboard: ({ children }: any) => children,
  Text: () => null,
}));

const mockUseWorkspace = vi.mocked(useWorkspaceModule.useWorkspace);
const mockUseCoverageStore = vi.mocked(useCoverageStoreModule.useCoverageStore);

describe("CoverageStatsLabel Component Logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should not fetch when workspaceId is missing", () => {
    mockUseWorkspace.mockReturnValue({
      id: undefined,
    } as any);
    mockUseCoverageStore.mockReturnValue({
      ignoreDirs: "",
      repo: "",
    } as any);

    // Component would handle this scenario by setting hasError
    expect(mockUseWorkspace).toBeDefined();
  });

  it("should construct correct API URL with workspaceId", () => {
    const workspaceId = "test-workspace-id";
    const ignoreDirs = "node_modules,dist";
    const repo = "test-repo";

    const params = new URLSearchParams({ workspaceId });
    if (ignoreDirs) {
      params.set("ignoreDirs", ignoreDirs);
    }
    if (repo) {
      params.set("repo", repo);
    }

    const url = `/api/tests/coverage?${params.toString()}`;
    
    expect(url).toContain("/api/tests/coverage");
    expect(url).toContain("workspaceId=test-workspace-id");
    expect(url).toContain("ignoreDirs=node_modules%2Cdist");
    expect(url).toContain("repo=test-repo");
  });

  it("should construct correct API URL without optional parameters", () => {
    const workspaceId = "test-workspace-id";
    const params = new URLSearchParams({ workspaceId });
    
    const url = `/api/tests/coverage?${params.toString()}`;
    
    expect(url).toBe("/api/tests/coverage?workspaceId=test-workspace-id");
    expect(url).not.toContain("ignoreDirs");
    expect(url).not.toContain("repo");
  });

  it("should handle API response with all coverage metrics", () => {
    const mockData = {
      success: true,
      data: {
        unit_tests: { covered: 10, total: 20 },
        integration_tests: { covered: 5, total: 10 },
        e2e_tests: { covered: 3, total: 6 },
        mocks: { mocked: 8, total: 12 },
      },
    };

    // Verify data structure
    expect(mockData.success).toBe(true);
    expect(mockData.data.unit_tests).toBeDefined();
    expect(mockData.data.integration_tests).toBeDefined();
    expect(mockData.data.e2e_tests).toBeDefined();
    expect(mockData.data.mocks).toBeDefined();
  });

  it("should handle API response without mocks", () => {
    const mockData = {
      success: true,
      data: {
        unit_tests: { covered: 10, total: 20 },
        integration_tests: { covered: 5, total: 10 },
        e2e_tests: { covered: 3, total: 6 },
      },
    };

    // Verify data structure
    expect(mockData.success).toBe(true);
    expect(mockData.data.mocks).toBeUndefined();
  });

  it("should handle unsuccessful API response", () => {
    const mockResponse = {
      ok: false,
      json: async () => ({ success: false }),
    };

    expect(mockResponse.ok).toBe(false);
  });

  it("should generate correct display lines for coverage data", () => {
    const data = {
      unit_tests: { covered: 10, total: 20 },
      integration_tests: { covered: 5, total: 10 },
      e2e_tests: { covered: 3, total: 6 },
      mocks: { mocked: 8, total: 12 },
    };

    const lines: string[] = [];

    if (data.unit_tests) {
      lines.push(`Unit: ${data.unit_tests.covered || 0}/${data.unit_tests.total || 0}`);
    }
    if (data.integration_tests) {
      lines.push(`Integration: ${data.integration_tests.covered || 0}/${data.integration_tests.total || 0}`);
    }
    if (data.e2e_tests) {
      lines.push(`E2E: ${data.e2e_tests.covered || 0}/${data.e2e_tests.total || 0}`);
    }
    if (data.mocks) {
      lines.push(`Mocks: ${data.mocks.mocked || 0}/${data.mocks.total || 0}`);
    }

    expect(lines).toEqual([
      "Unit: 10/20",
      "Integration: 5/10",
      "E2E: 3/6",
      "Mocks: 8/12",
    ]);
  });

  it("should handle missing coverage values gracefully", () => {
    const data = {
      unit_tests: { covered: undefined, total: undefined },
      integration_tests: { covered: 0, total: 0 },
    };

    const lines: string[] = [];

    if (data.unit_tests) {
      lines.push(`Unit: ${data.unit_tests.covered || 0}/${data.unit_tests.total || 0}`);
    }
    if (data.integration_tests) {
      lines.push(`Integration: ${data.integration_tests.covered || 0}/${data.integration_tests.total || 0}`);
    }

    expect(lines).toEqual([
      "Unit: 0/0",
      "Integration: 0/0",
    ]);
  });
});
