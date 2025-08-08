import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { db } from "@/lib/db";
import { TaskStatus, Priority } from "@prisma/client";

// Mock NextAuth session
export const mockSession = (userId: string, name: string = "Test User", email: string = "test@example.com") => ({
  user: { id: userId, name, email },
  expires: new Date(Date.now() + 1000 * 60 * 60 * 24).toISOString(), // 24 hours
});

// Mock getServerSession
export const mockGetServerSession = (session: any) => {
  (getServerSession as jest.Mock) = jest.fn().mockResolvedValue(session);
};

// Create test user
export const createTestUser = async (data: {
  name?: string;
  email?: string;
  id?: string;
} = {}) => {
  return await db.user.create({
    data: {
      id: data.id || "test-user-id",
      name: data.name || "Test User",
      email: data.email || "test@example.com",
      emailVerified: new Date(),
    },
  });
};

// Create test workspace
export const createTestWorkspace = async (ownerId: string, data: {
  name?: string;
  slug?: string;
  id?: string;
} = {}) => {
  return await db.workspace.create({
    data: {
      id: data.id || "test-workspace-id", 
      name: data.name || "Test Workspace",
      slug: data.slug || "test-workspace",
      ownerId,
      deleted: false,
    },
  });
};

// Create test workspace member
export const createTestWorkspaceMember = async (workspaceId: string, userId: string, role: string = "MEMBER") => {
  return await db.workspaceMember.create({
    data: {
      workspaceId,
      userId,
      role,
    },
  });
};

// Create test repository
export const createTestRepository = async (workspaceId: string, data: {
  name?: string;
  repositoryUrl?: string;
  id?: string;
} = {}) => {
  return await db.repository.create({
    data: {
      id: data.id || "test-repo-id",
      name: data.name || "Test Repository", 
      repositoryUrl: data.repositoryUrl || "https://github.com/test/repo",
      workspaceId,
    },
  });
};

// Create test task
export const createTestTask = async (data: {
  title?: string;
  description?: string;
  workspaceId: string;
  status?: TaskStatus;
  priority?: Priority;
  assigneeId?: string;
  repositoryId?: string;
  createdById: string;
  estimatedHours?: number;
  actualHours?: number;
  id?: string;
}) => {
  return await db.task.create({
    data: {
      id: data.id || "test-task-id",
      title: data.title || "Test Task",
      description: data.description,
      workspaceId: data.workspaceId,
      status: data.status || TaskStatus.TODO,
      priority: data.priority || Priority.MEDIUM,
      assigneeId: data.assigneeId,
      repositoryId: data.repositoryId,
      estimatedHours: data.estimatedHours,
      actualHours: data.actualHours,
      createdById: data.createdById,
      updatedById: data.createdById,
      deleted: false,
    },
    include: {
      assignee: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      repository: {
        select: {
          id: true,
          name: true,
          repositoryUrl: true,
        },
      },
      createdBy: {
        select: {
          id: true,
          name: true,
          email: true,
        },
      },
      _count: {
        select: {
          chatMessages: true,
          comments: true,
        },
      },
    },
  });
};

// Mock NextRequest with URL and search params
export const mockNextRequest = (url: string, options: RequestInit = {}) => {
  const request = new NextRequest(url, options);
  return request;
};

// Mock NextResponse for testing
export const mockNextResponse = () => ({
  json: jest.fn((data: any, init?: ResponseInit) => ({
    status: init?.status || 200,
    data,
  })),
});

// Database cleanup helper
export const cleanupDatabase = async () => {
  await db.task.deleteMany({});
  await db.workspaceMember.deleteMany({});
  await db.repository.deleteMany({});
  await db.workspace.deleteMany({});
  await db.user.deleteMany({});
};

// Create mock request body
export const mockRequestWithBody = (url: string, body: any) => {
  return mockNextRequest(url, {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
    },
  });
};

// Assert error response structure
export const expectErrorResponse = (response: any, status: number, errorMessage?: string) => {
  expect(response.status).toBe(status);
  expect(response.data).toHaveProperty("error");
  if (errorMessage) {
    expect(response.data.error).toBe(errorMessage);
  }
};

// Assert success response structure
export const expectSuccessResponse = (response: any, status: number = 200) => {
  expect(response.status).toBe(status);
  expect(response.data).toHaveProperty("success", true);
  expect(response.data).toHaveProperty("data");
};

// Mock console methods to reduce test noise
export const mockConsole = () => {
  const originalConsole = { ...console };
  beforeEach(() => {
    console.log = jest.fn();
    console.error = jest.fn();
  });
  afterEach(() => {
    Object.assign(console, originalConsole);
  });
};