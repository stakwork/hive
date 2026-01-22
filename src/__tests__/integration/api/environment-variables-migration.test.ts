import { describe, it, expect, beforeEach, vi } from "vitest";
import { PUT as PUT_STAK } from "@/app/api/workspaces/[slug]/stakgraph/route";
import { db } from "@/lib/db";
import { decryptEnvVars, encryptEnvVars } from "@/lib/encryption";
import {
  createAuthenticatedSession,
  generateUniqueSlug,
  createPutRequest,
  expectSuccess,
  getMockedSession,
  generateUniqueId,
} from "@/__tests__/support/helpers";

// Mock pool manager services
vi.mock("@/services/pool-manager/sync", () => ({
  syncPoolManagerSettings: vi.fn().mockResolvedValue({ success: true }),
}));

// Mock GitHub webhook service
vi.mock("@/services/github/WebhookService", () => ({
  WebhookService: vi.fn().mockImplementation(() => ({
    ensureRepoWebhook: vi.fn().mockResolvedValue({ id: 123, secret: "webhook-secret" }),
    setupRepositoryWithWebhook: vi.fn().mockResolvedValue({
      repositoryId: "mock-repo-id",
      defaultBranch: "main",
      webhookId: 12345,
    }),
  })),
}));

describe("Environment Variables Migration", () => {
  let workspaceId: string;
  let swarmId: string;
  let slug: string;
  let userId: string;

  beforeEach(async () => {
    // Create test user
    const user = await db.user.create({
      data: {
        id: generateUniqueId("user"),
        email: `test-user-${generateUniqueId()}@example.com`,
        name: "Test User",
      },
    });
    userId = user.id;

    // Mock authenticated session
    getMockedSession().mockResolvedValue(createAuthenticatedSession(user));

    slug = generateUniqueSlug();

    const workspace = await db.workspace.create({
      data: {
        name: "Test Workspace",
        slug,
        ownerId: userId,
      },
    });
    workspaceId = workspace.id;

    // Create repository for the workspace
    await db.repository.create({
      data: {
        name: "test-repo",
        repositoryUrl: "https://github.com/test/repo",
        branch: "main",
        workspaceId,
      },
    });

    // Create swarm with old-style JSON environment variables
    const swarm = await db.swarm.create({
      data: {
        name: "test-swarm",
        workspaceId,
        status: "ACTIVE",
        poolName: "test-pool",
        environmentVariables: JSON.stringify(
          encryptEnvVars([
            { name: "API_KEY", value: "secret123" },
            { name: "DB_HOST", value: "localhost" },
            { name: "PORT", value: "3000" },
          ])
        ),
        services: JSON.stringify([
          {
            name: "frontend",
            port: 3000,
            scripts: { start: "npm start" },
          },
        ]),
      },
    });
    swarmId = swarm.id;
  });

  it("should migrate environment variables from JSON field to new table on first save", async () => {
    // Verify initial state - no records in new table
    const initialCount = await db.environmentVariable.count({
      where: { swarmId },
    });
    expect(initialCount).toBe(0);

    // Make PUT request with environment variables
    const request = createPutRequest(
      `http://localhost:3000/api/workspaces/${slug}/stakgraph`,
      {
        environmentVariables: [
          { name: "API_KEY", value: "secret123" },
          { name: "DB_HOST", value: "localhost" },
          { name: "PORT", value: "3000" },
        ],
      }
    );

    const response = await PUT_STAK(request, {
      params: Promise.resolve({ slug }),
    });
    expectSuccess(response);

    // Verify migration - records should now exist in new table
    const migratedVars = await db.environmentVariable.findMany({
      where: { swarmId },
      orderBy: { name: "asc" },
    });

    expect(migratedVars).toHaveLength(3);
    expect(migratedVars[0].serviceName).toBe(""); // Global scope
    expect(migratedVars[0].name).toBe("API_KEY");
    expect(migratedVars[1].name).toBe("DB_HOST");
    expect(migratedVars[2].name).toBe("PORT");

    // Verify values are encrypted (stored as JSON string)
    expect(migratedVars[0].value).toContain('"keyId"');
    expect(migratedVars[0].value).toContain('"data"');

    // Verify old JSON field is KEPT for backward compatibility (not cleared)
    const swarm = await db.swarm.findUnique({
      where: { id: swarmId },
      select: { environmentVariables: true },
    });
    
    // Should be an array (not empty) with encrypted values
    expect(Array.isArray(swarm?.environmentVariables)).toBe(true);
    if (Array.isArray(swarm?.environmentVariables)) {
      expect(swarm.environmentVariables.length).toBe(3);
      // Verify it contains encrypted data structure
      expect(swarm.environmentVariables[0]).toHaveProperty('name');
      expect(swarm.environmentVariables[0]).toHaveProperty('value');
    }
  });

  it("should handle idempotent migration - update existing records on subsequent saves", async () => {
    // First save - initial migration
    const request1 = createPutRequest(
      `http://localhost:3000/api/workspaces/${slug}/stakgraph`,
      {
        environmentVariables: [
          { name: "API_KEY", value: "secret123" },
          { name: "DB_HOST", value: "localhost" },
        ],
      }
    );

    await PUT_STAK(request1, {
      params: Promise.resolve({ slug }),
    });

    const firstCount = await db.environmentVariable.count({
      where: { swarmId },
    });
    expect(firstCount).toBe(2);

    // Second save - should replace existing records
    const request2 = createPutRequest(
      `http://localhost:3000/api/workspaces/${slug}/stakgraph`,
      {
        environmentVariables: [
          { name: "API_KEY", value: "newsecret456" },
          { name: "DB_HOST", value: "prod-server" },
          { name: "NEW_VAR", value: "newvalue" },
        ],
      }
    );

    const response2 = await PUT_STAK(request2, {
      params: Promise.resolve({ slug }),
    });
    expectSuccess(response2);

    // Verify updated records
    const updatedVars = await db.environmentVariable.findMany({
      where: { swarmId },
      orderBy: { name: "asc" },
    });

    expect(updatedVars).toHaveLength(3);
    expect(updatedVars[0].name).toBe("API_KEY");
    expect(updatedVars[1].name).toBe("DB_HOST");
    expect(updatedVars[2].name).toBe("NEW_VAR");

    // Decrypt and verify values changed
    const decrypted = updatedVars.map((v) => ({
      name: v.name,
      value: JSON.parse(v.value),
    }));
    const plainVars = decryptEnvVars(decrypted);

    expect(plainVars[0].value).toBe("newsecret456");
    expect(plainVars[1].value).toBe("prod-server");
    expect(plainVars[2].value).toBe("newvalue");
  });

  it("should handle empty environment variables array", async () => {
    const request = createPutRequest(
      `http://localhost:3000/api/workspaces/${slug}/stakgraph`,
      {
        environmentVariables: [],
      }
    );

    const response = await PUT_STAK(request, {
      params: Promise.resolve({ slug }),
    });
    expectSuccess(response);

    // No records should be created for empty array
    const count = await db.environmentVariable.count({
      where: { swarmId },
    });
    expect(count).toBe(0);
  });

  it("should handle undefined environment variables", async () => {
    const request = createPutRequest(
      `http://localhost:3000/api/workspaces/${slug}/stakgraph`,
      {
        services: [
          {
            name: "api",
            port: 4000,
            scripts: { start: "npm start" },
          },
        ],
        // environmentVariables not provided
      }
    );

    const response = await PUT_STAK(request, {
      params: Promise.resolve({ slug }),
    });
    expectSuccess(response);

    // No migration should occur if environmentVariables not provided
    const count = await db.environmentVariable.count({
      where: { swarmId },
    });
    expect(count).toBe(0);
  });

  it("should store all env vars with empty serviceName for global scope", async () => {
    const request = createPutRequest(
      `http://localhost:3000/api/workspaces/${slug}/stakgraph`,
      {
        environmentVariables: [
          { name: "GLOBAL_VAR1", value: "value1" },
          { name: "GLOBAL_VAR2", value: "value2" },
        ],
      }
    );

    await PUT_STAK(request, {
      params: Promise.resolve({ slug }),
    });

    const vars = await db.environmentVariable.findMany({
      where: { swarmId },
    });

    // All should have empty string for serviceName (global scope)
    expect(vars.every((v) => v.serviceName === "")).toBe(true);
  });

  it("should handle migration with special characters in values", async () => {
    const request = createPutRequest(
      `http://localhost:3000/api/workspaces/${slug}/stakgraph`,
      {
        environmentVariables: [
          { name: "DB_URL", value: "postgres://user:p@ss!w0rd@localhost:5432/db" },
          { name: "JSON_CONFIG", value: '{"key":"value","nested":{"data":true}}' },
          { name: "MULTILINE", value: "line1\nline2\nline3" },
        ],
      }
    );

    const response = await PUT_STAK(request, {
      params: Promise.resolve({ slug }),
    });
    expectSuccess(response);

    const vars = await db.environmentVariable.findMany({
      where: { swarmId },
      orderBy: { name: "asc" },
    });

    expect(vars).toHaveLength(3);

    // Decrypt and verify special characters preserved
    const decrypted = vars.map((v) => ({
      name: v.name,
      value: JSON.parse(v.value),
    }));
    const plainVars = decryptEnvVars(decrypted);

    expect(plainVars[0].value).toBe("postgres://user:p@ss!w0rd@localhost:5432/db");
    expect(plainVars[1].value).toBe('{"key":"value","nested":{"data":true}}');
    expect(plainVars[2].value).toBe("line1\nline2\nline3");
  });

  it("should enforce unique constraint on (swarmId, serviceName, name)", async () => {
    // First create a record
    const encrypted = encryptEnvVars([{ name: "TEST_VAR", value: "value1" }]);
    await db.environmentVariable.create({
      data: {
        swarmId,
        serviceName: "",
        name: "TEST_VAR",
        value: JSON.stringify(encrypted[0].value),
      },
    });

    // Try to create duplicate (should fail due to unique constraint)
    try {
      await db.environmentVariable.create({
        data: {
          swarmId,
          serviceName: "",
          name: "TEST_VAR",
          value: JSON.stringify(encrypted[0].value),
        },
      });
      // If we get here, the test should fail
      expect.fail("Expected unique constraint violation but none occurred");
    } catch (error: any) {
      // Verify it's the expected unique constraint error
      expect(error.code).toBe("P2002"); // Prisma unique constraint violation code
      expect(error.meta?.target).toContain("swarm_id");
      expect(error.meta?.target).toContain("service_name");
      expect(error.meta?.target).toContain("name");
    }
  });

  it("should allow same variable name for different service scopes", async () => {
    // This test demonstrates the unique constraint allows same name with different serviceName
    const encrypted = encryptEnvVars([{ name: "PORT", value: "3000" }]);

    // Global scope
    await db.environmentVariable.create({
      data: {
        swarmId,
        serviceName: "",
        name: "PORT",
        value: JSON.stringify(encrypted[0].value),
      },
    });

    // Service-specific scope (for future service-level env vars)
    const encrypted2 = encryptEnvVars([{ name: "PORT", value: "4000" }]);
    await db.environmentVariable.create({
      data: {
        swarmId,
        serviceName: "api",
        name: "PORT",
        value: JSON.stringify(encrypted2[0].value),
      },
    });

    const vars = await db.environmentVariable.findMany({
      where: { swarmId, name: "PORT" },
      orderBy: { serviceName: "asc" },
    });

    expect(vars).toHaveLength(2);
    expect(vars[0].serviceName).toBe(""); // Global
    expect(vars[1].serviceName).toBe("api"); // Service-specific
  });

  it("should keep old JSON field for backward compatibility after migration", async () => {
    // Verify swarm has old JSON data
    const beforeSwarm = await db.swarm.findUnique({
      where: { id: swarmId },
      select: { environmentVariables: true },
    });
    expect(beforeSwarm?.environmentVariables).not.toEqual([]);

    // Trigger migration
    const request = createPutRequest(
      `http://localhost:3000/api/workspaces/${slug}/stakgraph`,
      {
        environmentVariables: [
          { name: "VAR1", value: "value1" },
        ],
      }
    );

    await PUT_STAK(request, {
      params: Promise.resolve({ slug }),
    });

    // Verify old field is KEPT for backward compatibility
    const afterSwarm = await db.swarm.findUnique({
      where: { id: swarmId },
      select: { environmentVariables: true },
    });
    
    // Should still have data (not cleared)
    expect(afterSwarm?.environmentVariables).not.toEqual([]);
    
    // Verify new table also has the data
    const newTableVars = await db.environmentVariable.findMany({
      where: { swarmId },
    });
    expect(newTableVars).toHaveLength(1);
  });

  it("should delete old records before creating new ones during update", async () => {
    // Initial migration
    const request1 = createPutRequest(
      `http://localhost:3000/api/workspaces/${slug}/stakgraph`,
      {
        environmentVariables: [
          { name: "VAR1", value: "value1" },
          { name: "VAR2", value: "value2" },
          { name: "VAR3", value: "value3" },
        ],
      }
    );

    await PUT_STAK(request1, {
      params: Promise.resolve({ slug }),
    });

    const initialVars = await db.environmentVariable.findMany({
      where: { swarmId },
    });
    expect(initialVars).toHaveLength(3);

    // Update with fewer variables
    const request2 = createPutRequest(
      `http://localhost:3000/api/workspaces/${slug}/stakgraph`,
      {
        environmentVariables: [
          { name: "VAR1", value: "updated1" },
        ],
      }
    );

    await PUT_STAK(request2, {
      params: Promise.resolve({ slug }),
    });

    const updatedVars = await db.environmentVariable.findMany({
      where: { swarmId },
    });

    // Should have only 1 variable now
    expect(updatedVars).toHaveLength(1);
    expect(updatedVars[0].name).toBe("VAR1");
  });
});
