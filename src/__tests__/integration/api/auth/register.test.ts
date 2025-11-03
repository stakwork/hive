import { describe, test, expect, afterEach } from "vitest";
import { db } from "@/lib/db";
import { POST } from "@/app/api/auth/register/route";
import { createPostRequest } from "@/__tests__/support/helpers";

describe("POST /api/auth/register", () => {
  let createdUserId: string | null = null;

  afterEach(async () => {
    // Cleanup: Delete test user
    if (createdUserId) {
      await db.user.delete({
        where: { id: createdUserId },
      });
      createdUserId = null;
    }
  });

  test("successfully registers a new user with valid credentials", async () => {
    const testEmail = `test-${Date.now()}@example.com`;
    
    const request = createPostRequest("/api/auth/register", {
      email: testEmail,
      password: "TestPassword123!",
      name: "Test User",
    });

    const response = await POST(request);

    expect(response.status).toBe(201);

    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.user).toBeDefined();
    expect(data.user.email).toBe(testEmail);
    expect(data.user.name).toBe("Test User");
    expect(data.user.id).toBeDefined();

    createdUserId = data.user.id;

    // Verify user exists in database with hashed password
    const user = await db.user.findUnique({
      where: { id: createdUserId },
      select: {
        passwordDigest: true,
        passwordUpdatedAt: true,
      },
    });

    expect(user).toBeDefined();
    expect(user?.passwordDigest).toBeDefined();
    expect(user?.passwordUpdatedAt).toBeDefined();
    // Password should be hashed (not equal to original)
    expect(user?.passwordDigest).not.toBe("TestPassword123!");
  });

  test("rejects registration with missing email", async () => {
    const request = createPostRequest("/api/auth/register", {
      password: "TestPassword123!",
    });

    const response = await POST(request);

    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain("Email and password are required");
  });

  test("rejects registration with invalid email format", async () => {
    const request = createPostRequest("/api/auth/register", {
      email: "invalid-email",
      password: "TestPassword123!",
    });

    const response = await POST(request);

    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain("Invalid email format");
  });

  test("rejects registration with weak password (too short)", async () => {
    const testEmail = `test-${Date.now()}@example.com`;
    const request = createPostRequest("/api/auth/register", {
      email: testEmail,
      password: "Short1!",
    });

    const response = await POST(request);

    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain("at least 12 characters");
  });

  test("rejects registration with weak password (missing uppercase)", async () => {
    const testEmail = `test-${Date.now()}@example.com`;
    const request = createPostRequest("/api/auth/register", {
      email: testEmail,
      password: "testpassword123!",
    });

    const response = await POST(request);

    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain("uppercase");
  });

  test("rejects registration with weak password (missing special character)", async () => {
    const testEmail = `test-${Date.now()}@example.com`;
    const request = createPostRequest("/api/auth/register", {
      email: testEmail,
      password: "TestPassword123",
    });

    const response = await POST(request);

    expect(response.status).toBe(400);

    const data = await response.json();
    expect(data.success).toBe(false);
    expect(data.error).toContain("special characters");
  });

  test("rejects registration with duplicate email", async () => {
    const testEmail = `test-${Date.now()}@example.com`;
    
    // Create first user
    const firstRequest = createPostRequest("/api/auth/register", {
      email: testEmail,
      password: "TestPassword123!",
    });

    const firstResponse = await POST(firstRequest);

    expect(firstResponse.status).toBe(201);
    const firstData = await firstResponse.json();
    createdUserId = firstData.user.id;

    // Try to create second user with same email
    const secondRequest = createPostRequest("/api/auth/register", {
      email: testEmail,
      password: "AnotherPassword456!",
    });

    const secondResponse = await POST(secondRequest);

    expect(secondResponse.status).toBe(409);

    const secondData = await secondResponse.json();
    expect(secondData.success).toBe(false);
    expect(secondData.error).toContain("already exists");
  });
});