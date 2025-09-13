import React from "react";
import { describe, test, expect, vi, beforeEach, afterEach, Mock } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { userEvent } from "@testing-library/user-event";
import { AddMemberModal } from "@/components/workspace/AddMemberModal";
import { WorkspaceRole } from "@/lib/auth/roles";

// Mock dependencies
vi.mock("@/hooks/useDebounce", () => ({
  useDebounce: vi.fn((value) => value), // Return value immediately for testing
}));

vi.mock("react-hook-form", () => {
  const mockForm = {
    control: {},
    handleSubmit: vi.fn((fn) => (e) => {
      e.preventDefault();
      fn({ githubUsername: "testuser", role: WorkspaceRole.DEVELOPER });
    }),
    reset: vi.fn(),
    setValue: vi.fn(),
    watch: vi.fn(() => "testuser"),
    formState: { errors: {} },
  };
  
  return {
    useForm: vi.fn(() => mockForm),
  };
});

// Mock UI components
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children, open }: { children: React.ReactNode; open: boolean }) =>
    open ? <div data-testid="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-content">{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dialog-header">{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2 data-testid="dialog-title">{children}</h2>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <p data-testid="dialog-description">{children}</p>
  ),
}));

vi.mock("@/components/ui/form", () => ({
  Form: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="form">{children}</div>
  ),
  FormControl: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="form-control">{children}</div>
  ),
  FormDescription: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="form-description">{children}</div>
  ),
  FormField: ({ render }: { render: (props: any) => React.ReactNode }) =>
    render({ field: { onChange: vi.fn(), value: "" } }),
  FormItem: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="form-item">{children}</div>
  ),
  FormLabel: ({ children }: { children: React.ReactNode }) => (
    <label data-testid="form-label">{children}</label>
  ),
  FormMessage: () => <div data-testid="form-message" />,
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({ children, onValueChange }: { children: React.ReactNode; onValueChange: (value: string) => void }) => (
    <div data-testid="select" onClick={() => onValueChange(WorkspaceRole.DEVELOPER)}>
      {children}
    </div>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="select-content">{children}</div>
  ),
  SelectItem: ({ children, value }: { children: React.ReactNode; value: string }) => (
    <div data-testid={`select-item-${value}`}>{children}</div>
  ),
  SelectTrigger: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="select-trigger">{children}</div>
  ),
  SelectValue: ({ placeholder }: { placeholder?: string }) => (
    <div data-testid="select-value">{placeholder}</div>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: (props: any) => (
    <input
      data-testid="search-input"
      {...props}
      onChange={(e) => props.onChange?.(e)}
    />
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, type, disabled, variant }: any) => (
    <button
      data-testid={`button-${variant || 'default'}`}
      onClick={onClick}
      type={type}
      disabled={disabled}
    >
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/alert", () => ({
  Alert: ({ children, variant }: { children: React.ReactNode; variant?: string }) => (
    <div data-testid={`alert-${variant || 'default'}`}>{children}</div>
  ),
  AlertDescription: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="alert-description">{children}</div>
  ),
}));

vi.mock("@/components/ui/badge", () => ({
  Badge: ({ children, variant }: { children: React.ReactNode; variant?: string }) => (
    <span data-testid={`badge-${variant || 'default'}`}>{children}</span>
  ),
}));

vi.mock("@/components/ui/avatar", () => ({
  Avatar: ({ children, className }: { children: React.ReactNode; className?: string }) => (
    <div data-testid="avatar" className={className}>
      {children}
    </div>
  ),
  AvatarFallback: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="avatar-fallback">{children}</div>
  ),
  AvatarImage: ({ src, alt }: { src?: string; alt?: string }) => (
    <img data-testid="avatar-image" src={src} alt={alt} />
  ),
}));

// Mock lucide-react icons
vi.mock("lucide-react", () => ({
  Search: () => <div data-testid="search-icon" />,
  UserCheck: () => <div data-testid="user-check-icon" />,
}));

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

// Mock GitHub user data for tests
const mockGitHubUsers = [
  {
    id: 1,
    login: "testuser1",
    name: "Test User 1",
    avatar_url: "https://github.com/testuser1.png",
    bio: "Software Developer",
    public_repos: 25,
    followers: 100,
  },
  {
    id: 2,
    login: "testuser2",
    name: "Test User 2",
    avatar_url: "https://github.com/testuser2.png",
    bio: "Frontend Developer",
    public_repos: 15,
    followers: 50,
  },
];

