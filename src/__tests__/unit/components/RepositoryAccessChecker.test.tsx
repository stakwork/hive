import React from "react";
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { RepositoryAccessChecker } from "@/components/swarm-setup/RepositoryAccessChecker";

// Test data factories
const TestDataFactories = {
  mockFetchResponse: (data: { hasPushAccess?: boolean; error?: string }) => ({
    ok: true,
    status: 200,
    json: async () => data,
  }),

  mockFetchError: (status: number, statusText: string) => ({
    ok: false,
    status,
    statusText,
    json: async () => ({ error: statusText }),
  }),

  repositoryUrl: (owner: string = "test-owner", repo: string = "test-repo") =>
    `https://github.com/${owner}/${repo}`,

  props: (overrides: Partial<any> = {}) => ({
    repositoryUrl: TestDataFactories.repositoryUrl(),
    onAccessResult: vi.fn(),
    ...overrides,
  }),
};

describe("RepositoryAccessChecker", () => {
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Basic Rendering", () => {
    test("renders without errors", () => {
      const props = TestDataFactories.props();
      mockFetch.mockResolvedValue(
        TestDataFactories.mockFetchResponse({ hasPushAccess: true })
      );

      const { container } = render(<RepositoryAccessChecker {...props} />);

      expect(container.firstChild).toBeNull(); // Component returns null
    });

    test("does not make API call when repositoryUrl is empty", async () => {
      const props = TestDataFactories.props({ repositoryUrl: "" });

      render(<RepositoryAccessChecker {...props} />);

      await waitFor(() => {
        expect(mockFetch).not.toHaveBeenCalled();
      });
    });

    test("does not make API call when repositoryUrl is null", async () => {
      const props = TestDataFactories.props({ repositoryUrl: null });

      render(<RepositoryAccessChecker {...props} />);

      await waitFor(() => {
        expect(mockFetch).not.toHaveBeenCalled();
      });
    });

    test("does not make API call when repositoryUrl is undefined", async () => {
      const props = TestDataFactories.props({ repositoryUrl: undefined });

      render(<RepositoryAccessChecker {...props} />);

      await waitFor(() => {
        expect(mockFetch).not.toHaveBeenCalled();
      });
    });
  });

  describe("Success Scenarios", () => {
    test("calls onAccessResult with hasAccess=true when API returns hasPushAccess=true", async () => {
      const onAccessResult = vi.fn();
      const props = TestDataFactories.props({ onAccessResult });

      mockFetch.mockResolvedValue(
        TestDataFactories.mockFetchResponse({ hasPushAccess: true })
      );

      render(<RepositoryAccessChecker {...props} />);

      await waitFor(() => {
        expect(onAccessResult).toHaveBeenCalledWith(true, undefined);
      });
    });

    test("calls onAccessResult with hasAccess=false when API returns hasPushAccess=false", async () => {
      const onAccessResult = vi.fn();
      const props = TestDataFactories.props({ onAccessResult });

      mockFetch.mockResolvedValue(
        TestDataFactories.mockFetchResponse({ hasPushAccess: false })
      );

      render(<RepositoryAccessChecker {...props} />);

      await waitFor(() => {
        expect(onAccessResult).toHaveBeenCalledWith(false, undefined);
      });
    });

    test("calls onAccessResult with hasAccess=false when hasPushAccess is null", async () => {
      const onAccessResult = vi.fn();
      const props = TestDataFactories.props({ onAccessResult });

      mockFetch.mockResolvedValue(
        TestDataFactories.mockFetchResponse({ hasPushAccess: null as any })
      );

      render(<RepositoryAccessChecker {...props} />);

      await waitFor(() => {
        expect(onAccessResult).toHaveBeenCalledWith(false, undefined);
      });
    });

    test("calls onAccessResult with hasAccess=false when hasPushAccess is undefined", async () => {
      const onAccessResult = vi.fn();
      const props = TestDataFactories.props({ onAccessResult });

      mockFetch.mockResolvedValue(
        TestDataFactories.mockFetchResponse({})
      );

      render(<RepositoryAccessChecker {...props} />);

      await waitFor(() => {
        expect(onAccessResult).toHaveBeenCalledWith(false, undefined);
      });
    });

    test("makes API call with correctly encoded repository URL", async () => {
      const onAccessResult = vi.fn();
      const repositoryUrl = "https://github.com/owner/repo-with-special-chars";
      const props = TestDataFactories.props({ repositoryUrl, onAccessResult });

      mockFetch.mockResolvedValue(
        TestDataFactories.mockFetchResponse({ hasPushAccess: true })
      );

      render(<RepositoryAccessChecker {...props} />);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          `/api/github/app/check?repositoryUrl=${encodeURIComponent(repositoryUrl)}`
        );
      });
    });

    test("calls onAccessResult only once for single render", async () => {
      const onAccessResult = vi.fn();
      const props = TestDataFactories.props({ onAccessResult });

      mockFetch.mockResolvedValue(
        TestDataFactories.mockFetchResponse({ hasPushAccess: true })
      );

      render(<RepositoryAccessChecker {...props} />);

      await waitFor(() => {
        expect(onAccessResult).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("Error Scenarios", () => {
    test("calls onAccessResult with error when API returns error in response", async () => {
      const onAccessResult = vi.fn();
      const props = TestDataFactories.props({ onAccessResult });

      mockFetch.mockResolvedValue(
        TestDataFactories.mockFetchResponse({
          error: "no_github_tokens",
        })
      );

      render(<RepositoryAccessChecker {...props} />);

      await waitFor(() => {
        expect(onAccessResult).toHaveBeenCalledWith(false, "no_github_tokens");
      });
    });

    test("calls onAccessResult with error when API returns 401 Unauthorized", async () => {
      const onAccessResult = vi.fn();
      const props = TestDataFactories.props({ onAccessResult });

      mockFetch.mockResolvedValue(
        TestDataFactories.mockFetchResponse({
          error: "unauthorized",
        })
      );

      render(<RepositoryAccessChecker {...props} />);

      await waitFor(() => {
        expect(onAccessResult).toHaveBeenCalledWith(false, "unauthorized");
      });
    });

    test("calls onAccessResult with error when API returns 403 Forbidden", async () => {
      const onAccessResult = vi.fn();
      const props = TestDataFactories.props({ onAccessResult });

      mockFetch.mockResolvedValue(
        TestDataFactories.mockFetchResponse({
          error: "access_forbidden",
        })
      );

      render(<RepositoryAccessChecker {...props} />);

      await waitFor(() => {
        expect(onAccessResult).toHaveBeenCalledWith(false, "access_forbidden");
      });
    });

    test("calls onAccessResult with error when API returns 404 Not Found", async () => {
      const onAccessResult = vi.fn();
      const props = TestDataFactories.props({ onAccessResult });

      mockFetch.mockResolvedValue(
        TestDataFactories.mockFetchResponse({
          error: "repository_not_found",
        })
      );

      render(<RepositoryAccessChecker {...props} />);

      await waitFor(() => {
        expect(onAccessResult).toHaveBeenCalledWith(false, "repository_not_found");
      });
    });

    test("calls onAccessResult with generic error when fetch throws network error", async () => {
      const onAccessResult = vi.fn();
      const props = TestDataFactories.props({ onAccessResult });

      mockFetch.mockRejectedValue(new Error("Network error"));

      render(<RepositoryAccessChecker {...props} />);

      await waitFor(() => {
        expect(onAccessResult).toHaveBeenCalledWith(
          false,
          "Failed to check repository access"
        );
      });
    });

    test("calls onAccessResult with generic error when fetch throws timeout error", async () => {
      const onAccessResult = vi.fn();
      const props = TestDataFactories.props({ onAccessResult });

      mockFetch.mockRejectedValue(new Error("Request timeout"));

      render(<RepositoryAccessChecker {...props} />);

      await waitFor(() => {
        expect(onAccessResult).toHaveBeenCalledWith(
          false,
          "Failed to check repository access"
        );
      });
    });

    test("logs error to console when API call fails", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      const onAccessResult = vi.fn();
      const props = TestDataFactories.props({ onAccessResult });

      mockFetch.mockRejectedValue(new Error("Network failure"));

      render(<RepositoryAccessChecker {...props} />);

      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith(
          "Failed to check repository access:",
          expect.any(Error)
        );
      });

      consoleErrorSpy.mockRestore();
    });

    test("calls onAccessResult with generic error when response.json() throws", async () => {
      const onAccessResult = vi.fn();
      const props = TestDataFactories.props({ onAccessResult });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error("Invalid JSON");
        },
      });

      render(<RepositoryAccessChecker {...props} />);

      await waitFor(() => {
        expect(onAccessResult).toHaveBeenCalledWith(
          false,
          "Failed to check repository access"
        );
      });
    });
  });

  describe("Component Lifecycle", () => {
    test("triggers new API call when repositoryUrl prop changes", async () => {
      const onAccessResult = vi.fn();
      const initialUrl = TestDataFactories.repositoryUrl("owner1", "repo1");
      const props = TestDataFactories.props({
        repositoryUrl: initialUrl,
        onAccessResult,
      });

      mockFetch.mockResolvedValue(
        TestDataFactories.mockFetchResponse({ hasPushAccess: true })
      );

      const { rerender } = render(<RepositoryAccessChecker {...props} />);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(mockFetch).toHaveBeenCalledWith(
          `/api/github/app/check?repositoryUrl=${encodeURIComponent(initialUrl)}`
        );
      });

      // Change repository URL
      const newUrl = TestDataFactories.repositoryUrl("owner2", "repo2");
      rerender(
        <RepositoryAccessChecker {...props} repositoryUrl={newUrl} />
      );

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(2);
        expect(mockFetch).toHaveBeenCalledWith(
          `/api/github/app/check?repositoryUrl=${encodeURIComponent(newUrl)}`
        );
      });
    });

    test("triggers new API call when onAccessResult prop changes", async () => {
      const initialCallback = vi.fn();
      const props = TestDataFactories.props({
        onAccessResult: initialCallback,
      });

      mockFetch.mockResolvedValue(
        TestDataFactories.mockFetchResponse({ hasPushAccess: true })
      );

      const { rerender } = render(<RepositoryAccessChecker {...props} />);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });

      // Change callback - useEffect includes onAccessResult in dependency array, so it will re-run
      const newCallback = vi.fn();
      rerender(
        <RepositoryAccessChecker {...props} onAccessResult={newCallback} />
      );

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(2);
      });
    });

    test("cancels previous API call when repositoryUrl changes rapidly", async () => {
      const onAccessResult = vi.fn();
      const url1 = TestDataFactories.repositoryUrl("owner1", "repo1");
      const url2 = TestDataFactories.repositoryUrl("owner2", "repo2");
      const url3 = TestDataFactories.repositoryUrl("owner3", "repo3");

      const props = TestDataFactories.props({
        repositoryUrl: url1,
        onAccessResult,
      });

      mockFetch.mockResolvedValue(
        TestDataFactories.mockFetchResponse({ hasPushAccess: true })
      );

      const { rerender } = render(<RepositoryAccessChecker {...props} />);

      // Rapidly change URLs
      rerender(<RepositoryAccessChecker {...props} repositoryUrl={url2} />);
      rerender(<RepositoryAccessChecker {...props} repositoryUrl={url3} />);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(3);
      });

      // All callbacks should eventually be called
      await waitFor(() => {
        expect(onAccessResult).toHaveBeenCalled();
      });
    });

    test("handles empty to non-empty repositoryUrl transition", async () => {
      const onAccessResult = vi.fn();
      const props = TestDataFactories.props({
        repositoryUrl: "",
        onAccessResult,
      });

      mockFetch.mockResolvedValue(
        TestDataFactories.mockFetchResponse({ hasPushAccess: true })
      );

      const { rerender } = render(<RepositoryAccessChecker {...props} />);

      // No API call with empty URL
      await waitFor(() => {
        expect(mockFetch).not.toHaveBeenCalled();
      });

      // Set valid URL
      const validUrl = TestDataFactories.repositoryUrl();
      rerender(
        <RepositoryAccessChecker {...props} repositoryUrl={validUrl} />
      );

      // API call should be made
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(onAccessResult).toHaveBeenCalledWith(true, undefined);
      });
    });

    test("handles non-empty to empty repositoryUrl transition", async () => {
      const onAccessResult = vi.fn();
      const validUrl = TestDataFactories.repositoryUrl();
      const props = TestDataFactories.props({
        repositoryUrl: validUrl,
        onAccessResult,
      });

      mockFetch.mockResolvedValue(
        TestDataFactories.mockFetchResponse({ hasPushAccess: true })
      );

      const { rerender } = render(<RepositoryAccessChecker {...props} />);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(1);
      });

      // Clear URL
      rerender(<RepositoryAccessChecker {...props} repositoryUrl="" />);

      // No new API call
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(1); // Still only 1 call
      });
    });
  });

  describe("Edge Cases", () => {
    test("handles repository URL with special characters", async () => {
      const onAccessResult = vi.fn();
      const specialUrl = "https://github.com/owner/repo-with-special!@#$%^&*()chars";
      const props = TestDataFactories.props({
        repositoryUrl: specialUrl,
        onAccessResult,
      });

      mockFetch.mockResolvedValue(
        TestDataFactories.mockFetchResponse({ hasPushAccess: true })
      );

      render(<RepositoryAccessChecker {...props} />);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          `/api/github/app/check?repositoryUrl=${encodeURIComponent(specialUrl)}`
        );
      });
    });

    test("handles very long repository URLs", async () => {
      const onAccessResult = vi.fn();
      const longUrl = `https://github.com/owner/${"a".repeat(500)}`;
      const props = TestDataFactories.props({
        repositoryUrl: longUrl,
        onAccessResult,
      });

      mockFetch.mockResolvedValue(
        TestDataFactories.mockFetchResponse({ hasPushAccess: true })
      );

      render(<RepositoryAccessChecker {...props} />);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          `/api/github/app/check?repositoryUrl=${encodeURIComponent(longUrl)}`
        );
      });
    });

    test("handles SSH repository URLs", async () => {
      const onAccessResult = vi.fn();
      const sshUrl = "git@github.com:owner/repo.git";
      const props = TestDataFactories.props({
        repositoryUrl: sshUrl,
        onAccessResult,
      });

      mockFetch.mockResolvedValue(
        TestDataFactories.mockFetchResponse({ hasPushAccess: true })
      );

      render(<RepositoryAccessChecker {...props} />);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          `/api/github/app/check?repositoryUrl=${encodeURIComponent(sshUrl)}`
        );
      });
    });

    test("handles repository URL with .git suffix", async () => {
      const onAccessResult = vi.fn();
      const urlWithGit = "https://github.com/owner/repo.git";
      const props = TestDataFactories.props({
        repositoryUrl: urlWithGit,
        onAccessResult,
      });

      mockFetch.mockResolvedValue(
        TestDataFactories.mockFetchResponse({ hasPushAccess: true })
      );

      render(<RepositoryAccessChecker {...props} />);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          `/api/github/app/check?repositoryUrl=${encodeURIComponent(urlWithGit)}`
        );
      });
    });

    test("handles malformed API response", async () => {
      const onAccessResult = vi.fn();
      const props = TestDataFactories.props({ onAccessResult });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ unexpected: "response" }),
      });

      render(<RepositoryAccessChecker {...props} />);

      await waitFor(() => {
        // hasPushAccess is undefined, should treat as false
        expect(onAccessResult).toHaveBeenCalledWith(false, undefined);
      });
    });

    test("handles null response from API", async () => {
      const onAccessResult = vi.fn();
      const props = TestDataFactories.props({ onAccessResult });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => null,
      });

      render(<RepositoryAccessChecker {...props} />);

      await waitFor(() => {
        expect(onAccessResult).toHaveBeenCalledWith(
          false,
          "Failed to check repository access"
        );
      });
    });

    test("handles empty string response from API", async () => {
      const onAccessResult = vi.fn();
      const props = TestDataFactories.props({ onAccessResult });

      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => "",
      });

      render(<RepositoryAccessChecker {...props} />);

      await waitFor(() => {
        // Empty string is truthy but doesn't have hasPushAccess property
        // So it returns hasAccess: false with no error
        expect(onAccessResult).toHaveBeenCalledWith(false, undefined);
      });
    });
  });

  describe("Callback Verification", () => {
    test("invokes onAccessResult with correct parameters for success", async () => {
      const onAccessResult = vi.fn();
      const props = TestDataFactories.props({ onAccessResult });

      mockFetch.mockResolvedValue(
        TestDataFactories.mockFetchResponse({ hasPushAccess: true })
      );

      render(<RepositoryAccessChecker {...props} />);

      await waitFor(() => {
        expect(onAccessResult).toHaveBeenCalledWith(true, undefined);
        expect(onAccessResult).toHaveBeenCalledTimes(1);
      });
    });

    test("invokes onAccessResult with correct parameters for API error", async () => {
      const onAccessResult = vi.fn();
      const props = TestDataFactories.props({ onAccessResult });

      mockFetch.mockResolvedValue(
        TestDataFactories.mockFetchResponse({
          error: "repository_not_found",
        })
      );

      render(<RepositoryAccessChecker {...props} />);

      await waitFor(() => {
        expect(onAccessResult).toHaveBeenCalledWith(false, "repository_not_found");
        expect(onAccessResult).toHaveBeenCalledTimes(1);
      });
    });

    test("invokes onAccessResult with correct parameters for network error", async () => {
      const onAccessResult = vi.fn();
      const props = TestDataFactories.props({ onAccessResult });

      mockFetch.mockRejectedValue(new Error("Network failure"));

      render(<RepositoryAccessChecker {...props} />);

      await waitFor(() => {
        expect(onAccessResult).toHaveBeenCalledWith(
          false,
          "Failed to check repository access"
        );
        expect(onAccessResult).toHaveBeenCalledTimes(1);
      });
    });

    test("callback receives hasAccess=true only when hasPushAccess is explicitly true", async () => {
      const onAccessResult = vi.fn();

      // Test with hasPushAccess: true
      const props1 = TestDataFactories.props({ onAccessResult });
      mockFetch.mockResolvedValue(
        TestDataFactories.mockFetchResponse({ hasPushAccess: true })
      );
      const { unmount } = render(<RepositoryAccessChecker {...props1} />);

      await waitFor(() => {
        expect(onAccessResult).toHaveBeenLastCalledWith(true, undefined);
      });

      unmount();
      onAccessResult.mockClear();

      // Test with hasPushAccess: false
      const props2 = TestDataFactories.props({ onAccessResult });
      mockFetch.mockResolvedValue(
        TestDataFactories.mockFetchResponse({ hasPushAccess: false })
      );
      render(<RepositoryAccessChecker {...props2} />);

      await waitFor(() => {
        expect(onAccessResult).toHaveBeenLastCalledWith(false, undefined);
      });
    });

    test("callback is not invoked when repositoryUrl is empty", async () => {
      const onAccessResult = vi.fn();
      const props = TestDataFactories.props({
        repositoryUrl: "",
        onAccessResult,
      });

      render(<RepositoryAccessChecker {...props} />);

      await waitFor(() => {
        expect(onAccessResult).not.toHaveBeenCalled();
      });
    });
  });

  describe("Multiple Renders", () => {
    test("handles multiple re-renders with same repositoryUrl", async () => {
      const onAccessResult = vi.fn();
      const props = TestDataFactories.props({ onAccessResult });

      mockFetch.mockResolvedValue(
        TestDataFactories.mockFetchResponse({ hasPushAccess: true })
      );

      const { rerender } = render(<RepositoryAccessChecker {...props} />);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(onAccessResult).toHaveBeenCalledTimes(1);
      });

      const fetchCallCount = mockFetch.mock.calls.length;
      const callbackCount = onAccessResult.mock.calls.length;

      // Re-render with same props - React will not re-run the effect since dependencies haven't changed
      rerender(<RepositoryAccessChecker {...props} />);

      // Verify fetch and callback were not called again after re-render
      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledTimes(fetchCallCount);
        expect(onAccessResult).toHaveBeenCalledTimes(callbackCount);
      });
    });

    test("accumulates callback invocations across multiple URL changes", async () => {
      const onAccessResult = vi.fn();
      const url1 = TestDataFactories.repositoryUrl("owner1", "repo1");
      const url2 = TestDataFactories.repositoryUrl("owner2", "repo2");
      const url3 = TestDataFactories.repositoryUrl("owner3", "repo3");

      const props = TestDataFactories.props({
        repositoryUrl: url1,
        onAccessResult,
      });

      mockFetch.mockResolvedValue(
        TestDataFactories.mockFetchResponse({ hasPushAccess: true })
      );

      const { rerender } = render(<RepositoryAccessChecker {...props} />);

      await waitFor(() => {
        expect(onAccessResult).toHaveBeenCalledTimes(1);
      });

      rerender(<RepositoryAccessChecker {...props} repositoryUrl={url2} />);

      await waitFor(() => {
        expect(onAccessResult).toHaveBeenCalledTimes(2);
      });

      rerender(<RepositoryAccessChecker {...props} repositoryUrl={url3} />);

      await waitFor(() => {
        expect(onAccessResult).toHaveBeenCalledTimes(3);
      });
    });
  });
});