// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, waitFor } from "@testing-library/react";

const mockRouterPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockRouterPush }),
}));

vi.mock("next-auth/react", () => ({
  useSession: vi.fn(() => ({
    data: { user: { name: "Test User", id: "user-1" } },
    status: "authenticated",
    update: vi.fn(),
  })),
}));

vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => <img alt={alt} />,
}));

vi.mock("framer-motion", () => ({
  motion: {
    div: ({ children, ...props }: React.PropsWithChildren<React.HTMLAttributes<HTMLDivElement>>) => (
      <div {...props}>{children}</div>
    ),
  },
}));

// We import the client module and isolate ProvisionStep
// Since ProvisionStep is not exported, we test via GraphMindsetOnboardingClient
// but spy on the fetch calls and assert router behaviour.

const mockFetch = vi.fn();
global.fetch = mockFetch;

// We need to render ProvisionStep directly — extract it via re-export trick.
// Instead, render GraphMindsetOnboardingClient with pre-conditions that reach ProvisionStep.
// The cleanest approach: inline a minimal stub that mirrors ProvisionStep logic.

// Actually since ProvisionStep is not exported from client.tsx, we'll test it indirectly
// by rendering the full GraphMindsetOnboardingClient and driving it to the provision step.
// Sphinx link is auto-skipped when lightningPubkey is set; fork step auto-completes when
// fetch returns a forkUrl; then provision step runs.

import { GraphMindsetOnboardingClient } from "@/app/onboarding/graphmindset/client";
import { useSession } from "next-auth/react";

const mockUseSession = useSession as ReturnType<typeof vi.fn>;

describe("ProvisionStep - payment 404 redirects to /workspaces", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to /workspaces when payment fetch returns 404", async () => {
    // Session has lightningPubkey so sphinx step is skipped immediately
    mockUseSession.mockReturnValue({
      data: { user: { name: "Test", id: "u1", lightningPubkey: "pubkey123" } },
      status: "authenticated",
      update: vi.fn(),
    });

    // Fork config
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ repoUrl: "https://github.com/org/template" }),
    });
    // Fork POST
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ forkUrl: "https://github.com/user/template" }),
    });
    // Payment fetch — 404
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      json: async () => ({ error: "No payment found" }),
    });

    render(<GraphMindsetOnboardingClient />);

    await waitFor(
      () => {
        expect(mockRouterPush).toHaveBeenCalledWith("/workspaces");
      },
      { timeout: 3000 }
    );

    expect(mockRouterPush).not.toHaveBeenCalledWith(
      expect.stringContaining("/w/")
    );
  });

  it("proceeds normally when payment fetch returns 200", async () => {
    mockUseSession.mockReturnValue({
      data: { user: { name: "Test", id: "u1", lightningPubkey: "pubkey123" } },
      status: "authenticated",
      update: vi.fn(),
    });

    // Fork config
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ repoUrl: "https://github.com/org/template" }),
    });
    // Fork POST
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ forkUrl: "https://github.com/user/template" }),
    });
    // Payment fetch — 200
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        payment: { workspaceName: "My Workspace", workspaceSlug: "my-workspace" },
      }),
    });
    // Workspace creation
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ workspace: { slug: "my-workspace", id: "ws-1" } }),
    });

    render(<GraphMindsetOnboardingClient />);

    await waitFor(
      () => {
        expect(mockRouterPush).toHaveBeenCalledWith("/w/my-workspace");
      },
      { timeout: 3000 }
    );

    // Should NOT redirect to /workspaces
    expect(mockRouterPush).not.toHaveBeenCalledWith("/workspaces");
  });
});
