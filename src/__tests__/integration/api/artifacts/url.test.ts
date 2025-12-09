/**
 * DISABLED: These tests cannot run because the production route does not exist yet.
 * 
 * The route handler at /api/artifacts/[id]/url/route.ts needs to be implemented first.
 * 
 * TODO: Implement the artifact URL retrieval endpoint in a separate PR:
 * 1. Create src/app/api/artifacts/[id]/url/route.ts
 * 2. Implement GET handler with:
 *    - Authentication via getServerSession (NextAuth)
 *    - Authorization check (user must be workspace member)
 *    - Artifact retrieval from database
 *    - S3 presigned URL generation
 *    - Proper error handling (401, 403, 404, 400)
 * 3. Re-enable these tests
 * 
 * Once the route is implemented, uncomment this file and run the tests.
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";

// Mock NextAuth BEFORE any imports that use it
// This must be at the top to ensure Vitest hoists it properly
const mockGetServerSession = vi.fn();

vi.mock("next-auth/next", () => ({
  getServerSession: mockGetServerSession,
}));

vi.mock("next-auth", () => ({
  default: vi.fn(),
  getServerSession: mockGetServerSession,
}));

// Cannot import the route handler because it doesn't exist yet
// import { GET } from "@/app/api/artifacts/[id]/url/route";
import { prisma } from "@/lib/db";
import { createTestUser } from "@/__tests__/support/fixtures/user";
import { createTestWorkspace } from "@/__tests__/support/fixtures/workspace";
import { createTestTask } from "@/__tests__/support/fixtures/task";
import { generateUniqueId } from "@/__tests__/support/helpers/ids";

// Skip entire test suite until route is implemented
describe.skip("GET /api/artifacts/[id]/url", () => {
  let testUser: Awaited<ReturnType<typeof createTestUser>>;
  let testWorkspace: Awaited<ReturnType<typeof createTestWorkspace>>;
  let testTask: Awaited<ReturnType<typeof createTestTask>>;

  beforeEach(async () => {
    // Clean up database
    await prisma.artifact.deleteMany();
    await prisma.task.deleteMany();
    await prisma.workspaceMember.deleteMany();
    await prisma.workspace.deleteMany();
    await prisma.user.deleteMany();

    // Create test data
    testUser = await createTestUser({
      email: `test-${generateUniqueId()}@example.com`,
    });

    testWorkspace = await createTestWorkspace({
      name: `Test Workspace ${generateUniqueId()}`,
      ownerId: testUser.id,
    });

    // Add user as workspace member
    await prisma.workspaceMember.create({
      data: {
        userId: testUser.id,
        workspaceId: testWorkspace.id,
        role: "OWNER",
      },
    });

    testTask = await createTestTask({
      title: `Test Task ${generateUniqueId()}`,
      workspaceId: testWorkspace.id,
      createdBy: testUser.id,
    });

    // Setup default mock session
    mockGetServerSession.mockResolvedValue({
      user: {
        id: testUser.id,
        email: testUser.email,
        name: testUser.name,
      },
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
  });

  it("should return artifact URL for authenticated user with access", async () => {
    // Create test artifact
    const artifact = await prisma.artifact.create({
      data: {
        taskId: testTask.id,
        fileName: "test-file.pdf",
        fileType: "application/pdf",
        fileSize: 1024,
        s3Key: "test/key/file.pdf",
        s3Url: "https://s3.amazonaws.com/bucket/test/key/file.pdf",
        uploadedBy: testUser.id,
      },
    });

    const request = new NextRequest(
      `http://localhost:3000/api/artifacts/${artifact.id}/url`
    );

    const response = await GET(request, { params: { id: artifact.id } });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toHaveProperty("url");
    expect(data.url).toContain("s3.amazonaws.com");
  });

  it("should return 401 when user is not authenticated", async () => {
    // Mock unauthenticated session
    mockGetServerSession.mockResolvedValueOnce(null);

    const artifact = await prisma.artifact.create({
      data: {
        taskId: testTask.id,
        fileName: "test-file.pdf",
        fileType: "application/pdf",
        fileSize: 1024,
        s3Key: "test/key/file.pdf",
        s3Url: "https://s3.amazonaws.com/bucket/test/key/file.pdf",
        uploadedBy: testUser.id,
      },
    });

    const request = new NextRequest(
      `http://localhost:3000/api/artifacts/${artifact.id}/url`
    );

    const response = await GET(request, { params: { id: artifact.id } });

    expect(response.status).toBe(401);
  });

  it("should return 404 when artifact does not exist", async () => {
    const nonExistentId = "non-existent-artifact-id";

    const request = new NextRequest(
      `http://localhost:3000/api/artifacts/${nonExistentId}/url`
    );

    const response = await GET(request, { params: { id: nonExistentId } });

    expect(response.status).toBe(404);
  });

  it("should return 403 when user does not have access to workspace", async () => {
    // Create another user without workspace access
    const unauthorizedUser = await createTestUser({
      email: `unauthorized-${generateUniqueId()}@example.com`,
    });

    // Mock session with unauthorized user
    mockGetServerSession.mockResolvedValueOnce({
      user: {
        id: unauthorizedUser.id,
        email: unauthorizedUser.email,
        name: unauthorizedUser.name,
      },
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });

    const artifact = await prisma.artifact.create({
      data: {
        taskId: testTask.id,
        fileName: "test-file.pdf",
        fileType: "application/pdf",
        fileSize: 1024,
        s3Key: "test/key/file.pdf",
        s3Url: "https://s3.amazonaws.com/bucket/test/key/file.pdf",
        uploadedBy: testUser.id,
      },
    });

    const request = new NextRequest(
      `http://localhost:3000/api/artifacts/${artifact.id}/url`
    );

    const response = await GET(request, { params: { id: artifact.id } });

    expect(response.status).toBe(403);
  });

  it("should handle missing artifact ID parameter", async () => {
    const request = new NextRequest(
      "http://localhost:3000/api/artifacts//url"
    );

    const response = await GET(request, { params: { id: "" } });

    expect(response.status).toBe(400);
  });

  it("should return presigned URL when artifact has S3 key", async () => {
    const artifact = await prisma.artifact.create({
      data: {
        taskId: testTask.id,
        fileName: "document.pdf",
        fileType: "application/pdf",
        fileSize: 2048,
        s3Key: "artifacts/workspace-123/document.pdf",
        s3Url: "https://s3.amazonaws.com/bucket/artifacts/workspace-123/document.pdf",
        uploadedBy: testUser.id,
      },
    });

    const request = new NextRequest(
      `http://localhost:3000/api/artifacts/${artifact.id}/url`
    );

    const response = await GET(request, { params: { id: artifact.id } });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.url).toBeTruthy();
    expect(data.fileName).toBe("document.pdf");
    expect(data.fileType).toBe("application/pdf");
  });

  it("should work for workspace members with DEVELOPER role", async () => {
    const developerUser = await createTestUser({
      email: `developer-${generateUniqueId()}@example.com`,
    });

    await prisma.workspaceMember.create({
      data: {
        userId: developerUser.id,
        workspaceId: testWorkspace.id,
        role: "DEVELOPER",
      },
    });

    mockGetServerSession.mockResolvedValueOnce({
      user: {
        id: developerUser.id,
        email: developerUser.email,
        name: developerUser.name,
      },
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });

    const artifact = await prisma.artifact.create({
      data: {
        taskId: testTask.id,
        fileName: "code-file.ts",
        fileType: "text/typescript",
        fileSize: 512,
        s3Key: "artifacts/code-file.ts",
        s3Url: "https://s3.amazonaws.com/bucket/artifacts/code-file.ts",
        uploadedBy: testUser.id,
      },
    });

    const request = new NextRequest(
      `http://localhost:3000/api/artifacts/${artifact.id}/url`
    );

    const response = await GET(request, { params: { id: artifact.id } });

    expect(response.status).toBe(200);
  });

  it("should work for workspace members with VIEWER role", async () => {
    const viewerUser = await createTestUser({
      email: `viewer-${generateUniqueId()}@example.com`,
    });

    await prisma.workspaceMember.create({
      data: {
        userId: viewerUser.id,
        workspaceId: testWorkspace.id,
        role: "VIEWER",
      },
    });

    mockGetServerSession.mockResolvedValueOnce({
      user: {
        id: viewerUser.id,
        email: viewerUser.email,
        name: viewerUser.name,
      },
      expires: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });

    const artifact = await prisma.artifact.create({
      data: {
        taskId: testTask.id,
        fileName: "report.pdf",
        fileType: "application/pdf",
        fileSize: 3072,
        s3Key: "artifacts/report.pdf",
        s3Url: "https://s3.amazonaws.com/bucket/artifacts/report.pdf",
        uploadedBy: testUser.id,
      },
    });

    const request = new NextRequest(
      `http://localhost:3000/api/artifacts/${artifact.id}/url`
    );

    const response = await GET(request, { params: { id: artifact.id } });

    expect(response.status).toBe(200);
  });

  it("should handle artifacts with different file types", async () => {
    const fileTypes = [
      { fileName: "image.png", fileType: "image/png" },
      { fileName: "document.docx", fileType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" },
      { fileName: "spreadsheet.xlsx", fileType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" },
      { fileName: "video.mp4", fileType: "video/mp4" },
    ];

    for (const { fileName, fileType } of fileTypes) {
      const artifact = await prisma.artifact.create({
        data: {
          taskId: testTask.id,
          fileName,
          fileType,
          fileSize: 1024,
          s3Key: `artifacts/${fileName}`,
          s3Url: `https://s3.amazonaws.com/bucket/artifacts/${fileName}`,
          uploadedBy: testUser.id,
        },
      });

      const request = new NextRequest(
        `http://localhost:3000/api/artifacts/${artifact.id}/url`
      );

      const response = await GET(request, { params: { id: artifact.id } });
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.fileType).toBe(fileType);
      expect(data.fileName).toBe(fileName);
    }
  });

  it("should return metadata along with URL", async () => {
    const artifact = await prisma.artifact.create({
      data: {
        taskId: testTask.id,
        fileName: "metadata-test.pdf",
        fileType: "application/pdf",
        fileSize: 4096,
        s3Key: "artifacts/metadata-test.pdf",
        s3Url: "https://s3.amazonaws.com/bucket/artifacts/metadata-test.pdf",
        uploadedBy: testUser.id,
      },
    });

    const request = new NextRequest(
      `http://localhost:3000/api/artifacts/${artifact.id}/url`
    );

    const response = await GET(request, { params: { id: artifact.id } });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({
      url: expect.any(String),
      fileName: "metadata-test.pdf",
      fileType: "application/pdf",
      fileSize: 4096,
    });
  });

  it("should handle large file sizes", async () => {
    const artifact = await prisma.artifact.create({
      data: {
        taskId: testTask.id,
        fileName: "large-file.zip",
        fileType: "application/zip",
        fileSize: 104857600, // 100MB
        s3Key: "artifacts/large-file.zip",
        s3Url: "https://s3.amazonaws.com/bucket/artifacts/large-file.zip",
        uploadedBy: testUser.id,
      },
    });

    const request = new NextRequest(
      `http://localhost:3000/api/artifacts/${artifact.id}/url`
    );

    const response = await GET(request, { params: { id: artifact.id } });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.fileSize).toBe(104857600);
  });

  it("should handle artifacts from different tasks in same workspace", async () => {
    const task2 = await createTestTask({
      title: `Another Task ${generateUniqueId()}`,
      workspaceId: testWorkspace.id,
      createdBy: testUser.id,
    });

    const artifact1 = await prisma.artifact.create({
      data: {
        taskId: testTask.id,
        fileName: "task1-file.pdf",
        fileType: "application/pdf",
        fileSize: 1024,
        s3Key: "artifacts/task1-file.pdf",
        s3Url: "https://s3.amazonaws.com/bucket/artifacts/task1-file.pdf",
        uploadedBy: testUser.id,
      },
    });

    const artifact2 = await prisma.artifact.create({
      data: {
        taskId: task2.id,
        fileName: "task2-file.pdf",
        fileType: "application/pdf",
        fileSize: 2048,
        s3Key: "artifacts/task2-file.pdf",
        s3Url: "https://s3.amazonaws.com/bucket/artifacts/task2-file.pdf",
        uploadedBy: testUser.id,
      },
    });

    // Test artifact1
    let request = new NextRequest(
      `http://localhost:3000/api/artifacts/${artifact1.id}/url`
    );
    let response = await GET(request, { params: { id: artifact1.id } });
    expect(response.status).toBe(200);

    // Test artifact2
    request = new NextRequest(
      `http://localhost:3000/api/artifacts/${artifact2.id}/url`
    );
    response = await GET(request, { params: { id: artifact2.id } });
    expect(response.status).toBe(200);
  });

  it("should handle concurrent requests for same artifact", async () => {
    const artifact = await prisma.artifact.create({
      data: {
        taskId: testTask.id,
        fileName: "concurrent-test.pdf",
        fileType: "application/pdf",
        fileSize: 1024,
        s3Key: "artifacts/concurrent-test.pdf",
        s3Url: "https://s3.amazonaws.com/bucket/artifacts/concurrent-test.pdf",
        uploadedBy: testUser.id,
      },
    });

    const requests = Array.from({ length: 5 }, () =>
      GET(
        new NextRequest(
          `http://localhost:3000/api/artifacts/${artifact.id}/url`
        ),
        { params: { id: artifact.id } }
      )
    );

    const responses = await Promise.all(requests);

    responses.forEach(response => {
      expect(response.status).toBe(200);
    });
  });

  it("should validate artifact ID format", async () => {
    const invalidIds = [
      "invalid-id-format",
      "12345",
      "abc-def-ghi",
      "../../../etc/passwd",
    ];

    for (const invalidId of invalidIds) {
      const request = new NextRequest(
        `http://localhost:3000/api/artifacts/${invalidId}/url`
      );

      const response = await GET(request, { params: { id: invalidId } });

      expect([400, 404]).toContain(response.status);
    }
  });
});
