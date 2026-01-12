import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { POST } from "@/app/api/features/detect-feature-request/route";
import { db } from "@/lib/db";
import { createTestUser, createTestWorkspace } from "@/__tests__/support/fixtures";
import { createAuthenticatedPostRequest, createPostRequest, generateUniqueId } from "@/__tests__/support/helpers";
import type { User, Workspace } from "@prisma/client";
import { detectRequestType, type DetectionResult } from "@/lib/ai/wake-word-detector";

// Mock the wake-word-detector module
vi.mock("@/lib/ai/wake-word-detector", () => ({
  detectRequestType: vi.fn(),
}));

describe("POST /api/features/detect-feature-request - Authentication", () => {
  let user: User;
  let workspace: Workspace;

  beforeEach(async () => {
    user = await createTestUser({
      name: "Detect Feature Test User",
      email: `detect-feature-${generateUniqueId("user")}@example.com`,
    });

    workspace = await createTestWorkspace({
      name: "Detect Feature Workspace",
      slug: `detect-feature-${generateUniqueId("workspace")}`,
      ownerId: user.id,
    });

    await db.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        role: "OWNER",
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should return 401 for unauthenticated requests", async () => {
    const request = createPostRequest("/api/features/detect-feature-request", {
      chunk: "hive, make a feature from this",
      workspaceSlug: workspace.slug,
    });

    const response = await POST(request);

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toBe("Unauthorized");
  });

  it("should allow authenticated requests", async () => {
    vi.mocked(detectRequestType).mockResolvedValue({ isRequest: true, mode: "feature" });

    const request = createAuthenticatedPostRequest(
      "/api/features/detect-feature-request",
      {
        chunk: "hive, make a feature from this",
        workspaceSlug: workspace.slug,
      },
      user,
    );

    const response = await POST(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.isFeatureRequest).toBe(true);
    expect(data.isRequest).toBe(true);
    expect(data.mode).toBe("feature");
  });
});

