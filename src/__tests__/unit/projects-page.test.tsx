import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import ProjectsPage from "@/app/w/[slug]/projects/page";

// Mock next/navigation
const mockPush = vi.fn();
const mockRouter = {
  push: mockPush,
  replace: vi.fn(),
  back: vi.fn(),
  forward: vi.fn(),
  refresh: vi.fn(),
  prefetch: vi.fn(),
};

vi.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
  usePathname: () => "/w/test-workspace/projects",
}));

// Mock useWorkspace
vi.mock("@/hooks/useWorkspace", () => ({
  useWorkspace: () => ({
    slug: "test-workspace",
    workspace: {
      id: "workspace-1",
      name: "Test Workspace",
      slug: "test-workspace",
    },
    role: "ADMIN",
    isLoading: false,
  }),
}));

// Mock UI components
vi.mock("@/components/ui/page-header", () => ({
  PageHeader: ({ title, description, actions }: any) => (
    <div data-testid="page-header">
      <h1>{title}</h1>
      <p>{description}</p>
      {actions}
    </div>
  ),
}));

vi.mock("@/components/ui/button", () => ({
  Button: ({ children, onClick, disabled, ...props }: any) => (
    <button onClick={onClick} disabled={disabled} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@/components/ui/input", () => ({
  Input: ({ onChange, value, ...props }: any) => (
    <input onChange={onChange} value={value} {...props} />
  ),
}));

vi.mock("@/components/ui/card", () => ({
  Card: ({ children, className, ...props }: any) => (
    <div className={className} {...props}>
      {children}
    </div>
  ),
}));

describe("ProjectsPage", () => {
  let localStorageMock: Record<string, string> = {};

  beforeEach(() => {
    vi.clearAllMocks();
    localStorageMock = {};

    // Mock localStorage
    global.localStorage = {
      getItem: vi.fn((key: string) => localStorageMock[key] || null),
      setItem: vi.fn((key: string, value: string) => {
        localStorageMock[key] = value;
      }),
      removeItem: vi.fn((key: string) => {
        delete localStorageMock[key];
      }),
      clear: vi.fn(() => {
        localStorageMock = {};
      }),
      length: 0,
      key: vi.fn(),
    } as Storage;

    // Mock fetch globally
    global.fetch = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should render page with header and project input", () => {
    render(<ProjectsPage />);

    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.getByText("Debug and manage Stakwork projects")).toBeInTheDocument();
    expect(screen.getByText("New Project")).toBeInTheDocument();
    expect(screen.getByLabelText("Enter Project ID")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("e.g., 141652040")).toBeInTheDocument();
  });

  it("should display info card explaining projects", () => {
    render(<ProjectsPage />);

    expect(screen.getByText("What is a Project?")).toBeInTheDocument();
    expect(
      screen.getByText(/Projects in Stakwork represent specific workflows/)
    ).toBeInTheDocument();
  });

  it("should set localStorage and navigate when New Project button is clicked", async () => {
    const user = userEvent.setup();
    render(<ProjectsPage />);

    const newProjectButton = screen.getByText("New Project");
    await user.click(newProjectButton);

    expect(localStorage.setItem).toHaveBeenCalledWith("task_mode", "project_debugger");
    expect(mockPush).toHaveBeenCalledWith("/w/test-workspace/task/new");
  });

  it("should validate project ID and show success state", async () => {
    const user = userEvent.setup();
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          project: {
            id: "123",
            name: "Test Project",
          },
        },
      }),
    });
    global.fetch = mockFetch;

    render(<ProjectsPage />);

    const input = screen.getByPlaceholderText("e.g., 141652040");
    await user.type(input, "123");

    // Wait for debounce and validation
    await waitFor(
      () => {
        expect(mockFetch).toHaveBeenCalledWith("/api/stakwork/projects/123");
      },
      { timeout: 1000 }
    );

    // Check for success indicators
    await waitFor(() => {
      expect(screen.getByText("Test Project")).toBeInTheDocument();
    });
  });

  it("should show invalid state when project not found", async () => {
    const user = userEvent.setup();
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      json: async () => ({
        success: false,
        error: "Project not found",
      }),
    });
    global.fetch = mockFetch;

    render(<ProjectsPage />);

    const input = screen.getByPlaceholderText("e.g., 141652040");
    await user.type(input, "999");

    // Wait for debounce and validation
    await waitFor(
      () => {
        expect(mockFetch).toHaveBeenCalledWith("/api/stakwork/projects/999");
      },
      { timeout: 1000 }
    );

    // Check for error message
    await waitFor(() => {
      expect(screen.getByText("Project not found")).toBeInTheDocument();
    });
  });

  it("should show invalid state on API error", async () => {
    const user = userEvent.setup();
    const mockFetch = vi.fn().mockRejectedValue(new Error("Network error"));
    global.fetch = mockFetch;

    render(<ProjectsPage />);

    const input = screen.getByPlaceholderText("e.g., 141652040");
    await user.type(input, "456");

    // Wait for debounce and validation
    await waitFor(
      () => {
        expect(mockFetch).toHaveBeenCalledWith("/api/stakwork/projects/456");
      },
      { timeout: 1000 }
    );

    // Check for error message
    await waitFor(() => {
      expect(screen.getByText("Project not found")).toBeInTheDocument();
    });
  });

  it("should enable Open button only when project is valid", async () => {
    const user = userEvent.setup();
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          project: {
            id: "123",
            name: "Valid Project",
          },
        },
      }),
    });
    global.fetch = mockFetch;

    render(<ProjectsPage />);

    const openButton = screen.getByText("Open");
    
    // Initially disabled
    expect(openButton).toBeDisabled();

    // Type project ID
    const input = screen.getByPlaceholderText("e.g., 141652040");
    await user.type(input, "123");

    // Wait for validation
    await waitFor(
      () => {
        expect(mockFetch).toHaveBeenCalled();
      },
      { timeout: 1000 }
    );

    // Button should be enabled after validation
    await waitFor(() => {
      expect(openButton).not.toBeDisabled();
    });
  });

  it("should set localStorage and navigate when Open button is clicked with valid project", async () => {
    const user = userEvent.setup();
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          project: {
            id: "123",
            name: "Test Project",
          },
        },
      }),
    });
    global.fetch = mockFetch;

    render(<ProjectsPage />);

    // Type project ID
    const input = screen.getByPlaceholderText("e.g., 141652040");
    await user.type(input, "123");

    // Wait for validation
    await waitFor(
      () => {
        expect(mockFetch).toHaveBeenCalled();
      },
      { timeout: 1000 }
    );

    // Click Open button
    const openButton = screen.getByText("Open");
    await waitFor(() => {
      expect(openButton).not.toBeDisabled();
    });

    await user.click(openButton);

    expect(localStorage.setItem).toHaveBeenCalledWith("task_mode", "project_debugger");
    expect(mockPush).toHaveBeenCalledWith("/w/test-workspace/task/new?projectId=123");
  });

  it("should clear validation state when input is emptied", async () => {
    const user = userEvent.setup();
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          project: {
            id: "123",
            name: "Test Project",
          },
        },
      }),
    });
    global.fetch = mockFetch;

    render(<ProjectsPage />);

    const input = screen.getByPlaceholderText("e.g., 141652040");
    
    // Type project ID
    await user.type(input, "123");

    // Wait for validation
    await waitFor(
      () => {
        expect(mockFetch).toHaveBeenCalled();
      },
      { timeout: 1000 }
    );

    // Clear input
    await user.clear(input);

    // Success message should disappear
    await waitFor(() => {
      expect(screen.queryByText("Test Project")).not.toBeInTheDocument();
    });
  });

  it("should debounce validation calls", async () => {
    const user = userEvent.setup();
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        success: true,
        data: {
          project: { id: "123", name: "Test" },
        },
      }),
    });
    global.fetch = mockFetch;

    render(<ProjectsPage />);

    const input = screen.getByPlaceholderText("e.g., 141652040");
    
    // Type multiple characters quickly
    await user.type(input, "1234");

    // Wait a bit but not the full debounce time
    await new Promise((resolve) => setTimeout(resolve, 300));
    
    // Should not have called fetch yet (debounce is 500ms)
    expect(mockFetch).not.toHaveBeenCalled();

    // Wait for debounce to complete
    await waitFor(
      () => {
        expect(mockFetch).toHaveBeenCalledTimes(1);
        expect(mockFetch).toHaveBeenCalledWith("/api/stakwork/projects/1234");
      },
      { timeout: 1000 }
    );
  });
});
