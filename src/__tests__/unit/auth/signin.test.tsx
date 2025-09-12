import { describe, test, expect, vi, beforeEach, Mock } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { useSession, getProviders, signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import SignInPage from "@/app/auth/signin/page";
import type { ClientSafeProvider } from "next-auth/react";

// Mock next-auth/react
vi.mock("next-auth/react", () => ({
  useSession: vi.fn(),
  getProviders: vi.fn(),
  signIn: vi.fn(),
}));

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: vi.fn(),
}));

const mockedUseSession = vi.mocked(useSession);
const mockedGetProviders = vi.mocked(getProviders);
const mockedSignIn = vi.mocked(signIn);
const mockedUseRouter = vi.mocked(useRouter);

describe("SignIn Authentication Logic - Unit Tests", () => {
  const mockPush = vi.fn();
  
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetAllMocks();
    
    mockedUseRouter.mockReturnValue({
      push: mockPush,
      replace: vi.fn(),
      refresh: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      prefetch: vi.fn(),
    });
    
    // Default session state - not authenticated
    mockedUseSession.mockReturnValue({
      data: null,
      status: "unauthenticated",
      update: vi.fn(),
    });
    
    // Default providers - both GitHub and mock available
    mockedGetProviders.mockResolvedValue({
      github: {
        id: "github",
        name: "GitHub",
        type: "oauth",
        signinUrl: "/api/auth/signin/github",
        callbackUrl: "/api/auth/callback/github",
      } as ClientSafeProvider,
      mock: {
        id: "mock",
        name: "Mock Provider",
        type: "credentials",
        signinUrl: "/api/auth/signin/mock",
        callbackUrl: "/api/auth/callback/mock",
      } as ClientSafeProvider,
    });
  });

  describe("Provider Detection and Handling", () => {
    test("should detect and display GitHub provider when available", async () => {
      render(<SignInPage />);
      
      await waitFor(() => {
        expect(screen.getByTestId("github-signin-button")).toBeInTheDocument();
      });
      
      expect(screen.getByText("Continue with GitHub")).toBeInTheDocument();
      expect(mockedGetProviders).toHaveBeenCalled();
    });

    test("should detect and display mock provider when available", async () => {
      render(<SignInPage />);
      
      await waitFor(() => {
        expect(screen.getByTestId("mock-signin-button")).toBeInTheDocument();
      });
      
      expect(screen.getByText("Mock Sign In (Dev)")).toBeInTheDocument();
      expect(screen.getByPlaceholderText("Enter username (defaults to 'dev-user')")).toBeInTheDocument();
    });

    test("should handle missing GitHub provider gracefully", async () => {
      mockedGetProviders.mockResolvedValue({
        mock: {
          id: "mock",
          name: "Mock Provider",
          type: "credentials",
          signinUrl: "/api/auth/signin/mock",
          callbackUrl: "/api/auth/callback/mock",
        } as ClientSafeProvider,
      });
      
      render(<SignInPage />);
      
      await waitFor(() => {
        expect(screen.queryByTestId("github-signin-button")).not.toBeInTheDocument();
      });
      
      expect(screen.getByTestId("mock-signin-button")).toBeInTheDocument();
    });

    test("should handle missing mock provider gracefully", async () => {
      mockedGetProviders.mockResolvedValue({
        github: {
          id: "github",
          name: "GitHub",
          type: "oauth",
          signinUrl: "/api/auth/signin/github",
          callbackUrl: "/api/auth/callback/github",
        } as ClientSafeProvider,
      });
      
      render(<SignInPage />);
      
      await waitFor(() => {
        expect(screen.getByTestId("github-signin-button")).toBeInTheDocument();
      });
      
      expect(screen.queryByTestId("mock-signin-button")).not.toBeInTheDocument();
    });

    test("should handle no providers available", async () => {
      mockedGetProviders.mockResolvedValue(null);
      
      render(<SignInPage />);
      
      await waitFor(() => {
        expect(screen.queryByTestId("github-signin-button")).not.toBeInTheDocument();
        expect(screen.queryByTestId("mock-signin-button")).not.toBeInTheDocument();
      });
    });
  });

  describe("GitHub Authentication Logic", () => {
    test("should handle successful GitHub sign in", async () => {
      mockedSignIn.mockResolvedValue({
        ok: true,
        status: 200,
        error: null,
        url: "http://localhost:3000/",
      });
      
      render(<SignInPage />);
      
      await waitFor(() => {
        expect(screen.getByTestId("github-signin-button")).toBeInTheDocument();
      });
      
      fireEvent.click(screen.getByTestId("github-signin-button"));
      
      expect(mockedSignIn).toHaveBeenCalledWith("github", {
        redirect: false,
        callbackUrl: "/",
      });
      
      // Button should show loading state
      await waitFor(() => {
        expect(screen.getByText("Signing in...")).toBeInTheDocument();
      });
    });

    test("should handle GitHub sign in error", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      
      mockedSignIn.mockResolvedValue({
        ok: false,
        status: 401,
        error: "Authentication failed",
        url: null,
      });
      
      render(<SignInPage />);
      
      await waitFor(() => {
        expect(screen.getByTestId("github-signin-button")).toBeInTheDocument();
      });
      
      fireEvent.click(screen.getByTestId("github-signin-button"));
      
      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith("Sign in error:", "Authentication failed");
      });
      
      // Loading state should be reset
      await waitFor(() => {
        expect(screen.getByText("Continue with GitHub")).toBeInTheDocument();
      });
      
      consoleErrorSpy.mockRestore();
    });

    test("should handle GitHub sign in network error", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      
      mockedSignIn.mockRejectedValue(new Error("Network error"));
      
      render(<SignInPage />);
      
      await waitFor(() => {
        expect(screen.getByTestId("github-signin-button")).toBeInTheDocument();
      });
      
      fireEvent.click(screen.getByTestId("github-signin-button"));
      
      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith("Unexpected sign in error:", expect.any(Error));
      });
      
      consoleErrorSpy.mockRestore();
    });

    test("should disable GitHub button during mock sign in", async () => {
      render(<SignInPage />);
      
      await waitFor(() => {
        expect(screen.getByTestId("mock-signin-button")).toBeInTheDocument();
      });
      
      fireEvent.click(screen.getByTestId("mock-signin-button"));
      
      expect(screen.getByTestId("github-signin-button")).toBeDisabled();
    });
  });

  describe("Mock Authentication Logic", () => {
    test("should handle successful mock sign in with default username", async () => {
      mockedSignIn.mockResolvedValue({
        ok: true,
        status: 200,
        error: null,
        url: "http://localhost:3000/",
      });
      
      render(<SignInPage />);
      
      await waitFor(() => {
        expect(screen.getByTestId("mock-signin-button")).toBeInTheDocument();
      });
      
      fireEvent.click(screen.getByTestId("mock-signin-button"));
      
      expect(mockedSignIn).toHaveBeenCalledWith("mock", {
        username: "dev-user",
        redirect: false,
        callbackUrl: "/",
      });
    });

    test("should handle successful mock sign in with custom username", async () => {
      mockedSignIn.mockResolvedValue({
        ok: true,
        status: 200,
        error: null,
        url: "http://localhost:3000/",
      });
      
      render(<SignInPage />);
      
      await waitFor(() => {
        expect(screen.getByPlaceholderText("Enter username (defaults to 'dev-user')")).toBeInTheDocument();
      });
      
      const usernameInput = screen.getByPlaceholderText("Enter username (defaults to 'dev-user')");
      fireEvent.change(usernameInput, { target: { value: "test-user-123" } });
      
      fireEvent.click(screen.getByTestId("mock-signin-button"));
      
      expect(mockedSignIn).toHaveBeenCalledWith("mock", {
        username: "test-user-123",
        redirect: false,
        callbackUrl: "/",
      });
    });

    test("should handle mock sign in error", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      
      mockedSignIn.mockResolvedValue({
        ok: false,
        status: 401,
        error: "Mock authentication failed",
        url: null,
      });
      
      render(<SignInPage />);
      
      await waitFor(() => {
        expect(screen.getByTestId("mock-signin-button")).toBeInTheDocument();
      });
      
      fireEvent.click(screen.getByTestId("mock-signin-button"));
      
      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith("Mock sign in error:", "Mock authentication failed");
      });
      
      consoleErrorSpy.mockRestore();
    });

    test("should handle mock sign in network error", async () => {
      const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      
      mockedSignIn.mockRejectedValue(new Error("Network timeout"));
      
      render(<SignInPage />);
      
      await waitFor(() => {
        expect(screen.getByTestId("mock-signin-button")).toBeInTheDocument();
      });
      
      fireEvent.click(screen.getByTestId("mock-signin-button"));
      
      await waitFor(() => {
        expect(consoleErrorSpy).toHaveBeenCalledWith("Unexpected mock sign in error:", expect.any(Error));
      });
      
      consoleErrorSpy.mockRestore();
    });

    test("should disable mock button during GitHub sign in", async () => {
      render(<SignInPage />);
      
      await waitFor(() => {
        expect(screen.getByTestId("github-signin-button")).toBeInTheDocument();
      });
      
      fireEvent.click(screen.getByTestId("github-signin-button"));
      
      expect(screen.getByTestId("mock-signin-button")).toBeDisabled();
    });
  });

  describe("Session Management and Redirects", () => {
    test("should redirect to workspace when user has default workspace", async () => {
      mockedUseSession.mockReturnValue({
        data: {
          user: {
            id: "user123",
            name: "Test User",
            email: "test@example.com",
            defaultWorkspaceSlug: "my-workspace",
          },
          expires: "2024-12-31",
        },
        status: "authenticated",
        update: vi.fn(),
      });
      
      render(<SignInPage />);
      
      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith("/w/my-workspace");
      });
    });

    test("should redirect to onboarding when user has no default workspace", async () => {
      const consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
      
      mockedUseSession.mockReturnValue({
        data: {
          user: {
            id: "user123",
            name: "Test User",
            email: "test@example.com",
          },
          expires: "2024-12-31",
        },
        status: "authenticated",
        update: vi.fn(),
      });
      
      render(<SignInPage />);
      
      await waitFor(() => {
        expect(consoleLogSpy).toHaveBeenCalledWith("No default workspace, redirecting to onboarding");
        expect(mockPush).toHaveBeenCalledWith("/onboarding/workspace");
      });
      
      consoleLogSpy.mockRestore();
    });

    test("should show loading state during session loading", () => {
      mockedUseSession.mockReturnValue({
        data: null,
        status: "loading",
        update: vi.fn(),
      });
      
      render(<SignInPage />);
      
      expect(screen.getByText("Loading...")).toBeInTheDocument();
      expect(screen.getByRole("status")).toBeInTheDocument();
    });
  });

  describe("Error Handling and Edge Cases", () => {
    test("should handle provider loading failure", async () => {
      mockedGetProviders.mockRejectedValue(new Error("Failed to load providers"));
      
      render(<SignInPage />);
      
      // Should still render the page without providers
      await waitFor(() => {
        expect(screen.getByText("Welcome to Hive")).toBeInTheDocument();
      });
      
      expect(screen.queryByTestId("github-signin-button")).not.toBeInTheDocument();
      expect(screen.queryByTestId("mock-signin-button")).not.toBeInTheDocument();
    });

    test("should handle simultaneous sign in attempts prevention", async () => {
      mockedSignIn.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 1000)));
      
      render(<SignInPage />);
      
      await waitFor(() => {
        expect(screen.getByTestId("github-signin-button")).toBeInTheDocument();
        expect(screen.getByTestId("mock-signin-button")).toBeInTheDocument();
      });
      
      // Click GitHub sign in
      fireEvent.click(screen.getByTestId("github-signin-button"));
      
      // Both buttons should be disabled
      expect(screen.getByTestId("github-signin-button")).toBeDisabled();
      expect(screen.getByTestId("mock-signin-button")).toBeDisabled();
    });

    test("should handle empty username in mock sign in", async () => {
      mockedSignIn.mockResolvedValue({
        ok: true,
        status: 200,
        error: null,
        url: "http://localhost:3000/",
      });
      
      render(<SignInPage />);
      
      await waitFor(() => {
        expect(screen.getByTestId("mock-signin-button")).toBeInTheDocument();
      });
      
      // Leave username empty and sign in
      fireEvent.click(screen.getByTestId("mock-signin-button"));
      
      expect(mockedSignIn).toHaveBeenCalledWith("mock", {
        username: "dev-user", // Should use default
        redirect: false,
        callbackUrl: "/",
      });
    });

    test("should handle whitespace-only username in mock sign in", async () => {
      mockedSignIn.mockResolvedValue({
        ok: true,
        status: 200,
        error: null,
        url: "http://localhost:3000/",
      });
      
      render(<SignInPage />);
      
      await waitFor(() => {
        expect(screen.getByPlaceholderText("Enter username (defaults to 'dev-user')")).toBeInTheDocument();
      });
      
      const usernameInput = screen.getByPlaceholderText("Enter username (defaults to 'dev-user')");
      fireEvent.change(usernameInput, { target: { value: "   " } });
      
      fireEvent.click(screen.getByTestId("mock-signin-button"));
      
      expect(mockedSignIn).toHaveBeenCalledWith("mock", {
        username: "dev-user", // Should use default for whitespace
        redirect: false,
        callbackUrl: "/",
      });
    });
  });

  describe("UI State Management", () => {
    test("should show correct loading states for GitHub sign in", async () => {
      mockedSignIn.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 1000)));
      
      render(<SignInPage />);
      
      await waitFor(() => {
        expect(screen.getByTestId("github-signin-button")).toBeInTheDocument();
      });
      
      fireEvent.click(screen.getByTestId("github-signin-button"));
      
      expect(screen.getByText("Signing in...")).toBeInTheDocument();
      expect(screen.querySelector('.animate-spin')).toBeInTheDocument();
    });

    test("should show correct loading states for mock sign in", async () => {
      mockedSignIn.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 1000)));
      
      render(<SignInPage />);
      
      await waitFor(() => {
        expect(screen.getByTestId("mock-signin-button")).toBeInTheDocument();
      });
      
      fireEvent.click(screen.getByTestId("mock-signin-button"));
      
      expect(screen.getByText("Signing in...")).toBeInTheDocument();
      expect(screen.querySelector('.animate-spin')).toBeInTheDocument();
    });

    test("should disable username input during mock sign in", async () => {
      mockedSignIn.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 1000)));
      
      render(<SignInPage />);
      
      await waitFor(() => {
        expect(screen.getByPlaceholderText("Enter username (defaults to 'dev-user')")).toBeInTheDocument();
      });
      
      fireEvent.click(screen.getByTestId("mock-signin-button"));
      
      expect(screen.getByPlaceholderText("Enter username (defaults to 'dev-user')")).toBeDisabled();
    });
  });
});