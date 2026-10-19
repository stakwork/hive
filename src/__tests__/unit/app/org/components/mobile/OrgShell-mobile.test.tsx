import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { OrgShell } from "@/app/org/[githubLogin]/_components/OrgShell";

const mockUseIsMobile = vi.fn();
let mockPathname = "/org/acme/settings";

vi.mock("@/hooks/useIsMobile", () => ({
  useIsMobile: () => mockUseIsMobile(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => mockPathname,
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/app/org/[githubLogin]/_components/OrgRail", () => ({
  OrgRail: () => <nav className="w-14" aria-label="Org navigation" />,
}));

vi.mock("@/app/org/[githubLogin]/_components/control-panel/useControlPanel", () => ({
  useControlPanel: () => ({
    groups: [],
    totalCount: 0,
    loading: false,
    query: "",
    onQueryChange: vi.fn(),
    cursorId: null,
    activeId: null,
    onOpen: vi.fn(),
    onOpenJob: vi.fn(),
    onOpenPullRequest: vi.fn(),
    remaining: 0,
    onShowMore: vi.fn(),
    archivedItems: [],
    archivedExpanded: false,
    onToggleArchived: vi.fn(),
    onArchive: vi.fn(),
    onRestore: vi.fn(),
    onNewChat: vi.fn(),
  }),
}));

vi.mock("@/components/NavUser", () => ({
  NavUser: () => <button data-testid="user-menu-trigger">user</button>,
}));

const props = {
  githubLogin: "acme",
  orgId: "org-1",
  orgName: "Acme",
  avatarUrl: null,
  user: { name: "Dev", email: "dev@mock.dev", avatar: "" },
};

describe("OrgShell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPathname = "/org/acme/settings";
    global.fetch = vi.fn().mockResolvedValue({ ok: true, json: async () => [] }) as unknown as typeof fetch;
  });

  describe("mobile (<768px)", () => {
    beforeEach(() => mockUseIsMobile.mockReturnValue(true));

    it("renders the top bar and the drawer, and no rail", () => {
      const { container } = render(
        <OrgShell {...props}>
          <div data-testid="page" />
        </OrgShell>,
      );
      expect(screen.getByTestId("mobile-org-topbar")).toBeInTheDocument();
      expect(screen.getByTestId("mobile-menu-button")).toBeInTheDocument();
      expect(screen.getByTestId("mobile-org-drawer")).toBeInTheDocument();
      expect(screen.getByTestId("page")).toBeInTheDocument();
      expect(container.querySelector("nav.w-14")).toBeNull();
    });

    it("keeps the drawer inert until the menu button opens it, then lists the views", () => {
      render(
        <OrgShell {...props}>
          <div />
        </OrgShell>,
      );
      const root = screen.getByTestId("mobile-org-drawer-root");
      expect(root).toHaveAttribute("aria-hidden", "true");

      fireEvent.click(screen.getByTestId("mobile-menu-button"));
      expect(root).toHaveAttribute("aria-hidden", "false");
      for (const label of ["Canvas", "Graph", "Strut", "Gateway", "Advisor"]) {
        expect(screen.getByRole("link", { name: new RegExp(label) })).toBeInTheDocument();
      }
      // Gateway and Advisor open in a new tab; Strut stays in this one.
      expect(screen.getByRole("link", { name: /Gateway/ })).toHaveAttribute("target", "_blank");
      expect(screen.getByRole("link", { name: /Strut/ })).not.toHaveAttribute("target");
      expect(screen.getByTestId("mobile-chat-search")).toBeInTheDocument();
      expect(screen.getByTestId("mobile-drawer-new-chat")).toBeInTheDocument();
    });

    it("closes the drawer on a backdrop tap", () => {
      render(
        <OrgShell {...props}>
          <div />
        </OrgShell>,
      );
      fireEvent.click(screen.getByTestId("mobile-menu-button"));
      fireEvent.click(screen.getByTestId("mobile-org-drawer-backdrop"));
      expect(screen.getByTestId("mobile-org-drawer-root")).toHaveAttribute("aria-hidden", "true");
    });

    it("leaves the top bar to the org page's own views on the org page", () => {
      mockPathname = "/org/acme";
      render(
        <OrgShell {...props}>
          <div data-testid="page" />
        </OrgShell>,
      );
      expect(screen.queryByTestId("mobile-org-topbar")).toBeNull();
      expect(screen.getByTestId("mobile-org-drawer")).toBeInTheDocument();
    });
  });

  describe("desktop (≥768px)", () => {
    beforeEach(() => mockUseIsMobile.mockReturnValue(false));

    it("renders the rail and no mobile chrome", () => {
      const { container } = render(
        <OrgShell {...props}>
          <div data-testid="page" />
        </OrgShell>,
      );
      expect(container.querySelector("nav.w-14")).not.toBeNull();
      expect(screen.getByTestId("page")).toBeInTheDocument();
      expect(screen.queryByTestId("mobile-org-topbar")).toBeNull();
      expect(screen.queryByTestId("mobile-org-drawer")).toBeNull();
      expect(screen.queryByTestId("mobile-menu-button")).toBeNull();
    });
  });
});
