import React from "react";
import { render, RenderOptions } from "@testing-library/react";
import { vi } from "vitest";
import { WorkspaceContext, WorkspaceContextType } from "@/contexts/WorkspaceContext";

// Mock workspace data fixtures
export const mockWorkspaces = [
  {
    id: "workspace-1",
    name: "Test Workspace 1",
    slug: "test-workspace-1",
    description: "First test workspace",
    userRole: "OWNER" as const,
  },
  {
    id: "workspace-2", 
    name: "Test Workspace 2",
    slug: "test-workspace-2",
    description: "Second test workspace",
    userRole: "ADMIN" as const,
  },
  {
    id: "workspace-3",
    name: "Test Workspace 3", 
    slug: "test-workspace-3",
    description: "Third test workspace",
    userRole: "DEVELOPER" as const,
  },
  {
    id: "workspace-4",
    name: "Test Workspace 4",
    slug: "test-workspace-4", 
    description: "Fourth test workspace",
    userRole: "VIEWER" as const,
  },
];

export const mockCurrentWorkspace = {
  id: "workspace-1",
  name: "Test Workspace 1",
  slug: "test-workspace-1",
  description: "Current active workspace",
  userRole: "OWNER" as const,
  ownerId: "user-1",
  createdAt: new Date("2023-01-01"),
  updatedAt: new Date("2023-01-01"),
};

// Mock context values for different scenarios
export const createMockWorkspaceContext = (
  overrides: Partial<WorkspaceContextType> = {}
): WorkspaceContextType => ({
  workspace: mockCurrentWorkspace,
  slug: "test-workspace-1",
  id: "workspace-1", 
  role: "OWNER",
  workspaces: mockWorkspaces,
  loading: false,
  error: null,
  hasAccess: true,
  switchWorkspace: vi.fn(),
  refreshWorkspaces: vi.fn(),
  refreshCurrentWorkspace: vi.fn(),
  ...overrides,
});

// Mock provider component for testing
export const MockWorkspaceProvider: React.FC<{
  children: React.ReactNode;
  contextValue?: Partial<WorkspaceContextType>;
}> = ({ children, contextValue = {} }) => {
  const mockContext = createMockWorkspaceContext(contextValue);
  return React.createElement(
    WorkspaceContext.Provider,
    { value: mockContext },
    children
  );
};

// Render component with workspace context
export const renderWithWorkspaceContext = (
  ui: React.ReactElement,
  contextValue: Partial<WorkspaceContextType> = {},
  options: Omit<RenderOptions, "wrapper"> = {}
) => {
  const Wrapper: React.FC<{ children: React.ReactNode }> = ({ children }) =>
    React.createElement(MockWorkspaceProvider, { contextValue }, children);

  return render(ui, { wrapper: Wrapper, ...options });
};

// Helper to render component without workspace context (for error testing)
export const renderWithoutWorkspaceContext = (
  ui: React.ReactElement,
  options: RenderOptions = {}
) => {
  return render(ui, options);
};

// Mock context scenarios
export const mockContextScenarios = {
  // No context (outside provider)
  noContext: undefined,
  
  // Loading states
  loading: createMockWorkspaceContext({
    workspace: null,
    slug: "",
    id: "",
    role: null,
    loading: true,
    hasAccess: true,
  }),

  // Error states
  error: createMockWorkspaceContext({
    workspace: null,
    slug: "",
    id: "",
    role: null,
    loading: false,
    error: "Failed to load workspace",
    hasAccess: false,
  }),

  // No access
  noAccess: createMockWorkspaceContext({
    workspace: null,
    slug: "",
    id: "",
    role: null,
    loading: false,
    error: "Workspace not found or access denied",
    hasAccess: false,
  }),

  // Different roles
  owner: createMockWorkspaceContext({
    role: "OWNER",
    workspace: { ...mockCurrentWorkspace, userRole: "OWNER" },
  }),

  admin: createMockWorkspaceContext({
    role: "ADMIN",
    workspace: { ...mockCurrentWorkspace, userRole: "ADMIN" },
  }),

  pm: createMockWorkspaceContext({
    role: "PM",
    workspace: { ...mockCurrentWorkspace, userRole: "PM" },
  }),

  developer: createMockWorkspaceContext({
    role: "DEVELOPER", 
    workspace: { ...mockCurrentWorkspace, userRole: "DEVELOPER" },
  }),

  stakeholder: createMockWorkspaceContext({
    role: "STAKEHOLDER",
    workspace: { ...mockCurrentWorkspace, userRole: "STAKEHOLDER" },
  }),

  viewer: createMockWorkspaceContext({
    role: "VIEWER",
    workspace: { ...mockCurrentWorkspace, userRole: "VIEWER" },
  }),

  // Empty workspaces
  noWorkspaces: createMockWorkspaceContext({
    workspaces: [],
  }),
};

// Helper to create workspace fixtures with specific roles
export const createWorkspaceFixture = (
  overrides: Partial<typeof mockCurrentWorkspace> = {}
) => ({
  ...mockCurrentWorkspace,
  ...overrides,
});

// Helper to create workspace list fixtures
export const createWorkspaceListFixture = (count: number = 3) => {
  return Array.from({ length: count }, (_, index) => ({
    id: `workspace-${index + 1}`,
    name: `Test Workspace ${index + 1}`,
    slug: `test-workspace-${index + 1}`,
    description: `Test workspace number ${index + 1}`,
    userRole: index === 0 ? "OWNER" : index === 1 ? "ADMIN" : "DEVELOPER",
  }));
};

// Mock functions with proper typing
export const createMockFunctions = () => ({
  switchWorkspace: vi.fn(),
  refreshWorkspaces: vi.fn().mockResolvedValue(undefined),
  refreshCurrentWorkspace: vi.fn().mockResolvedValue(undefined),
});

// Test data generators
export const generateWorkspaceId = (prefix: string = "workspace") => 
  `${prefix}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

export const generateWorkspaceSlug = (name: string) =>
  name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// Assert helpers for workspace testing
export const assertWorkspaceShape = (workspace: any) => {
  expect(workspace).toHaveProperty("id");
  expect(workspace).toHaveProperty("name");
  expect(workspace).toHaveProperty("slug");
  expect(workspace).toHaveProperty("userRole");
  expect(typeof workspace.id).toBe("string");
  expect(typeof workspace.name).toBe("string");
  expect(typeof workspace.slug).toBe("string");
  expect(typeof workspace.userRole).toBe("string");
};

// Role validation helpers
export const validRoles = ["OWNER", "ADMIN", "PM", "DEVELOPER", "STAKEHOLDER", "VIEWER"] as const;

export const isValidRole = (role: string): role is typeof validRoles[number] => {
  return validRoles.includes(role as any);
};

export const getRoleHierarchy = (role: string) => {
  const hierarchy: Record<string, number> = {
    OWNER: 6,
    ADMIN: 5,
    PM: 4,
    DEVELOPER: 3,
    STAKEHOLDER: 2,
    VIEWER: 1,
  };
  return hierarchy[role] || 0;
};

// Mock API responses
export const mockApiResponses = {
  workspaces: {
    success: { workspaces: mockWorkspaces },
    error: { error: "Failed to fetch workspaces" },
    unauthorized: { error: "Unauthorized" },
  },
  
  workspace: {
    success: { workspace: mockCurrentWorkspace },
    notFound: { error: "Workspace not found" },
    forbidden: { error: "Access denied" },
  },
};