describe("POST /api/features/detect-feature-request - Input Validation", () => {
  let user: User;
  let workspace: Workspace;

  beforeEach(async () => {
    user = await createTestUser({
      name: "Validation Test User",
      email: `validation-${generateUniqueId("user")}@example.com`,
    });

    workspace = await createTestWorkspace({
      name: "Validation Workspace",
      slug: `validation-${generateUniqueId("workspace")}`,
      ownerId: user.id,
    });

    await db.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        role: "OWNER",
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should return 400 when chunk is missing", async () => {
    const request = createAuthenticatedPostRequest(
      "/api/features/detect-feature-request",
      {
        workspaceSlug: workspace.slug,
      },
      user,
    );

    const response = await POST(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Missing required fields");
  });

  it("should return 400 when workspaceSlug is missing", async () => {
    const request = createAuthenticatedPostRequest(
      "/api/features/detect-feature-request",
      {
        chunk: "hive, make a feature",
      },
      user,
    );

    const response = await POST(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Missing required fields");
  });

  it("should return 400 when chunk is not a string", async () => {
    const request = createAuthenticatedPostRequest(
      "/api/features/detect-feature-request",
      {
        chunk: 123,
        workspaceSlug: workspace.slug,
      },
      user,
    );

    const response = await POST(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Chunk must be a non-empty string");
  });

  it("should return 400 when chunk is an empty string", async () => {
    const request = createAuthenticatedPostRequest(
      "/api/features/detect-feature-request",
      {
        chunk: "",
        workspaceSlug: workspace.slug,
      },
      user,
    );

    const response = await POST(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    // Empty string is caught by the !chunk check, so error message is about missing fields
    expect(data.error).toContain("Missing required fields");
  });

  it("should return 400 when chunk is only whitespace", async () => {
    const request = createAuthenticatedPostRequest(
      "/api/features/detect-feature-request",
      {
        chunk: "   ",
        workspaceSlug: workspace.slug,
      },
      user,
    );

    const response = await POST(request);

    expect(response.status).toBe(400);
    const data = await response.json();
    expect(data.error).toContain("Chunk must be a non-empty string");
  });
});

describe("POST /api/features/detect-feature-request - Feature Detection", () => {
  let user: User;
  let workspace: Workspace;

  beforeEach(async () => {
    user = await createTestUser({
      name: "Detection Test User",
      email: `detection-${generateUniqueId("user")}@example.com`,
    });

    workspace = await createTestWorkspace({
      name: "Detection Workspace",
      slug: `detection-${generateUniqueId("workspace")}`,
      ownerId: user.id,
    });

    await db.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        role: "OWNER",
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should detect feature request when AI returns feature mode", async () => {
    vi.mocked(detectRequestType).mockResolvedValue({ isRequest: true, mode: "feature" });

    const request = createAuthenticatedPostRequest(
      "/api/features/detect-feature-request",
      {
        chunk: "hive, make a feature from this conversation",
        workspaceSlug: workspace.slug,
      },
      user,
    );

    const response = await POST(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.isFeatureRequest).toBe(true);
    expect(data.isRequest).toBe(true);
    expect(data.mode).toBe("feature");

    // Verify detectRequestType was called with correct params
    expect(detectRequestType).toHaveBeenCalledWith("hive, make a feature from this conversation", workspace.slug);
  });

  it("should detect task request when AI returns task mode", async () => {
    vi.mocked(detectRequestType).mockResolvedValue({ isRequest: true, mode: "task" });

    const request = createAuthenticatedPostRequest(
      "/api/features/detect-feature-request",
      {
        chunk: "hive, create a task from this",
        workspaceSlug: workspace.slug,
      },
      user,
    );

    const response = await POST(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.isFeatureRequest).toBe(false); // Not a feature request
    expect(data.isRequest).toBe(true);
    expect(data.mode).toBe("task");

    // Verify detectRequestType was called with correct params
    expect(detectRequestType).toHaveBeenCalledWith("hive, create a task from this", workspace.slug);
  });

  it("should not detect request when AI returns none", async () => {
    vi.mocked(detectRequestType).mockResolvedValue({ isRequest: false, mode: null });

    const request = createAuthenticatedPostRequest(
      "/api/features/detect-feature-request",
      {
        chunk: "hive, what is the weather today?",
        workspaceSlug: workspace.slug,
      },
      user,
    );

    const response = await POST(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.isFeatureRequest).toBe(false);
    expect(data.isRequest).toBe(false);
    expect(data.mode).toBe(null);

    // Verify detectRequestType was called with correct params
    expect(detectRequestType).toHaveBeenCalledWith("hive, what is the weather today?", workspace.slug);
  });

  it("should handle various wake word commands correctly", async () => {
    const testCases = [
      { chunk: "hive, create a feature", expected: { isRequest: true, mode: "feature" as const }, isFeature: true },
      { chunk: "hive, build this", expected: { isRequest: true, mode: "feature" as const }, isFeature: true },
      {
        chunk: "hive, can you create a feature for login?",
        expected: { isRequest: true, mode: "feature" as const },
        isFeature: true,
      },
      {
        chunk: "hive, create a task from this",
        expected: { isRequest: true, mode: "task" as const },
        isFeature: false,
      },
      { chunk: "hive, what time is it?", expected: { isRequest: false, mode: null }, isFeature: false },
      { chunk: "hive, tell me about the project", expected: { isRequest: false, mode: null }, isFeature: false },
    ];

    for (const testCase of testCases) {
      vi.mocked(detectRequestType).mockResolvedValue(testCase.expected);

      const request = createAuthenticatedPostRequest(
        "/api/features/detect-feature-request",
        {
          chunk: testCase.chunk,
          workspaceSlug: workspace.slug,
        },
        user,
      );

      const response = await POST(request);
      const data = await response.json();

      expect(data.isFeatureRequest).toBe(testCase.isFeature);
      expect(data.isRequest).toBe(testCase.expected.isRequest);
      expect(data.mode).toBe(testCase.expected.mode);
      expect(detectRequestType).toHaveBeenCalledWith(testCase.chunk, workspace.slug);
      vi.clearAllMocks();
    }
  });

  it("should pass workspaceSlug to detectRequestType", async () => {
    vi.mocked(detectRequestType).mockResolvedValue({ isRequest: true, mode: "feature" });

    const request = createAuthenticatedPostRequest(
      "/api/features/detect-feature-request",
      {
        chunk: "hive, make a feature",
        workspaceSlug: workspace.slug,
      },
      user,
    );

    await POST(request);

    expect(detectRequestType).toHaveBeenCalledWith("hive, make a feature", workspace.slug);
  });
});

describe("POST /api/features/detect-feature-request - Error Handling", () => {
  let user: User;
  let workspace: Workspace;

  beforeEach(async () => {
    user = await createTestUser({
      name: "Error Test User",
      email: `error-${generateUniqueId("user")}@example.com`,
    });

    workspace = await createTestWorkspace({
      name: "Error Workspace",
      slug: `error-${generateUniqueId("workspace")}`,
      ownerId: user.id,
    });

    await db.workspaceMember.create({
      data: {
        workspaceId: workspace.id,
        userId: user.id,
        role: "OWNER",
      },
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("should handle malformed JSON in request body gracefully", async () => {
    // Create a request with malformed JSON by constructing manually
    const request = new Request("http://localhost/api/features/detect-feature-request", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-middleware-user-id": user.id,
        "x-middleware-user-email": user.email,
        "x-middleware-user-name": user.name || "",
        "x-middleware-auth-status": "authenticated",
        "x-middleware-request-id": generateUniqueId("request"),
      },
      body: "invalid json{",
    });

    const response = await POST(request as any);

    expect(response.status).toBe(500);
    const data = await response.json();
    expect(data.error).toBeDefined();
  });

  it("should handle errors from detectRequestType gracefully", async () => {
    // Note: detectRequestType handles errors internally and returns { isRequest: false, mode: null },
    // so the endpoint should still return 200 with isFeatureRequest: false
    vi.mocked(detectRequestType).mockResolvedValue({ isRequest: false, mode: null });

    const request = createAuthenticatedPostRequest(
      "/api/features/detect-feature-request",
      {
        chunk: "hive, make a feature",
        workspaceSlug: workspace.slug,
      },
      user,
    );

    const response = await POST(request);

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.isFeatureRequest).toBe(false);
    expect(data.isRequest).toBe(false);
  });
});
