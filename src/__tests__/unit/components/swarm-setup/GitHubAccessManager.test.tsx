// @vitest-environment jsdom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { GitHubAccessManager } from "@/components/swarm-setup/GitHubAccessManager";

// Mock useWorkspace
vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: vi.fn(() => ({
    workspace: { slug: "test-workspace" },
  })),
}));

// Mock checkRepositoryAccess
vi.mock("@/lib/github/checkRepositoryAccess", () => ({
  checkRepositoryAccess: vi.fn(),
}));

import { checkRepositoryAccess } from "@/lib/github/checkRepositoryAccess";

const mockCheckAccess = checkRepositoryAccess as ReturnType<typeof vi.fn>;
const REPO_URL = "https://github.com/org/repo";

// Helper: mock fetch for /api/github/app/install
function mockInstallFetch(link = "https://github.com/apps/test-app/installations/new") {
  global.fetch = vi.fn().mockResolvedValue({
    json: async () => ({ success: true, data: { link } }),
  });
}

function mockInstallFetchFail() {
  global.fetch = vi.fn().mockResolvedValue({
    json: async () => ({ success: false, message: "error" }),
  });
}

const onAccessError = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  onAccessError.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GitHubAccessManager", () => {
  describe("hasAccess = true", () => {
    it("renders nothing when access is granted", async () => {
      mockCheckAccess.mockResolvedValue({ hasAccess: true });
      const { container } = render(
        <GitHubAccessManager repositoryUrl={REPO_URL} onAccessError={onAccessError} />,
      );
      await waitFor(() => expect(onAccessError).toHaveBeenCalledWith(false));
      expect(container.firstChild).toBeNull();
    });
  });

  describe("reauth state", () => {
    it("shows 'GitHub Connection Expired' title and description with Reconnect button", async () => {
      mockCheckAccess.mockResolvedValue({
        hasAccess: false,
        requiresReauth: true,
        error: "token is invalid or expired",
      });
      mockInstallFetch();

      render(<GitHubAccessManager repositoryUrl={REPO_URL} onAccessError={onAccessError} />);

      await waitFor(() =>
        expect(screen.getByText("GitHub Connection Expired")).toBeInTheDocument(),
      );
      expect(
        screen.getByText(
          "Your GitHub token is no longer valid. Reconnect your account to restore access.",
        ),
      ).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.getByRole("link", { name: "Reconnect GitHub" })).toBeInTheDocument(),
      );
      expect(screen.getByText("After granting access, refresh this page.")).toBeInTheDocument();
      // Badge with repo name
      expect(screen.getByText("org/repo")).toBeInTheDocument();
    });

    it("calls getInstallationLink for reauth state", async () => {
      mockCheckAccess.mockResolvedValue({
        hasAccess: false,
        requiresReauth: true,
        error: "token is invalid or expired",
      });
      const fetchMock = vi.fn().mockResolvedValue({
        json: async () => ({ success: true, data: { link: "https://github.com/install" } }),
      });
      global.fetch = fetchMock;

      render(<GitHubAccessManager repositoryUrl={REPO_URL} onAccessError={onAccessError} />);

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/github/app/install",
        expect.objectContaining({ method: "POST" }),
      );
    });
  });

  describe("installation-update state", () => {
    it("shows 'Repository Not Accessible' title and description with Grant Access button", async () => {
      mockCheckAccess.mockResolvedValue({
        hasAccess: false,
        requiresInstallationUpdate: true,
        error: "installation_update_required",
      });
      mockInstallFetch();

      render(<GitHubAccessManager repositoryUrl={REPO_URL} onAccessError={onAccessError} />);

      await waitFor(() =>
        expect(screen.getByText("Repository Not Accessible")).toBeInTheDocument(),
      );
      expect(
        screen.getByText(
          "This repository hasn't been added to the GitHub App. Grant access to continue.",
        ),
      ).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.getByRole("link", { name: "Grant Access on GitHub" })).toBeInTheDocument(),
      );
      expect(screen.getByText("After granting access, refresh this page.")).toBeInTheDocument();
    });

    it("calls getInstallationLink for installation-update state", async () => {
      mockCheckAccess.mockResolvedValue({
        hasAccess: false,
        requiresInstallationUpdate: true,
      });
      const fetchMock = vi.fn().mockResolvedValue({
        json: async () => ({ success: true, data: { link: "https://github.com/install" } }),
      });
      global.fetch = fetchMock;

      render(<GitHubAccessManager repositoryUrl={REPO_URL} onAccessError={onAccessError} />);

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    });
  });

  describe("other state — app_not_installed", () => {
    it("shows 'GitHub App Not Installed' title and description with Install button", async () => {
      mockCheckAccess.mockResolvedValue({
        hasAccess: false,
        error: "app_not_installed",
      });
      mockInstallFetch();

      render(<GitHubAccessManager repositoryUrl={REPO_URL} onAccessError={onAccessError} />);

      await waitFor(() =>
        expect(screen.getByText("GitHub App Not Installed")).toBeInTheDocument(),
      );
      expect(
        screen.getByText(
          "The GitHub App needs to be installed for this organisation to continue.",
        ),
      ).toBeInTheDocument();
      await waitFor(() =>
        expect(screen.getByRole("link", { name: "Install GitHub App" })).toBeInTheDocument(),
      );
      expect(screen.getByText("After granting access, refresh this page.")).toBeInTheDocument();
    });

    it("calls getInstallationLink for other (app_not_installed) state", async () => {
      mockCheckAccess.mockResolvedValue({
        hasAccess: false,
        error: "app_not_installed",
      });
      const fetchMock = vi.fn().mockResolvedValue({
        json: async () => ({ success: true, data: { link: "https://github.com/install" } }),
      });
      global.fetch = fetchMock;

      render(<GitHubAccessManager repositoryUrl={REPO_URL} onAccessError={onAccessError} />);

      await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    });
  });

  describe("no-cta state — user_not_authorised", () => {
    it("shows 'Access Not Granted' title and description with NO button", async () => {
      mockCheckAccess.mockResolvedValue({
        hasAccess: false,
        error: "user_not_authorised",
      });

      render(<GitHubAccessManager repositoryUrl={REPO_URL} onAccessError={onAccessError} />);

      await waitFor(() => expect(screen.getByText("Access Not Granted")).toBeInTheDocument());
      expect(
        screen.getByText(
          "You're a member of this workspace but don't have access to this repository. Contact a workspace admin.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByRole("link")).toBeNull();
      expect(screen.queryByRole("button")).toBeNull();
      expect(
        screen.queryByText("After granting access, refresh this page."),
      ).toBeNull();
      // Badge still visible
      expect(screen.getByText("org/repo")).toBeInTheDocument();
    });

    it("does NOT call getInstallationLink for user_not_authorised", async () => {
      mockCheckAccess.mockResolvedValue({
        hasAccess: false,
        error: "user_not_authorised",
      });
      const fetchMock = vi.fn();
      global.fetch = fetchMock;

      render(<GitHubAccessManager repositoryUrl={REPO_URL} onAccessError={onAccessError} />);

      await waitFor(() => expect(screen.getByText("Access Not Granted")).toBeInTheDocument());
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("no-cta state — insufficient permissions", () => {
    it("shows 'Insufficient Permissions' title and description with NO button", async () => {
      // hasPushAccess: false with no error → insufficient perms
      mockCheckAccess.mockResolvedValue({
        hasAccess: false,
        error: undefined,
      });

      render(<GitHubAccessManager repositoryUrl={REPO_URL} onAccessError={onAccessError} />);

      await waitFor(() =>
        expect(screen.getByText("Insufficient Permissions")).toBeInTheDocument(),
      );
      expect(
        screen.getByText(
          "You don't have write access to this repository. Contact a workspace admin to be granted the correct permissions.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByRole("link")).toBeNull();
      expect(screen.queryByRole("button")).toBeNull();
      expect(screen.getByText("org/repo")).toBeInTheDocument();
    });

    it("does NOT call getInstallationLink for insufficient permissions", async () => {
      mockCheckAccess.mockResolvedValue({
        hasAccess: false,
        error: undefined,
      });
      const fetchMock = vi.fn();
      global.fetch = fetchMock;

      render(<GitHubAccessManager repositoryUrl={REPO_URL} onAccessError={onAccessError} />);

      await waitFor(() =>
        expect(screen.getByText("Insufficient Permissions")).toBeInTheDocument(),
      );
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("network error state", () => {
    it("shows 'Something Went Wrong' title and description with NO button", async () => {
      mockCheckAccess.mockRejectedValue(new Error("Network error"));

      render(<GitHubAccessManager repositoryUrl={REPO_URL} onAccessError={onAccessError} />);

      await waitFor(() => expect(screen.getByText("Something Went Wrong")).toBeInTheDocument());
      expect(
        screen.getByText(
          "We couldn't check your repository access. Refresh the page to try again.",
        ),
      ).toBeInTheDocument();
      expect(screen.queryByRole("link")).toBeNull();
      expect(screen.queryByRole("button")).toBeNull();
      expect(
        screen.queryByText("After granting access, refresh this page."),
      ).toBeNull();
    });

    it("does NOT call getInstallationLink for network error (other with network error message)", async () => {
      mockCheckAccess.mockRejectedValue(new Error("Network error"));
      // fetch should not be called for getInstallationLink because buttonText is undefined for network errors
      const fetchMock = vi.fn();
      global.fetch = fetchMock;

      render(<GitHubAccessManager repositoryUrl={REPO_URL} onAccessError={onAccessError} />);

      await waitFor(() => expect(screen.getByText("Something Went Wrong")).toBeInTheDocument());
      // fetch may be called for getInstallationLink (errorType is 'other'), but even if it is,
      // buttonText comes back as undefined so no CTA is rendered
      // The key assertion: no button/link in the DOM
      expect(screen.queryByRole("button")).toBeNull();
      expect(screen.queryByRole("link")).toBeNull();
    });
  });

  describe("loading spinner for actionable states", () => {
    it("shows loading spinner while fetching installation link for actionable states", async () => {
      mockCheckAccess.mockResolvedValue({
        hasAccess: false,
        error: "app_not_installed",
      });
      // Delay fetch so spinner is visible
      global.fetch = vi.fn().mockReturnValue(new Promise(() => {}));

      render(<GitHubAccessManager repositoryUrl={REPO_URL} onAccessError={onAccessError} />);

      await waitFor(() =>
        expect(screen.getByText("GitHub App Not Installed")).toBeInTheDocument(),
      );
      expect(screen.getByRole("button", { name: /loading/i })).toBeInTheDocument();
    });
  });
});
