import { TaskStatus, Priority } from "@prisma/client";

// Mock user data
export const mockUsers = {
  owner: {
    id: "owner-user-id",
    name: "Workspace Owner",
    email: "owner@example.com",
  },
  member: {
    id: "member-user-id", 
    name: "Workspace Member",
    email: "member@example.com",
  },
  nonMember: {
    id: "non-member-user-id",
    name: "Non Member User", 
    email: "nonmember@example.com",
  },
  assignee: {
    id: "assignee-user-id",
    name: "Task Assignee",
    email: "assignee@example.com", 
  },
};

// Mock workspace data
export const mockWorkspaces = {
  primary: {
    id: "primary-workspace-id",
    name: "Primary Workspace",
    slug: "primary-workspace",
    ownerId: mockUsers.owner.id,
    deleted: false,
  },
  secondary: {
    id: "secondary-workspace-id", 
    name: "Secondary Workspace",
    slug: "secondary-workspace",
    ownerId: mockUsers.owner.id,
    deleted: false,
  },
  deleted: {
    id: "deleted-workspace-id",
    name: "Deleted Workspace", 
    slug: "deleted-workspace",
    ownerId: mockUsers.owner.id,
    deleted: true,
  },
};

// Mock repository data
export const mockRepositories = {
  primary: {
    id: "primary-repo-id",
    name: "Primary Repository", 
    repositoryUrl: "https://github.com/test/primary-repo",
    workspaceId: mockWorkspaces.primary.id,
  },
  secondary: {
    id: "secondary-repo-id",
    name: "Secondary Repository",
    repositoryUrl: "https://github.com/test/secondary-repo", 
    workspaceId: mockWorkspaces.primary.id,
  },
  otherWorkspace: {
    id: "other-workspace-repo-id",
    name: "Other Workspace Repo",
    repositoryUrl: "https://github.com/test/other-workspace-repo",
    workspaceId: mockWorkspaces.secondary.id,
  },
};

// Mock task data
export const mockTasks = {
  todo: {
    id: "todo-task-id",
    title: "TODO Task",
    description: "A task in TODO status",
    workspaceId: mockWorkspaces.primary.id,
    status: TaskStatus.TODO,
    priority: Priority.MEDIUM,
    assigneeId: mockUsers.assignee.id,
    repositoryId: mockRepositories.primary.id,
    estimatedHours: 4,
    actualHours: null,
    createdById: mockUsers.owner.id,
    updatedById: mockUsers.owner.id,
    deleted: false,
  },
  inProgress: {
    id: "in-progress-task-id", 
    title: "In Progress Task",
    description: "A task currently in progress",
    workspaceId: mockWorkspaces.primary.id,
    status: TaskStatus.IN_PROGRESS,
    priority: Priority.HIGH,
    assigneeId: mockUsers.member.id,
    repositoryId: null,
    estimatedHours: 8,
    actualHours: 3,
    createdById: mockUsers.owner.id,
    updatedById: mockUsers.member.id,
    deleted: false,
  },
  completed: {
    id: "completed-task-id",
    title: "Completed Task", 
    description: "A completed task",
    workspaceId: mockWorkspaces.primary.id,
    status: TaskStatus.DONE,
    priority: Priority.LOW,
    assigneeId: null,
    repositoryId: mockRepositories.secondary.id,
    estimatedHours: 2,
    actualHours: 2.5,
    createdById: mockUsers.member.id,
    updatedById: mockUsers.member.id,
    deleted: false,
  },
  deleted: {
    id: "deleted-task-id",
    title: "Deleted Task",
    description: "A deleted task", 
    workspaceId: mockWorkspaces.primary.id,
    status: TaskStatus.TODO,
    priority: Priority.MEDIUM,
    assigneeId: null,
    repositoryId: null,
    estimatedHours: null,
    actualHours: null,
    createdById: mockUsers.owner.id,
    updatedById: mockUsers.owner.id,
    deleted: true,
  },
};

// Mock task creation payloads
export const mockTaskPayloads = {
  minimal: {
    title: "New Task",
    workspaceSlug: mockWorkspaces.primary.slug,
  },
  complete: {
    title: "Complete New Task",
    description: "A complete task with all fields",
    workspaceSlug: mockWorkspaces.primary.slug,
    status: TaskStatus.TODO,
    priority: Priority.HIGH,
    assigneeId: mockUsers.assignee.id,
    repositoryId: mockRepositories.primary.id,
    estimatedHours: 6,
    actualHours: null,
  },
  withActiveStatus: {
    title: "Active Status Task",
    workspaceSlug: mockWorkspaces.primary.slug,
    status: "active", // Should be mapped to IN_PROGRESS
  },
  invalid: {
    title: "", // Invalid: empty title
    workspaceSlug: mockWorkspaces.primary.slug,
  },
  invalidStatus: {
    title: "Invalid Status Task", 
    workspaceSlug: mockWorkspaces.primary.slug,
    status: "invalid-status",
  },
  invalidPriority: {
    title: "Invalid Priority Task",
    workspaceSlug: mockWorkspaces.primary.slug,
    priority: "invalid-priority", 
  },
  nonExistentAssignee: {
    title: "Non-existent Assignee Task",
    workspaceSlug: mockWorkspaces.primary.slug,
    assigneeId: "non-existent-user-id",
  },
  nonExistentRepository: {
    title: "Non-existent Repository Task", 
    workspaceSlug: mockWorkspaces.primary.slug,
    repositoryId: "non-existent-repo-id",
  },
  otherWorkspaceRepository: {
    title: "Other Workspace Repository Task",
    workspaceSlug: mockWorkspaces.primary.slug,
    repositoryId: mockRepositories.otherWorkspace.id, // Repository belongs to different workspace
  },
};

// Mock API responses
export const mockApiResponses = {
  tasksList: {
    success: true,
    data: [mockTasks.todo, mockTasks.inProgress, mockTasks.completed],
  },
  taskCreated: {
    success: true, 
    data: mockTasks.todo,
  },
  unauthorized: {
    error: "Unauthorized",
  },
  invalidSession: {
    error: "Invalid user session",
  },
  missingWorkspaceId: {
    error: "workspaceId query parameter is required",
  },
  workspaceNotFound: {
    error: "Workspace not found",
  },
  accessDenied: {
    error: "Access denied", 
  },
  missingFields: {
    error: "Missing required fields: title, workspaceId",
  },
  assigneeNotFound: {
    error: "Assignee not found",
  },
  repositoryNotFound: {
    error: "Repository not found or does not belong to this workspace",
  },
  serverError: {
    error: "Failed to fetch tasks",
  },
};

// Mock session objects
export const mockSessions = {
  owner: {
    user: { id: mockUsers.owner.id, name: mockUsers.owner.name, email: mockUsers.owner.email },
    expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
  },
  member: {
    user: { id: mockUsers.member.id, name: mockUsers.member.name, email: mockUsers.member.email },
    expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
  },
  nonMember: {
    user: { id: mockUsers.nonMember.id, name: mockUsers.nonMember.name, email: mockUsers.nonMember.email },
    expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
  },
  invalidUser: {
    user: { name: "User Without ID", email: "no-id@example.com" }, // Missing ID
    expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(),
  },
};

// Mock URLs for testing
export const mockUrls = {
  getTasks: (workspaceId: string) => `http://localhost:3000/api/tasks?workspaceId=${workspaceId}`,
  getTasksNoParam: "http://localhost:3000/api/tasks",
  createTask: "http://localhost:3000/api/tasks",
};