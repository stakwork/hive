import React from "react";
import { describe, test, expect, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { FeaturesList } from "@/components/features/FeaturesList";

// Mock Next.js router
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(() => ({
    push: vi.fn(),
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
  test("renders anchor elements with correct href for feature rows", async () => {
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

    // Wait for the component to render with data
    await waitFor(() => {
      const links = container.querySelectorAll("a[href*='/plan/feature-']");
      expect(links.length).toBeGreaterThan(0);
    });

    const links = container.querySelectorAll("a[href*='/plan/feature-']");
    const firstLink = links[0];
    expect(firstLink).toHaveAttribute("href", "/w/test-workspace/plan/feature-1");
    expect(firstLink).toHaveAttribute("aria-label", "Test Feature");
  });

  test("renders table rows with relative positioning", async () => {
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
      const rows = container.querySelectorAll("tr.relative");
      expect(rows.length).toBeGreaterThan(0);
    });
  });

  test("renders overlay links with absolute positioning", async () => {
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
      const overlayLinks = container.querySelectorAll("a.absolute");
      expect(overlayLinks.length).toBeGreaterThan(0);
    });
  });
});
