// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

const mockUseOrgView = vi.fn();

vi.mock("next/navigation", () => ({
  usePathname: () => "/org/acme",
}));

vi.mock("@/app/org/[githubLogin]/_components/useOrgView", async () => {
  const actual = await vi.importActual<typeof import("@/app/org/[githubLogin]/_components/useOrgView")>(
    "@/app/org/[githubLogin]/_components/useOrgView",
  );
  return {
    ...actual,
    useOrgView: () => mockUseOrgView(),
  };
});

vi.mock("@/app/org/[githubLogin]/_components/OrgRail", () => ({
  OrgRail: ({ activeView }: { activeView: string }) => (
    <nav aria-label="Org navigation" data-testid="org-rail" data-view={activeView} />
  ),
}));

import { OrgShell } from "@/app/org/[githubLogin]/_components/OrgShell";

const USER = { name: "Ada", email: "ada@example.com", avatar: "" };

function renderShell() {
  return render(
    <OrgShell githubLogin="acme" orgId="org-1" orgName="Acme" avatarUrl={null} user={USER}>
      <div>child</div>
    </OrgShell>,
  );
}

describe("OrgShell", () => {
  beforeEach(() => {
    mockUseOrgView.mockReset();
  });

  it("hides the rail below md on the canvas view", () => {
    mockUseOrgView.mockReturnValue("canvas");
    const { container } = renderShell();
    const rail = container.querySelector('[data-testid="org-rail"]');
    expect(rail).toBeTruthy();
    const wrapper = rail?.parentElement;
    expect(wrapper?.className).toContain("hidden");
    expect(wrapper?.className).toContain("md:flex");
  });

  it("does not hide the rail on non-canvas views", () => {
    mockUseOrgView.mockReturnValue("initiatives");
    const { container } = renderShell();
    const rail = container.querySelector('[data-testid="org-rail"]');
    expect(rail).toBeTruthy();
    expect(rail?.parentElement?.className.split(/\s+/)).not.toContain("hidden");
  });
});
