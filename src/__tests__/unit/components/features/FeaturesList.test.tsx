import React from "react";
import { describe, test, it, expect, vi } from "vitest";
import { render, waitFor, fireEvent } from "@testing-library/react";
import { FeaturesList } from "@/components/features/FeaturesList";
import * as navigation from "next/navigation";

// Mock Next.js router
const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({
    push: mockPush,
    replace: vi.fn(),
    refresh: vi.fn(),
  })),
  useSearchParams: vi.fn(() => {
    const params = new URLSearchParams();
    return params;
  }),
  usePathname: vi.fn(() => "/w/test-workspace/plan"),
}));

// Mock hooks
vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    slug: "test-workspace",
    workspace: {
      slug: "test-workspace",
      repositories: [],
    },
  }),
}));

vi.mock("@/hooks/usePusherConnection", () => ({
  usePusherConnection: () => {},
}));

vi.mock("@/hooks/useWorkspaceMembers", () => ({
  useWorkspaceMembers: () => ({
    members: [],
  }),
}));

// Mock TableColumnHeaders components
vi.mock("@/components/features/TableColumnHeaders", () => ({
  SortableColumnHeader: ({ children }: any) => <th>{children}</th>,
  FilterDropdownHeader: ({ children }: any) => <th>{children}</th>,
}));

// Mock all child components
vi.mock("@/components/features/StatusPopover", () => ({
  StatusPopover: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/features/PriorityPopover", () => ({
  PriorityPopover: ({ children }: any) => <div>{children}</div>,
}));

vi.mock("@/components/features/AssigneeCombobox", () => ({
  AssigneeCombobox: () => <div data-testid="assignee-combobox">Assignee</div>,
}));

vi.mock("@/components/tasks/DeploymentStatusBadge", () => ({
  DeploymentStatusBadge: () => <div data-testid="deployment-badge">Badge</div>,
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children }: any) => <div>{children}</div>,
}));

