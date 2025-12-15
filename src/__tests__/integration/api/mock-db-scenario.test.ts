/**
 * Mock DB Scenario API Integration Tests
 * 
 * Tests the Three-Tier Test Data Scenario System API endpoint.
 * Validates scenario listing, execution, and mock mode safety guards.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { GET, POST } from "@/app/api/mock/db/scenario/route";
import { NextRequest } from "next/server";
import { config } from "@/config/env";
import { resetDatabase } from "@/__tests__/support/fixtures/database";
import { db } from "@/lib/db";

// Store original USE_MOCKS value
const originalUseMocks = config.USE_MOCKS;

describe("GET /api/mock/db/scenario", () => {
  afterEach(() => {
    // Restore original USE_MOCKS value
    Object.defineProperty(config, "USE_MOCKS", {
      value: originalUseMocks,
      writable: true,
      configurable: true,
    });
  });

  it("should return 403 when USE_MOCKS is false", async () => {
    // Mock USE_MOCKS as false
    Object.defineProperty(config, "USE_MOCKS", {
      value: false,
      writable: true,
      configurable: true,
    });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toBe("Mock endpoints only available when USE_MOCKS=true");
  });

  it("should list available scenarios when USE_MOCKS is true", async () => {
    // Ensure USE_MOCKS is true
    Object.defineProperty(config, "USE_MOCKS", {
      value: true,
      writable: true,
      configurable: true,
    });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.scenarios).toBeInstanceOf(Array);
    expect(data.scenarios.length).toBeGreaterThan(0);
    expect(data.mockMode).toBe(true);
    expect(data.schemaVersion).toBeDefined();

    // Verify scenario structure
    const firstScenario = data.scenarios[0];
    expect(firstScenario).toHaveProperty("id");
    expect(firstScenario).toHaveProperty("name");
    expect(firstScenario).toHaveProperty("description");
    expect(firstScenario).toHaveProperty("metadata");
    expect(firstScenario.metadata).toHaveProperty("tags");
    expect(firstScenario.metadata).toHaveProperty("schemaVersion");
  });

  it("should include all registered scenarios", async () => {
    Object.defineProperty(config, "USE_MOCKS", {
      value: true,
      writable: true,
      configurable: true,
    });

    const response = await GET();
    const data = await response.json();

    const scenarioNames = data.scenarios.map((s: any) => s.name);
    expect(scenarioNames).toContain("blank");
    expect(scenarioNames).toContain("simple-mock-user");
    expect(scenarioNames).toContain("multi-user-workspace");
  });
});

describe("POST /api/mock/db/scenario", () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterEach(() => {
    Object.defineProperty(config, "USE_MOCKS", {
      value: originalUseMocks,
      writable: true,
      configurable: true,
    });
  });

  it("should return 403 when USE_MOCKS is false", async () => {
    Object.defineProperty(config, "USE_MOCKS", {
      value: false,
      writable: true,
      configurable: true,
    });

    const request = new NextRequest("http://localhost:3000/api/mock/db/scenario", {
      method: "POST",
      body: JSON.stringify({ scenarioName: "blank" }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toBe("Mock endpoints only available when USE_MOCKS=true");
  });

  it("should return 400 when scenarioName is missing", async () => {
    Object.defineProperty(config, "USE_MOCKS", {
      value: true,
      writable: true,
      configurable: true,
    });

    const request = new NextRequest("http://localhost:3000/api/mock/db/scenario", {
      method: "POST",
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(400);
    expect(data.error).toBe("Invalid request");
  });

  it("should return 404 when scenario does not exist", async () => {
    Object.defineProperty(config, "USE_MOCKS", {
      value: true,
      writable: true,
      configurable: true,
    });

    const request = new NextRequest("http://localhost:3000/api/mock/db/scenario", {
      method: "POST",
      body: JSON.stringify({ scenarioName: "non-existent-scenario" }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(404);
    expect(data.error).toBe("Scenario not found");
  });

  it("should execute blank scenario successfully", async () => {
    Object.defineProperty(config, "USE_MOCKS", {
      value: true,
      writable: true,
      configurable: true,
    });

    const request = new NextRequest("http://localhost:3000/api/mock/db/scenario", {
      method: "POST",
      body: JSON.stringify({ scenarioName: "blank" }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.result.success).toBe(true);
    expect(data.result.message).toContain("Database reset complete");
    expect(data.mockMode).toBe(true);
  });

  it("should execute simple-mock-user scenario and create user", async () => {
    Object.defineProperty(config, "USE_MOCKS", {
      value: true,
      writable: true,
      configurable: true,
    });

    const request = new NextRequest("http://localhost:3000/api/mock/db/scenario", {
      method: "POST",
      body: JSON.stringify({ scenarioName: "simple-mock-user" }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.result.success).toBe(true);
    expect(data.result.data).toHaveProperty("userId");
    expect(data.result.data.email).toBe("dev-user@mock.dev");

    // Verify user was created in database
    const user = await db.user.findUnique({
      where: { email: "dev-user@mock.dev" },
    });
    expect(user).toBeDefined();
    expect(user?.name).toBe("Dev User");
  });

  it("should execute multi-user-workspace scenario and create full environment", async () => {
    Object.defineProperty(config, "USE_MOCKS", {
      value: true,
      writable: true,
      configurable: true,
    });

    const request = new NextRequest("http://localhost:3000/api/mock/db/scenario", {
      method: "POST",
      body: JSON.stringify({ scenarioName: "multi-user-workspace" }),
    });

    const response = await POST(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.result.success).toBe(true);
    expect(data.result.data).toHaveProperty("workspaceId");
    expect(data.result.data).toHaveProperty("workspaceSlug");
    expect(data.result.data.memberCount).toBeGreaterThan(0);
    expect(data.result.data.taskCount).toBeGreaterThan(0);

    // Verify workspace was created
    const workspace = await db.workspace.findUnique({
      where: { slug: data.result.data.workspaceSlug },
      include: {
        members: true,
        tasks: true,
      },
    });

    expect(workspace).toBeDefined();
    expect(workspace?.members.length).toBeGreaterThan(0);
    expect(workspace?.tasks.length).toBeGreaterThan(0);
  });
});
