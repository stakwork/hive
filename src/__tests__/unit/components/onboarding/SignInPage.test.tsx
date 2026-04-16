// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";

globalThis.React = React;
import { render, screen } from "@testing-library/react";

// ---- mock next-auth ----
const mockUseSession = vi.fn();
const mockSignIn = vi.fn();
vi.mock("next-auth/react", () => ({
  useSession: () => mockUseSession(),
  getProviders: vi.fn().mockResolvedValue({
    github: { id: "github", name: "GitHub", type: "oauth", signinUrl: "/api/auth/signin/github", callbackUrl: "/api/auth/callback/github" },
  }),
  signIn: (...args: unknown[]) => mockSignIn(...args),
}));

// ---- mock next/navigation ----
const mockPush = vi.fn();
const mockSearchParams = { get: vi.fn() };
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => mockSearchParams,
}));

// ---- mock DarkWizardShell so we can assert its usage ----
vi.mock("@/components/onboarding/DarkWizardShell", () => ({
  DarkWizardShell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dark-wizard-shell">{children}</div>
  ),
}));

// ---- mock GraphMindsetCard ----
vi.mock("@/components/onboarding/GraphMindsetCard", () => ({
  GraphMindsetCard: () => <div data-testid="graphmindset-card" />,
}));

// ---- mock next/link ----
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));

// Import after mocks
import SignInPage from "@/app/auth/signin/page";

// Wrap in Suspense for the page's own Suspense boundary
function renderSignIn() {
  return render(
    <React.Suspense fallback={<div>Loading…</div>}>
      <SignInPage />
    </React.Suspense>,
  );
}

beforeEach(() => {
  mockUseSession.mockReturnValue({ data: null, status: "unauthenticated" });
  mockSearchParams.get.mockReturnValue(null);
  mockPush.mockReset();
  mockSignIn.mockReset();
  mockSignIn.mockResolvedValue({ error: null });
});

describe("SignInPage", () => {
  describe("when redirect does NOT include graphmindset or lightning-payment", () => {
    it("does NOT render DarkWizardShell", () => {
      mockSearchParams.get.mockImplementation((key: string) =>
        key === "redirect" ? "/w/my-workspace" : null,
      );
      renderSignIn();
      expect(screen.queryByTestId("dark-wizard-shell")).not.toBeInTheDocument();
    });

    it("does NOT render DarkWizardShell when no redirect", () => {
      mockSearchParams.get.mockReturnValue(null);
      renderSignIn();
      expect(screen.queryByTestId("dark-wizard-shell")).not.toBeInTheDocument();
    });
  });

  describe("when redirect includes /onboarding/graphmindset", () => {
    it("renders DarkWizardShell", () => {
      mockSearchParams.get.mockImplementation((key: string) =>
        key === "redirect" ? "/onboarding/graphmindset" : null,
      );
      renderSignIn();
      expect(screen.getByTestId("dark-wizard-shell")).toBeInTheDocument();
    });

    it("renders DarkWizardShell for graphmindset with query params", () => {
      mockSearchParams.get.mockImplementation((key: string) =>
        key === "redirect" ? "/onboarding/graphmindset?paymentType=fiat" : null,
      );
      renderSignIn();
      expect(screen.getByTestId("dark-wizard-shell")).toBeInTheDocument();
    });
  });

  describe("when redirect includes /onboarding/lightning-payment", () => {
    it("renders DarkWizardShell", () => {
      mockSearchParams.get.mockImplementation((key: string) =>
        key === "redirect" ? "/onboarding/lightning-payment" : null,
      );
      renderSignIn();
      expect(screen.getByTestId("dark-wizard-shell")).toBeInTheDocument();
    });
  });

  describe("loading state", () => {
    it("renders DarkWizardShell loading state when isGraphMindsetFlow and status=loading", () => {
      mockUseSession.mockReturnValue({ data: null, status: "loading" });
      mockSearchParams.get.mockImplementation((key: string) =>
        key === "redirect" ? "/onboarding/graphmindset" : null,
      );
      renderSignIn();
      expect(screen.getByTestId("dark-wizard-shell")).toBeInTheDocument();
    });

    it("does NOT render DarkWizardShell for regular loading state", () => {
      mockUseSession.mockReturnValue({ data: null, status: "loading" });
      mockSearchParams.get.mockReturnValue(null);
      renderSignIn();
      expect(screen.queryByTestId("dark-wizard-shell")).not.toBeInTheDocument();
    });
  });

  describe("reauth=true param", () => {
    const authenticatedSession = {
      data: { user: { name: "Test User", defaultWorkspaceSlug: "my-workspace" } },
      status: "authenticated",
    };

    it("does NOT auto-redirect authenticated user when reauth=true", () => {
      mockUseSession.mockReturnValue(authenticatedSession);
      mockSearchParams.get.mockImplementation((key: string) => {
        if (key === "redirect") return "/onboarding/graphmindset";
        if (key === "reauth") return "true";
        return null;
      });
      renderSignIn();
      expect(mockPush).not.toHaveBeenCalled();
    });

    it("auto-redirects authenticated user when reauth is NOT set", () => {
      mockUseSession.mockReturnValue(authenticatedSession);
      mockSearchParams.get.mockImplementation((key: string) => {
        if (key === "redirect") return "/onboarding/graphmindset";
        return null;
      });
      renderSignIn();
      expect(mockPush).toHaveBeenCalledWith("/onboarding/graphmindset");
    });

    it("auto-redirects to defaultWorkspaceSlug when no redirect and reauth is NOT set", () => {
      mockUseSession.mockReturnValue(authenticatedSession);
      mockSearchParams.get.mockReturnValue(null);
      renderSignIn();
      expect(mockPush).toHaveBeenCalledWith("/w/my-workspace");
    });
  });
});