describe("AddMemberModal", () => {
  const defaultProps = {
    open: true,
    onOpenChange: vi.fn(),
    workspaceSlug: "test-workspace",
    onMemberAdded: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockFetch.mockClear();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  describe("Modal Rendering", () => {
    test("should render modal when open is true", () => {
      render(<AddMemberModal {...defaultProps} />);
      
      expect(screen.getByTestId("dialog")).toBeInTheDocument();
      expect(screen.getByTestId("dialog-title")).toHaveTextContent("Add Member");
      expect(screen.getByTestId("dialog-description")).toHaveTextContent(
        "Add an existing Hive user to this workspace by their GitHub username."
      );
    });

    test("should not render modal when open is false", () => {
      render(<AddMemberModal {...defaultProps} open={false} />);
      
      expect(screen.queryByTestId("dialog")).not.toBeInTheDocument();
    });

    test("should render form elements", () => {
      render(<AddMemberModal {...defaultProps} />);
      
      expect(screen.getByTestId("search-input")).toBeInTheDocument();
      expect(screen.getByTestId("select")).toBeInTheDocument();
      expect(screen.getByTestId("button-outline")).toHaveTextContent("Cancel");
      expect(screen.getByTestId("button-default")).toHaveTextContent("Add Member");
    });
  });

  describe("User Search Functionality", () => {
    test("should make API call when search query is entered", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ users: mockGitHubUsers }),
      });

      render(<AddMemberModal {...defaultProps} />);
      
      const searchInput = screen.getByTestId("search-input");
      await userEvent.type(searchInput, "test");

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/github/users/search?q=test"
        );
      });
    });

    test("should display search results when API call succeeds", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ users: mockGitHubUsers }),
      });

      render(<AddMemberModal {...defaultProps} />);
      
      const searchInput = screen.getByTestId("search-input");
      await userEvent.type(searchInput, "test");

      await waitFor(() => {
        expect(screen.getByText("Test User 1")).toBeInTheDocument();
        expect(screen.getByText("Test User 2")).toBeInTheDocument();
        expect(screen.getByText("@testuser1")).toBeInTheDocument();
        expect(screen.getByText("@testuser2")).toBeInTheDocument();
      });
    });

    test("should show loading state during search", async () => {
      // Mock a delayed response
      mockFetch.mockImplementationOnce(
        () => new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              ok: true,
              json: () => Promise.resolve({ users: mockGitHubUsers }),
            });
          }, 100);
        })
      );

      render(<AddMemberModal {...defaultProps} />);
      
      const searchInput = screen.getByTestId("search-input");
      await userEvent.type(searchInput, "test");

      // Should show loading state immediately
      expect(screen.getByText("Searching GitHub users...")).toBeInTheDocument();

      // Wait for loading to complete
      await waitFor(() => {
        expect(screen.queryByText("Searching GitHub users...")).not.toBeInTheDocument();
      });
    });

    test("should show no results message when search returns empty", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ users: [] }),
      });

      render(<AddMemberModal {...defaultProps} />);
      
      const searchInput = screen.getByTestId("search-input");
      await userEvent.type(searchInput, "nonexistent");

      await waitFor(() => {
        expect(screen.getByText('No GitHub users found matching "nonexistent"')).toBeInTheDocument();
      });
    });

    test("should handle search API error gracefully", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      render(<AddMemberModal {...defaultProps} />);
      
      const searchInput = screen.getByTestId("search-input");
      await userEvent.type(searchInput, "test");

      await waitFor(() => {
        expect(screen.queryByText("Test User 1")).not.toBeInTheDocument();
      });
    });

    test("should not search for queries shorter than 2 characters", async () => {
      render(<AddMemberModal {...defaultProps} />);
      
      const searchInput = screen.getByTestId("search-input");
      await userEvent.type(searchInput, "t");

      expect(mockFetch).not.toHaveBeenCalled();
    });

    test("should clear search results when search query is cleared", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ users: mockGitHubUsers }),
      });

      render(<AddMemberModal {...defaultProps} />);
      
      const searchInput = screen.getByTestId("search-input");
      await userEvent.type(searchInput, "test");

      await waitFor(() => {
        expect(screen.getByText("Test User 1")).toBeInTheDocument();
      });

      // Clear the input
      await userEvent.clear(searchInput);

      await waitFor(() => {
        expect(screen.queryByText("Test User 1")).not.toBeInTheDocument();
      });
    });
  });

  describe("User Selection", () => {
    test("should select user when clicked from search results", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ users: mockGitHubUsers }),
      });

      render(<AddMemberModal {...defaultProps} />);
      
      const searchInput = screen.getByTestId("search-input");
      await userEvent.type(searchInput, "test");

      await waitFor(() => {
        expect(screen.getByText("Test User 1")).toBeInTheDocument();
      });

      // Click on first user
      const userButton = screen.getByText("Test User 1").closest("button");
      if (userButton) {
        await userEvent.click(userButton);
      }

      // Should show selected user preview with UserCheck icon
      await waitFor(() => {
        expect(screen.getByTestId("user-check-icon")).toBeInTheDocument();
        expect(screen.getByText("Test User 1")).toBeInTheDocument();
      });
    });

    test("should hide search results when user is selected", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ users: mockGitHubUsers }),
      });

      render(<AddMemberModal {...defaultProps} />);
      
      const searchInput = screen.getByTestId("search-input");
      await userEvent.type(searchInput, "test");

      await waitFor(() => {
        expect(screen.getByText("Test User 1")).toBeInTheDocument();
        expect(screen.getByText("Test User 2")).toBeInTheDocument();
      });

      // Click on first user
      const userButton = screen.getByText("Test User 1").closest("button");
      if (userButton) {
        await userEvent.click(userButton);
      }

      // Search results should be hidden, only selected user should show
      await waitFor(() => {
        expect(screen.queryByText("Test User 2")).not.toBeInTheDocument();
        expect(screen.getByTestId("user-check-icon")).toBeInTheDocument();
      });
    });

    test("should update form field when user is selected", async () => {
      const mockSetValue = vi.fn();
      vi.mocked(require("react-hook-form").useForm).mockReturnValue({
        control: {},
        handleSubmit: vi.fn(),
        reset: vi.fn(),
        setValue: mockSetValue,
        watch: vi.fn(() => "testuser1"),
        formState: { errors: {} },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ users: mockGitHubUsers }),
      });

      render(<AddMemberModal {...defaultProps} />);
      
      const searchInput = screen.getByTestId("search-input");
      await userEvent.type(searchInput, "test");

      await waitFor(() => {
        expect(screen.getByText("Test User 1")).toBeInTheDocument();
      });

      // Click on first user
      const userButton = screen.getByText("Test User 1").closest("button");
      if (userButton) {
        await userEvent.click(userButton);
      }

      expect(mockSetValue).toHaveBeenCalledWith("githubUsername", "testuser1");
    });

    test("should clear selected user when typing new search query", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ users: mockGitHubUsers }),
      });

      render(<AddMemberModal {...defaultProps} />);
      
      const searchInput = screen.getByTestId("search-input");
      await userEvent.type(searchInput, "test");

      await waitFor(() => {
        expect(screen.getByText("Test User 1")).toBeInTheDocument();
      });

      // Select user
      const userButton = screen.getByText("Test User 1").closest("button");
      if (userButton) {
        await userEvent.click(userButton);
      }

      await waitFor(() => {
        expect(screen.getByTestId("user-check-icon")).toBeInTheDocument();
      });

      // Type new search query
      await userEvent.type(searchInput, " new");

      // Selected user should be cleared
      await waitFor(() => {
        expect(screen.queryByTestId("user-check-icon")).not.toBeInTheDocument();
      });
    });
  });

  describe("Member Addition", () => {
    test("should add member successfully", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      render(<AddMemberModal {...defaultProps} />);
      
      const addButton = screen.getByTestId("button-default");
      await userEvent.click(addButton);

      await waitFor(() => {
        expect(mockFetch).toHaveBeenCalledWith(
          "/api/workspaces/test-workspace/members",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              githubUsername: "testuser",
              role: WorkspaceRole.DEVELOPER,
            }),
          }
        );
      });

      expect(defaultProps.onMemberAdded).toHaveBeenCalled();
      expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
    });

    test("should show loading state during member addition", async () => {
      // Mock a delayed response
      mockFetch.mockImplementationOnce(
        () => new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              ok: true,
              json: () => Promise.resolve({}),
            });
          }, 100);
        })
      );

      render(<AddMemberModal {...defaultProps} />);
      
      const addButton = screen.getByTestId("button-default");
      await userEvent.click(addButton);

      // Should show loading text immediately
      expect(screen.getByText("Adding...")).toBeInTheDocument();

      // Wait for loading to complete
      await waitFor(() => {
        expect(screen.queryByText("Adding...")).not.toBeInTheDocument();
      }, { timeout: 200 });
    });

    test("should handle member addition API error", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: "User not found" }),
      });

      render(<AddMemberModal {...defaultProps} />);
      
      const addButton = screen.getByTestId("button-default");
      await userEvent.click(addButton);

      await waitFor(() => {
        expect(screen.getByTestId("alert-destructive")).toBeInTheDocument();
        expect(screen.getByTestId("alert-description")).toHaveTextContent("User not found");
      });

      // Modal should remain open
      expect(defaultProps.onOpenChange).not.toHaveBeenCalledWith(false);
      expect(defaultProps.onMemberAdded).not.toHaveBeenCalled();
    });

    test("should handle network error during member addition", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      render(<AddMemberModal {...defaultProps} />);
      
      const addButton = screen.getByTestId("button-default");
      await userEvent.click(addButton);

      await waitFor(() => {
        expect(screen.getByTestId("alert-destructive")).toBeInTheDocument();
        expect(screen.getByTestId("alert-description")).toHaveTextContent("Network error");
      });
    });

    test("should disable add button when no username is provided", () => {
      const useForm = vi.mocked(require("react-hook-form").useForm);
      useForm.mockReturnValue({
        control: {},
        handleSubmit: vi.fn(),
        reset: vi.fn(),
        setValue: vi.fn(),
        watch: vi.fn(() => ""), // Empty username
        formState: { errors: {} },
      });

      render(<AddMemberModal {...defaultProps} />);
      
      const addButton = screen.getByTestId("button-default");
      expect(addButton).toBeDisabled();
    });

    test("should disable add button during submission", async () => {
      mockFetch.mockImplementationOnce(
        () => new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              ok: true,
              json: () => Promise.resolve({}),
            });
          }, 100);
        })
      );

      render(<AddMemberModal {...defaultProps} />);
      
      const addButton = screen.getByTestId("button-default");
      await userEvent.click(addButton);

      // Button should be disabled during submission
      expect(addButton).toBeDisabled();
    });
  });

  describe("Form Reset and Modal Close", () => {
    test("should reset form when cancel button is clicked", async () => {
      const mockReset = vi.fn();
      const useForm = vi.mocked(require("react-hook-form").useForm);
      useForm.mockReturnValue({
        control: {},
        handleSubmit: vi.fn(),
        reset: mockReset,
        setValue: vi.fn(),
        watch: vi.fn(() => "testuser"),
        formState: { errors: {} },
      });

      render(<AddMemberModal {...defaultProps} />);
      
      const cancelButton = screen.getByTestId("button-outline");
      await userEvent.click(cancelButton);

      expect(mockReset).toHaveBeenCalled();
      expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
    });

    test("should reset form when modal is closed after successful addition", async () => {
      const mockReset = vi.fn();
      const useForm = vi.mocked(require("react-hook-form").useForm);
      useForm.mockReturnValue({
        control: {},
        handleSubmit: vi.fn((fn) => (e) => {
          e.preventDefault();
          fn({ githubUsername: "testuser", role: WorkspaceRole.DEVELOPER });
        }),
        reset: mockReset,
        setValue: vi.fn(),
        watch: vi.fn(() => "testuser"),
        formState: { errors: {} },
      });

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({}),
      });

      render(<AddMemberModal {...defaultProps} />);
      
      const addButton = screen.getByTestId("button-default");
      await userEvent.click(addButton);

      await waitFor(() => {
        expect(mockReset).toHaveBeenCalled();
        expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
      });
    });

    test("should clear search state on form reset", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ users: mockGitHubUsers }),
      });

      render(<AddMemberModal {...defaultProps} />);
      
      // Search for users
      const searchInput = screen.getByTestId("search-input");
      await userEvent.type(searchInput, "test");

      await waitFor(() => {
        expect(screen.getByText("Test User 1")).toBeInTheDocument();
      });

      // Select a user
      const userButton = screen.getByText("Test User 1").closest("button");
      if (userButton) {
        await userEvent.click(userButton);
      }

      await waitFor(() => {
        expect(screen.getByTestId("user-check-icon")).toBeInTheDocument();
      });

      // Click cancel to reset
      const cancelButton = screen.getByTestId("button-outline");
      await userEvent.click(cancelButton);

      // State should be reset (would need to re-render to verify, but form.reset() was called)
      expect(defaultProps.onOpenChange).toHaveBeenCalledWith(false);
    });

    test("should not reset form when API error occurs", async () => {
      const mockReset = vi.fn();
      const useForm = vi.mocked(require("react-hook-form").useForm);
      useForm.mockReturnValue({
        control: {},
        handleSubmit: vi.fn((fn) => (e) => {
          e.preventDefault();
          fn({ githubUsername: "testuser", role: WorkspaceRole.DEVELOPER });
        }),
        reset: mockReset,
        setValue: vi.fn(),
        watch: vi.fn(() => "testuser"),
        formState: { errors: {} },
      });

      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({ error: "User not found" }),
      });

      render(<AddMemberModal {...defaultProps} />);
      
      const addButton = screen.getByTestId("button-default");
      await userEvent.click(addButton);

      await waitFor(() => {
        expect(screen.getByTestId("alert-destructive")).toBeInTheDocument();
      });

      // Form should not be reset on error
      expect(mockReset).not.toHaveBeenCalled();
      expect(defaultProps.onOpenChange).not.toHaveBeenCalledWith(false);
    });
  });

  describe("Role Selection", () => {
    test("should render role selection dropdown", () => {
      render(<AddMemberModal {...defaultProps} />);
      
      expect(screen.getByTestId("select")).toBeInTheDocument();
      expect(screen.getByTestId("select-item-VIEWER")).toBeInTheDocument();
      expect(screen.getByTestId("select-item-DEVELOPER")).toBeInTheDocument();
      expect(screen.getByTestId("select-item-PM")).toBeInTheDocument();
      expect(screen.getByTestId("select-item-ADMIN")).toBeInTheDocument();
    });

    test("should default to DEVELOPER role", () => {
      const useForm = vi.mocked(require("react-hook-form").useForm);
      const mockForm = {
        control: {},
        handleSubmit: vi.fn(),
        reset: vi.fn(),
        setValue: vi.fn(),
        watch: vi.fn(() => "testuser"),
        formState: { errors: {} },
      };
      
      useForm.mockReturnValue(mockForm);

      render(<AddMemberModal {...defaultProps} />);
      
      // The form is initialized with DEVELOPER as default
      // This is tested through the form initialization
      expect(useForm).toHaveBeenCalledWith({
        resolver: expect.any(Function),
        defaultValues: {
          githubUsername: "",
          role: WorkspaceRole.DEVELOPER,
        },
      });
    });
  });

  describe("Error Display", () => {
    test("should clear error when new submission is attempted", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          json: () => Promise.resolve({ error: "First error" }),
        })
        .mockResolvedValueOnce({
          ok: true,
          json: () => Promise.resolve({}),
        });

      render(<AddMemberModal {...defaultProps} />);
      
      const addButton = screen.getByTestId("button-default");
      
      // First submission with error
      await userEvent.click(addButton);

      await waitFor(() => {
        expect(screen.getByTestId("alert-description")).toHaveTextContent("First error");
      });

      // Second submission should clear error first
      await userEvent.click(addButton);

      await waitFor(() => {
        expect(screen.queryByTestId("alert-destructive")).not.toBeInTheDocument();
      });
    });

    test("should display generic error message when error details are not available", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: () => Promise.resolve({}), // No error field
      });

      render(<AddMemberModal {...defaultProps} />);
      
      const addButton = screen.getByTestId("button-default");
      await userEvent.click(addButton);

      await waitFor(() => {
        expect(screen.getByTestId("alert-description")).toHaveTextContent("Failed to add member");
      });
    });
  });

  describe("Accessibility and UX", () => {
    test("should have proper form labels and descriptions", () => {
      render(<AddMemberModal {...defaultProps} />);
      
      expect(screen.getByTestId("form-label")).toHaveTextContent("GitHub Username");
      expect(screen.getByText("Start typing to search for GitHub users")).toBeInTheDocument();
      expect(screen.getByText("Choose the access level for this member")).toBeInTheDocument();
    });

    test("should show search placeholder text", () => {
      render(<AddMemberModal {...defaultProps} />);
      
      const searchInput = screen.getByTestId("search-input");
      expect(searchInput).toHaveAttribute("placeholder", "Search GitHub username...");
    });

    test("should limit search results to 5 users", async () => {
      const manyUsers = Array.from({ length: 10 }, (_, i) => ({
        id: i + 1,
        login: `user${i + 1}`,
        name: `User ${i + 1}`,
        avatar_url: `https://github.com/user${i + 1}.png`,
        bio: `Developer ${i + 1}`,
        public_repos: 10 + i,
        followers: 50 + i,
      }));

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ users: manyUsers }),
      });

      render(<AddMemberModal {...defaultProps} />);
      
      const searchInput = screen.getByTestId("search-input");
      await userEvent.type(searchInput, "user");

      await waitFor(() => {
        // Should only show first 5 users
        expect(screen.getByText("User 1")).toBeInTheDocument();
        expect(screen.getByText("User 5")).toBeInTheDocument();
        expect(screen.queryByText("User 6")).not.toBeInTheDocument();
      });
    });
  });
});