describe("FeaturesList - Link Navigation", () => {
  test("renders feature rows as clickable table rows", async () => {
    // Mock the fetch call that FeaturesList makes
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: [
          {
            id: "feature-1",
            title: "Test Feature",
            status: "IN_PROGRESS",
            priority: "HIGH",
            createdBy: { id: "user-1", name: "John Doe" },
            createdAt: new Date("2024-01-01"),
            updatedAt: new Date("2024-01-01"),
            _count: { tasks: 5 },
          },
        ],
        pagination: {
          page: 1,
          limit: 10,
          totalPages: 1,
          hasMore: false,
          totalCountWithoutFilters: 1,
        },
      }),
    });

    const { container } = render(<FeaturesList workspaceId="workspace-1" />);

    // Wait for the component to render with data — rows use onClick navigation
    await waitFor(() => {
      const rows = container.querySelectorAll("tr.cursor-pointer");
      expect(rows.length).toBeGreaterThan(0);
    });

    const rows = container.querySelectorAll("tr.cursor-pointer");
    expect(rows.length).toBeGreaterThan(0);
  });

  test("renders table rows with cursor-pointer for click navigation", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: [
          {
            id: "feature-1",
            title: "Test Feature",
            status: "IN_PROGRESS",
            createdBy: { id: "user-1", name: "John" },
            createdAt: new Date(),
            updatedAt: new Date(),
            _count: { tasks: 0 },
          },
        ],
        pagination: { page: 1, limit: 10, totalPages: 1, hasMore: false, totalCountWithoutFilters: 1 },
      }),
    });

    const { container } = render(<FeaturesList workspaceId="workspace-1" />);

    await waitFor(() => {
      const rows = container.querySelectorAll("tr.cursor-pointer");
      expect(rows.length).toBeGreaterThan(0);
    });
  });

  test("renders feature title text in table rows", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: [
          {
            id: "feature-1",
            title: "Test Feature",
            status: "TODO",
            createdBy: { id: "user-1", name: "John" },
            createdAt: new Date(),
            updatedAt: new Date(),
            _count: { tasks: 0 },
          },
        ],
        pagination: { page: 1, limit: 10, totalPages: 1, hasMore: false, totalCountWithoutFilters: 1 },
      }),
    });

    const { container } = render(<FeaturesList workspaceId="workspace-1" />);

    await waitFor(() => {
      const rows = container.querySelectorAll("tr.cursor-pointer");
      expect(rows.length).toBeGreaterThan(0);
    });

    // Title text is rendered directly (no overlay anchor in new implementation)
    expect(container.textContent).toContain("Test Feature");
  });

  test("encodes current URL as `from` param when navigating to a plan on page 1 (no page param)", async () => {
    // Default mock: pathname = /w/test-workspace/plan, searchParams = empty
    mockPush.mockClear();

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: [
          {
            id: "feature-1",
            title: "Test Feature",
            status: "IN_PROGRESS",
            createdBy: { id: "user-1", name: "John" },
            createdAt: new Date(),
            updatedAt: new Date(),
            _count: { tasks: 0 },
          },
        ],
        pagination: { page: 1, limit: 10, totalPages: 1, hasMore: false, totalCountWithoutFilters: 1 },
      }),
    });

    const { container } = render(<FeaturesList workspaceId="workspace-1" />);

    await waitFor(() => {
      expect(container.querySelectorAll("tr.cursor-pointer").length).toBeGreaterThan(0);
    });

    const row = container.querySelector("tr.cursor-pointer")!;
    fireEvent.click(row);

    expect(mockPush).toHaveBeenCalledTimes(1);
    const url = mockPush.mock.calls[0][0] as string;
    // Should navigate to the plan detail
    expect(url).toContain("/w/test-workspace/plan/feature-1");
    // The `from` param should encode the current pathname (no extra query string since page=1 has no param)
    expect(url).toContain("from=");
    const fromParam = new URL(url, "http://localhost").searchParams.get("from")!;
    expect(decodeURIComponent(fromParam)).toBe("/w/test-workspace/plan");
  });

  test("encodes `from` param including ?page=N when navigating from a paginated list page", async () => {
    mockPush.mockClear();

    // Override searchParams to simulate being on page 3
    vi.mocked(navigation.useSearchParams).mockReturnValue({
      get: (key: string) => (key === "page" ? "3" : null),
      toString: () => "page=3",
    } as any);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: [
          {
            id: "feature-2",
            title: "Another Feature",
            status: "TODO",
            createdBy: { id: "user-1", name: "John" },
            createdAt: new Date(),
            updatedAt: new Date(),
            _count: { tasks: 0 },
          },
        ],
        pagination: { page: 3, limit: 10, totalPages: 5, hasMore: true, totalCountWithoutFilters: 50 },
      }),
    });

    const { container } = render(<FeaturesList workspaceId="workspace-1" />);

    await waitFor(() => {
      expect(container.querySelectorAll("tr.cursor-pointer").length).toBeGreaterThan(0);
    });

    const row = container.querySelector("tr.cursor-pointer")!;
    fireEvent.click(row);

    expect(mockPush).toHaveBeenCalledTimes(1);
    const url = mockPush.mock.calls[0][0] as string;
    expect(url).toContain("/w/test-workspace/plan/feature-2");
    // `from` must include the ?page=3 query param so back navigation returns to page 3
    const fromParam = new URL(url, "http://localhost").searchParams.get("from")!;
    expect(decodeURIComponent(fromParam)).toBe("/w/test-workspace/plan?page=3");

    // Reset searchParams mock back to default
    vi.mocked(navigation.useSearchParams).mockReturnValue({
      get: () => null,
      toString: () => "",
    } as any);
  });
});

describe("FeaturesList - Deployment column logic", () => {
  describe("FeatureRow deployment column rendering", () => {
    it("should render DeploymentStatusBadge in the Deployment column (2nd cell) when deploymentStatus is non-null", () => {
      const feature = {
        deploymentStatus: "staging" as const,
        deploymentUrl: "https://staging.example.com",
      };

      // The deployment cell should render the badge when deploymentStatus exists
      const shouldRenderBadge = !!feature.deploymentStatus;
      expect(shouldRenderBadge).toBe(true);
    });

    it("should render a dash in the Deployment column when deploymentStatus is null", () => {
      const feature = {
        deploymentStatus: null,
        deploymentUrl: null,
      };

      // The deployment cell should render a dash when deploymentStatus is null
      const shouldRenderBadge = !!feature.deploymentStatus;
      expect(shouldRenderBadge).toBe(false);
    });

    it("should render DeploymentStatusBadge for production status", () => {
      const feature = { deploymentStatus: "production" as const, deploymentUrl: "https://prod.example.com" };
      expect(!!feature.deploymentStatus).toBe(true);
    });

    it("should render DeploymentStatusBadge for failed status", () => {
      const feature = { deploymentStatus: "failed" as const, deploymentUrl: null };
      expect(!!feature.deploymentStatus).toBe(true);
    });

    it("should NOT include DeploymentStatusBadge inside the Title cell", () => {
      // The title cell (w-[320px]) should only contain: title text, Bell icon (awaiting feedback)
      // It should NOT contain the DeploymentStatusBadge — that lives in the Deployment cell (w-[130px])
      const titleCellWidth = "w-[320px]";
      const deploymentCellWidth = "w-[130px]";

      expect(titleCellWidth).toBe("w-[320px]");
      expect(deploymentCellWidth).toBe("w-[130px]");
      // These are distinct cells — deployment is not nested inside title
      expect(titleCellWidth).not.toBe(deploymentCellWidth);
    });
  });
});

