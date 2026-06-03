// @vitest-environment jsdom
import React from "react";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { PublicWorkspaceBanner } from "@/components/workspace/PublicWorkspaceBanner";

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(),
}));

vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

import { useSession } from "next-auth/react";
import { useWorkspace } from "@/hooks/useWorkspace";

const mockUseSession = useSession as ReturnType<typeof vi.fn>;
const mockUseWorkspace = useWorkspace as ReturnType<typeof vi.fn>;

const publicViewableWorkspace = { isPublicViewable: true };
const privateWorkspace = { isPublicViewable: false };

describe("PublicWorkspaceBanner", () => {
  it("returns null when status is 'loading'", () => {
    mockUseSession.mockReturnValue({ status: "loading" });
    mockUseWorkspace.mockReturnValue({ loading: false, isPublicViewer: false, workspace: null });

    const { container } = render(<PublicWorkspaceBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("returns null when workspace loading is true", () => {
    mockUseSession.mockReturnValue({ status: "unauthenticated" });
    mockUseWorkspace.mockReturnValue({ loading: true, isPublicViewer: true, workspace: publicViewableWorkspace });

    const { container } = render(<PublicWorkspaceBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("returns null when status is 'authenticated'", () => {
    mockUseSession.mockReturnValue({ status: "authenticated" });
    mockUseWorkspace.mockReturnValue({ loading: false, isPublicViewer: false, workspace: publicViewableWorkspace });

    const { container } = render(<PublicWorkspaceBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("returns null when isPublicViewer is false even if status is unauthenticated", () => {
    mockUseSession.mockReturnValue({ status: "unauthenticated" });
    mockUseWorkspace.mockReturnValue({ loading: false, isPublicViewer: false, workspace: publicViewableWorkspace });

    const { container } = render(<PublicWorkspaceBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("returns null when workspace is not public-viewable (reconnect regression case)", () => {
    // Simulates a transient unauthenticated flip on a non-public workspace —
    // the banner must never appear in this scenario.
    mockUseSession.mockReturnValue({ status: "unauthenticated" });
    mockUseWorkspace.mockReturnValue({ loading: false, isPublicViewer: true, workspace: privateWorkspace });

    const { container } = render(<PublicWorkspaceBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("returns null when workspace is null", () => {
    mockUseSession.mockReturnValue({ status: "unauthenticated" });
    mockUseWorkspace.mockReturnValue({ loading: false, isPublicViewer: false, workspace: null });

    const { container } = render(<PublicWorkspaceBanner />);
    expect(container.firstChild).toBeNull();
  });

  it("renders the banner for a genuine public viewer on a public-viewable workspace", () => {
    mockUseSession.mockReturnValue({ status: "unauthenticated" });
    mockUseWorkspace.mockReturnValue({
      loading: false,
      isPublicViewer: true,
      workspace: publicViewableWorkspace,
    });

    render(<PublicWorkspaceBanner />);
    expect(
      screen.getByText(/You're browsing in view-only mode/i)
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute(
      "href",
      "/auth/signin"
    );
  });
});