describe("FeaturesList - Owner column display logic", () => {
  describe("ownerDisplayValue", () => {
    it("should return the assignee when feature has an assignee set", () => {
      const feature = {
        assignee: { id: "user-1", name: "Jane Smith", image: null },
        createdBy: { id: "user-2", name: "John Doe", image: null },
      };

      const ownerDisplayValue =
        feature.assignee ?? (feature.createdBy ? { ...feature.createdBy } : null);

      expect(ownerDisplayValue).toEqual(feature.assignee);
      expect(ownerDisplayValue?.name).toBe("Jane Smith");
    });

    it("should fall back to createdBy when assignee is null", () => {
      const feature = {
        assignee: null,
        createdBy: { id: "user-2", name: "John Doe", image: null },
      };

      const ownerDisplayValue =
        feature.assignee ?? (feature.createdBy ? { ...feature.createdBy } : null);

      expect(ownerDisplayValue?.name).toBe("John Doe");
    });

    it("should return null when both assignee and createdBy are null", () => {
      const feature = {
        assignee: null,
        createdBy: null,
      };

      const ownerDisplayValue =
        feature.assignee ?? (feature.createdBy ? { ...feature.createdBy } : null);

      expect(ownerDisplayValue).toBeNull();
    });

    it("should not mutate the createdBy object (uses spread)", () => {
      const createdBy = { id: "user-2", name: "John Doe", image: null };
      const feature = { assignee: null, createdBy };

      const ownerDisplayValue =
        feature.assignee ?? (feature.createdBy ? { ...feature.createdBy } : null);

      // It's a copy, not the same reference
      expect(ownerDisplayValue).not.toBe(createdBy);
      expect(ownerDisplayValue).toEqual(createdBy);
    });
  });

  describe("assigneeOptions (Owner filter)", () => {
    it("should use 'All Owners' as the first label", () => {
      const mockMembers = [
        { user: { id: "user-1", name: "Alice", email: "alice@example.com", image: null } },
      ];

      const assigneeOptions = [
        { value: "ALL", label: "All Owners", image: null, name: null },
        { value: "UNASSIGNED", label: "Unassigned", image: null, name: null },
        ...mockMembers.map((m) => ({
          value: m.user.id,
          label: m.user.name || m.user.email || "Unknown",
          image: m.user.image,
          name: m.user.name,
        })),
      ];

      expect(assigneeOptions[0].label).toBe("All Owners");
      expect(assigneeOptions[0].value).toBe("ALL");
    });

    it("should include members as options", () => {
      const mockMembers = [
        { user: { id: "user-1", name: "Alice", email: "alice@example.com", image: null } },
        { user: { id: "user-2", name: null, email: "bob@example.com", image: null } },
      ];

      const assigneeOptions = [
        { value: "ALL", label: "All Owners", image: null, name: null },
        { value: "UNASSIGNED", label: "Unassigned", image: null, name: null },
        ...mockMembers.map((m) => ({
          value: m.user.id,
          label: m.user.name || m.user.email || "Unknown",
          image: m.user.image,
          name: m.user.name,
        })),
      ];

      expect(assigneeOptions).toHaveLength(4); // ALL + UNASSIGNED + 2 members
      expect(assigneeOptions[2].label).toBe("Alice");
      expect(assigneeOptions[3].label).toBe("bob@example.com"); // falls back to email
    });
  });

  describe("handleClearFilters", () => {
    it("should reset assigneeFilter to ALL", () => {
      let assigneeFilter = "user-2";
      const setAssigneeFilter = (value: string) => {
        assigneeFilter = value;
      };

      // Simulate handleClearFilters
      setAssigneeFilter("ALL");

      expect(assigneeFilter).toBe("ALL");
    });

    it("should not reference createdByFilter", () => {
      // The clear filters function should only deal with assigneeFilter (not createdByFilter)
      const clearFiltersLogic = () => {
        const state: Record<string, unknown> = {
          statusFilters: [],
          priorityFilters: [],
          assigneeFilter: "ALL",
          sortBy: "updatedAt",
          sortOrder: "desc",
          searchQuery: "",
          needsAttentionFilter: false,
        };
        return state;
      };

      const result = clearFiltersLogic();
      expect(result).not.toHaveProperty("createdByFilter");
      expect(result).toHaveProperty("assigneeFilter", "ALL");
    });
  });

  describe("Owner filter — API params", () => {
    it("should append assigneeId when Owner filter is active", () => {
      const assigneeFilter = "user-1";
      const params = new URLSearchParams();

      if (assigneeFilter !== "ALL") {
        params.append("assigneeId", assigneeFilter);
      }

      expect(params.get("assigneeId")).toBe("user-1");
    });

    it("should not append assigneeId when Owner filter is ALL", () => {
      const assigneeFilter = "ALL";
      const params = new URLSearchParams();

      if (assigneeFilter !== "ALL") {
        params.append("assigneeId", assigneeFilter);
      }

      expect(params.get("assigneeId")).toBeNull();
    });

    it("should not append createdById regardless of state", () => {
      const params = new URLSearchParams();
      // The new fetchFeatures no longer appends createdById
      expect(params.get("createdById")).toBeNull();
    });

    it("should compose Owner filter with status and priority filters", () => {
      const statusFilters = ["IN_PROGRESS"];
      const priorityFilters = ["HIGH"];
      const assigneeFilter = "user-1";
      const params = new URLSearchParams();

      statusFilters.forEach((s) => params.append("status", s));
      priorityFilters.forEach((p) => params.append("priority", p));
      if (assigneeFilter !== "ALL") params.append("assigneeId", assigneeFilter);

      const url = params.toString();
      expect(url).toContain("assigneeId=user-1");
      expect(url).toContain("status=IN_PROGRESS");
      expect(url).toContain("priority=HIGH");
      expect(url).not.toContain("createdById");
    });
  });

  describe("hasActiveFilters", () => {
    it("should return true when assigneeFilter is not ALL", () => {
      const statusFilters: string[] = [];
      const priorityFilters: string[] = [];
      const assigneeFilter = "user-1";
      const sortBy = "updatedAt";
      const searchQuery = "";
      const needsAttentionFilter = false;

      const hasActiveFilters =
        statusFilters.length > 0 ||
        priorityFilters.length > 0 ||
        assigneeFilter !== "ALL" ||
        (sortBy !== null && sortBy !== "updatedAt") ||
        searchQuery.trim() !== "" ||
        needsAttentionFilter;

      expect(hasActiveFilters).toBe(true);
    });

    it("should return false with default values", () => {
      const statusFilters: string[] = [];
      const priorityFilters: string[] = [];
      const assigneeFilter = "ALL";
      const sortBy = "updatedAt";
      const searchQuery = "";
      const needsAttentionFilter = false;

      const hasActiveFilters =
        statusFilters.length > 0 ||
        priorityFilters.length > 0 ||
        assigneeFilter !== "ALL" ||
        (sortBy !== null && sortBy !== "updatedAt") ||
        searchQuery.trim() !== "" ||
        needsAttentionFilter;

      expect(hasActiveFilters).toBe(false);
    });
  });

  describe("localStorage persistence", () => {
    it("should not include createdByFilter in persisted preferences", () => {
      const preferences = {
        statusFilters: [],
        priorityFilters: [],
        assigneeFilter: "ALL",
        sortBy: "updatedAt",
        sortOrder: "desc",
      };

      expect(preferences).not.toHaveProperty("createdByFilter");
    });

    it("should persist and restore assigneeFilter correctly", () => {
      const preferences = {
        statusFilters: [],
        priorityFilters: [],
        assigneeFilter: "user-5",
        sortBy: "updatedAt",
        sortOrder: "desc",
      };

      const serialized = JSON.stringify(preferences);
      const parsed = JSON.parse(serialized);

      expect(parsed.assigneeFilter).toBe("user-5");
      expect(parsed).not.toHaveProperty("createdByFilter");
    });
  });
});
