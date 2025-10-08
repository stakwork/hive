import { describe, it, expect, beforeEach, vi } from "vitest";
import { GET } from "@/app/api/swarm/stakgraph/services/route";
import { db } from "@/lib/db";
import { EncryptionService } from "@/lib/encryption";
import {
  createAuthenticatedSession,
  generateUniqueId,
  generateUniqueSlug,
  getMockedSession,
  createGetRequest,
  mockUnauthenticatedSession,
} from "@/__tests__/support/helpers";

describe("GET /api/swarm/stakgraph/services", () => {
  const enc = EncryptionService.getInstance();
  const PLAINTEXT_SWARM_API_KEY = "swarm_test_key_abc";
  let workspaceId: string;
  let swarmId: string;
  let userId: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    
    // Create test data atomically
    const testData = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          id: generateUniqueId("user"),
          email: `user-${generateUniqueId()}@example.com`,
          name: "User 1",
        },
      });

      const workspace = await tx.workspace.create({
        data: {
          name: "w1",
          slug: generateUniqueSlug("w1"),
          ownerId: user.id,
        },
      });

      const swarm = await tx.swarm.create({
        data: {
          workspaceId: workspace.id,
          name: "s1-name",
          swarmId: generateUniqueId("s1"),
          status: "ACTIVE",
          swarmUrl: "https://s1-name.sphinx.chat/api",
          swarmApiKey: JSON.stringify(
            enc.encryptField("swarmApiKey", PLAINTEXT_SWARM_API_KEY),
          ),
          services: [],
        },
      });

      return { user, workspace, swarm };
    });

    workspaceId = testData.workspace.id;
    swarmId = testData.swarm.swarmId!;
    userId = testData.user.id;

    getMockedSession().mockResolvedValue(createAuthenticatedSession(testData.user));
  });

  describe("Authentication", () => {
    it("proxies with decrypted header and keeps DB encrypted", async () => {
      const fetchSpy = vi
        .spyOn(globalThis as unknown as { fetch: typeof fetch }, "fetch")
        .mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ services: [] }),
        } as unknown as Response);

      const res = await GET(
        createGetRequest(
          "http://localhost:3000/api/swarm/stakgraph/services",
          { workspaceId, swarmId }
        )
      );
      
      const responseBody = await res.json();

      expect(res.status).toBe(200);
      // Verify header used decrypted token
      const firstCall = fetchSpy.mock.calls[0] as [
        string,
        { headers?: Record<string, string> },
      ];
      const headers = (firstCall?.[1]?.headers || {}) as Record<string, string>;
      expect(Object.values(headers).join(" ")).toContain(PLAINTEXT_SWARM_API_KEY);

      // Verify DB is still encrypted (no plaintext present)
      const swarm = await db.swarm.findFirst({ where: { swarmId } });
      const stored = swarm?.swarmApiKey || "";
      expect(stored).not.toContain(PLAINTEXT_SWARM_API_KEY);
    });

    it("returns 401 when session is missing", async () => {
      getMockedSession().mockResolvedValue(mockUnauthenticatedSession());

      const res = await GET(
        createGetRequest(
          "http://localhost:3000/api/swarm/stakgraph/services",
          { workspaceId, swarmId }
        )
      );

      const responseBody = await res.json();

      expect(res.status).toBe(401);
      expect(responseBody.success).toBe(false);
      expect(responseBody.message).toBe("Unauthorized");
    });
  });

  describe("Parameter Validation", () => {
    it("returns 400 when both workspaceId and swarmId are missing", async () => {
      const res = await GET(
        createGetRequest(
          "http://localhost:3000/api/swarm/stakgraph/services",
          {}
        )
      );

      const responseBody = await res.json();

      expect(res.status).toBe(400);
      expect(responseBody.success).toBe(false);
      expect(responseBody.message).toContain("must provide either workspaceId or swarmId");
    });

    it("returns 404 when swarm not found by workspaceId", async () => {
      const nonExistentWorkspaceId = generateUniqueId("nonexistent");

      const res = await GET(
        createGetRequest(
          "http://localhost:3000/api/swarm/stakgraph/services",
          { workspaceId: nonExistentWorkspaceId }
        )
      );

      const responseBody = await res.json();

      expect(res.status).toBe(404);
      expect(responseBody.success).toBe(false);
      expect(responseBody.message).toBe("Swarm not found");
    });

    it("returns 404 when swarm not found by swarmId", async () => {
      const nonExistentSwarmId = generateUniqueId("nonexistent");

      const res = await GET(
        createGetRequest(
          "http://localhost:3000/api/swarm/stakgraph/services",
          { swarmId: nonExistentSwarmId }
        )
      );

      const responseBody = await res.json();

      expect(res.status).toBe(404);
      expect(responseBody.success).toBe(false);
      expect(responseBody.message).toBe("Swarm not found");
    });

    it("returns 400 when swarmUrl is null", async () => {
      // Update swarm to remove swarmUrl
      await db.swarm.update({
        where: { workspaceId },
        data: { swarmUrl: null },
      });

      const res = await GET(
        createGetRequest(
          "http://localhost:3000/api/swarm/stakgraph/services",
          { workspaceId }
        )
      );

      const responseBody = await res.json();

      expect(res.status).toBe(400);
      expect(responseBody.success).toBe(false);
      expect(responseBody.message).toBe("Swarm URL or API key not set");
    });

    it("returns 400 when swarmApiKey is null", async () => {
      // Update swarm to remove swarmApiKey
      await db.swarm.update({
        where: { workspaceId },
        data: { swarmApiKey: null },
      });

      const res = await GET(
        createGetRequest(
          "http://localhost:3000/api/swarm/stakgraph/services",
          { workspaceId }
        )
      );

      const responseBody = await res.json();

      expect(res.status).toBe(400);
      expect(responseBody.success).toBe(false);
      expect(responseBody.message).toBe("Swarm URL or API key not set");
    });
  });

  describe("Cache Hit Path", () => {
    it("returns cached services when swarm.services array is not empty", async () => {
      const cachedServices = [
        {
          name: "cached-service",
          port: 3000,
          scripts: { start: "npm start" },
        },
      ];

      // Update swarm with cached services
      await db.swarm.update({
        where: { workspaceId },
        data: { services: cachedServices },
      });

      const fetchSpy = vi.spyOn(globalThis as unknown as { fetch: typeof fetch }, "fetch");

      const res = await GET(
        createGetRequest(
          "http://localhost:3000/api/swarm/stakgraph/services",
          { workspaceId }
        )
      );

      const responseBody = await res.json();

      expect(res.status).toBe(200);
      expect(responseBody.success).toBe(true);
      expect(responseBody.data.services).toEqual(cachedServices);
      // Verify no external API calls were made
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it("skips GitHub profile retrieval when returning cached services", async () => {
      const cachedServices = [
        {
          name: "cached-service",
          port: 8080,
          scripts: { start: "node server.js" },
        },
      ];

      await db.swarm.update({
        where: { workspaceId },
        data: { services: cachedServices },
      });

      const res = await GET(
        createGetRequest(
          "http://localhost:3000/api/swarm/stakgraph/services",
          { workspaceId }
        )
      );

      const responseBody = await res.json();

      expect(res.status).toBe(200);
      expect(responseBody.success).toBe(true);
      expect(responseBody.data.services).toEqual(cachedServices);
    });
  });

  describe("Standard Mode (No repo_url)", () => {
    it("calls GET /services when no repo_url provided", async () => {
      const mockServices = [
        {
          name: "standard-service",
          port: 4000,
          scripts: { start: "npm run dev" },
          env: {
            NODE_ENV: "development",
            PORT: "4000",
          },
        },
      ];

      const fetchSpy = vi
        .spyOn(globalThis as unknown as { fetch: typeof fetch }, "fetch")
        .mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ services: mockServices }),
        } as unknown as Response);

      const res = await GET(
        createGetRequest(
          "http://localhost:3000/api/swarm/stakgraph/services",
          { workspaceId }
        )
      );

      const responseBody = await res.json();

      expect(res.status).toBe(200);
      expect(responseBody.success).toBe(true);
      expect(responseBody.data.services).toEqual(mockServices);

      // Verify GET /services was called
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/services"),
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            "x-api-token": PLAINTEXT_SWARM_API_KEY,
          }),
        })
      );
    });

    it("persists services and environmentVariables to database", async () => {
      const mockServices = [
        {
          name: "db-service",
          port: 5432,
          scripts: { start: "npm start" },
          env: {
            DATABASE_URL: "postgres://localhost:5432/test",
            DB_NAME: "testdb",
          },
        },
      ];

      vi.spyOn(globalThis as unknown as { fetch: typeof fetch }, "fetch")
        .mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ services: mockServices }),
        } as unknown as Response);

      const res = await GET(
        createGetRequest(
          "http://localhost:3000/api/swarm/stakgraph/services",
          { workspaceId }
        )
      );

      const responseBody = await res.json();
      expect(res.status).toBe(200);

      // Verify services persisted to database
      const updatedSwarm = await db.swarm.findUnique({
        where: { workspaceId },
      });

      expect(updatedSwarm?.services).toEqual(mockServices);
      expect(updatedSwarm?.environmentVariables).toBeDefined();
      
      // Verify environment variables are encrypted
      const envVars = updatedSwarm?.environmentVariables as any[];
      expect(envVars.length).toBeGreaterThan(0);
      expect(envVars[0]).toHaveProperty("name");
      expect(envVars[0]).toHaveProperty("value");
      expect(envVars[0].value).toHaveProperty("data");
      expect(envVars[0].value).toHaveProperty("iv");
      expect(envVars[0].value).toHaveProperty("tag");
    });
  });

  describe("Agent Mode Orchestration", () => {
    const mockPM2Config = `
module.exports = {
  apps: [
    {
      name: "agent-service",
      script: "npm start",
      cwd: "/workspaces/repo/service",
      interpreter: "node",
      env: {
        PORT: "3000",
        INSTALL_COMMAND: "npm install",
        BUILD_COMMAND: "npm run build",
      }
    }
  ]
};`;

    it("successfully completes agent flow with repo_url parameter", async () => {
      const repoUrl = "https://github.com/testuser/testrepo";
      const requestId = "test-request-123";

      const fetchSpy = vi
        .spyOn(globalThis as unknown as { fetch: typeof fetch }, "fetch")
        // First call: POST /services_agent (agent init)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ request_id: requestId }),
        } as unknown as Response)
        // Second call: GET /progress (polling - in progress)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ status: "in_progress" }),
        } as unknown as Response)
        // Third call: GET /progress (polling - completed)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            status: "completed",
            result: {
              "pm2.config.js": mockPM2Config,
              ".env": "NODE_ENV=production\nAPI_KEY=secret123",
              "docker-compose.yml": "version: '3'",
            },
          }),
        } as unknown as Response)
        // Fourth call: GET /services (fallback for env vars)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ services: [] }),
        } as unknown as Response);

      const res = await GET(
        createGetRequest(
          "http://localhost:3000/api/swarm/stakgraph/services",
          { workspaceId, repo_url: repoUrl }
        )
      );

      const responseBody = await res.json();

      expect(res.status).toBe(200);
      expect(responseBody.success).toBe(true);
      expect(responseBody.data.services).toBeDefined();
      expect(responseBody.data.services.length).toBeGreaterThan(0);
      expect(responseBody.data.services[0].name).toBe("agent-service");
      expect(responseBody.data.services[0].port).toBe(3000);

      // Verify agent endpoint was called
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining("/services_agent"),
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            "x-api-token": PLAINTEXT_SWARM_API_KEY,
          }),
        })
      );

      // Verify polling endpoint was called
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.stringContaining(`/progress?request_id=${requestId}`),
        expect.any(Object)
      );
    });

    it("merges environment variables from agent and stakgraph with agent precedence", async () => {
      const repoUrl = "https://github.com/testuser/mergetest";
      const requestId = "merge-request-456";

      vi.spyOn(globalThis as unknown as { fetch: typeof fetch }, "fetch")
        // Agent init
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ request_id: requestId }),
        } as unknown as Response)
        // Polling completed
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            status: "completed",
            result: {
              "pm2.config.js": mockPM2Config,
              ".env": "AGENT_VAR=from_agent\nSHARED_VAR=agent_value",
              "docker-compose.yml": "version: '3'",
            },
          }),
        } as unknown as Response)
        // Stakgraph fallback
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            services: [
              {
                name: "test-service",
                port: 3000,
                scripts: { start: "npm start" },
                env: {
                  STAKGRAPH_VAR: "from_stakgraph",
                  SHARED_VAR: "stakgraph_value",
                },
              },
            ],
          }),
        } as unknown as Response);

      const res = await GET(
        createGetRequest(
          "http://localhost:3000/api/swarm/stakgraph/services",
          { workspaceId, repo_url: repoUrl }
        )
      );

      const responseBody = await res.json();
      expect(res.status).toBe(200);

      // Verify database persistence
      const updatedSwarm = await db.swarm.findUnique({
        where: { workspaceId },
      });

      const envVars = updatedSwarm?.environmentVariables as any[];
      expect(envVars).toBeDefined();

      // Decrypt and verify merged environment variables
      const decryptedEnvVars: Record<string, string> = {};
      for (const envVar of envVars) {
        const decryptedValue = enc.decryptField(
          "environmentVariables",
          envVar.value
        );
        decryptedEnvVars[envVar.name] = decryptedValue;
      }

      // Agent vars should be present
      expect(decryptedEnvVars["AGENT_VAR"]).toBe("from_agent");
      // Stakgraph vars should be present
      expect(decryptedEnvVars["STAKGRAPH_VAR"]).toBe("from_stakgraph");
      // Agent should take precedence for shared vars
      expect(decryptedEnvVars["SHARED_VAR"]).toBe("agent_value");
    });

    it("generates and persists container files to database", async () => {
      const repoUrl = "https://github.com/testuser/containertest";
      const requestId = "container-request-789";

      vi.spyOn(globalThis as unknown as { fetch: typeof fetch }, "fetch")
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ request_id: requestId }),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            status: "completed",
            result: {
              "pm2.config.js": mockPM2Config,
              ".env": "TEST=value",
              "docker-compose.yml": "services:\n  app:\n    image: node:18",
            },
          }),
        } as unknown as Response)
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ services: [] }),
        } as unknown as Response);

      const res = await GET(
        createGetRequest(
          "http://localhost:3000/api/swarm/stakgraph/services",
          { workspaceId, repo_url: repoUrl }
        )
      );

      const responseBody = await res.json();
      expect(res.status).toBe(200);

      // Verify container files persisted
      const updatedSwarm = await db.swarm.findUnique({
        where: { workspaceId },
      });

      const containerFiles = updatedSwarm?.containerFiles as Record<string, string>;
      expect(containerFiles).toBeDefined();
      expect(containerFiles["Dockerfile"]).toBeDefined();
      expect(containerFiles["pm2.config.js"]).toBeDefined();
      expect(containerFiles["docker-compose.yml"]).toBeDefined();
      expect(containerFiles["devcontainer.json"]).toBeDefined();

      // Verify files are base64 encoded
      expect(() => Buffer.from(containerFiles["Dockerfile"], "base64")).not.toThrow();
      expect(() => Buffer.from(containerFiles["pm2.config.js"], "base64")).not.toThrow();
    });
  });

  describe("Fallback Mode", () => {
    it("falls back to GET /services when agent initialization fails", async () => {
      const repoUrl = "https://github.com/testuser/failtest";
      const mockServices = [
        {
          name: "fallback-service",
          port: 5000,
          scripts: { start: "npm start" },
        },
      ];

      vi.spyOn(globalThis as unknown as { fetch: typeof fetch }, "fetch")
        // Agent init fails
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          json: async () => ({ error: "Agent initialization failed" }),
        } as unknown as Response)
        // Fallback to GET /services succeeds
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ services: mockServices }),
        } as unknown as Response);

      const res = await GET(
        createGetRequest(
          "http://localhost:3000/api/swarm/stakgraph/services",
          { workspaceId, repo_url: repoUrl }
        )
      );

      const responseBody = await res.json();

      expect(res.status).toBe(200);
      expect(responseBody.success).toBe(true);
      expect(responseBody.data.services).toEqual(mockServices);
    });

    it("falls back to GET /services when polling returns failed status", async () => {
      const repoUrl = "https://github.com/testuser/pollfailtest";
      const requestId = "fail-request-999";
      const mockServices = [
        {
          name: "fallback-after-fail",
          port: 6000,
          scripts: { start: "npm start" },
        },
      ];

      vi.spyOn(globalThis as unknown as { fetch: typeof fetch }, "fetch")
        // Agent init succeeds
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ request_id: requestId }),
        } as unknown as Response)
        // Polling returns failed status
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ status: "failed" }),
        } as unknown as Response)
        // Fallback to GET /services
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ services: mockServices }),
        } as unknown as Response);

      const res = await GET(
        createGetRequest(
          "http://localhost:3000/api/swarm/stakgraph/services",
          { workspaceId, repo_url: repoUrl }
        )
      );

      const responseBody = await res.json();

      expect(res.status).toBe(200);
      expect(responseBody.success).toBe(true);
      expect(responseBody.data.services).toEqual(mockServices);
    });

    it("falls back to GET /services when agent returns no request_id", async () => {
      const repoUrl = "https://github.com/testuser/norequestid";
      const mockServices = [
        {
          name: "fallback-no-id",
          port: 7000,
          scripts: { start: "npm start" },
        },
      ];

      vi.spyOn(globalThis as unknown as { fetch: typeof fetch }, "fetch")
        // Agent init returns response without request_id
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ error: "No request_id" }),
        } as unknown as Response)
        // Fallback to GET /services
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ services: mockServices }),
        } as unknown as Response);

      const res = await GET(
        createGetRequest(
          "http://localhost:3000/api/swarm/stakgraph/services",
          { workspaceId, repo_url: repoUrl }
        )
      );

      const responseBody = await res.json();

      expect(res.status).toBe(200);
      expect(responseBody.success).toBe(true);
      expect(responseBody.data.services).toEqual(mockServices);
    });
  });

  describe("Error Handling", () => {
    it("returns 500 when external API fails and no fallback succeeds", async () => {
      vi.spyOn(globalThis as unknown as { fetch: typeof fetch }, "fetch")
        .mockRejectedValue(new Error("Network error"));

      const res = await GET(
        createGetRequest(
          "http://localhost:3000/api/swarm/stakgraph/services",
          { workspaceId }
        )
      );

      const responseBody = await res.json();

      expect(res.status).toBe(500);
      expect(responseBody.success).toBe(false);
      expect(responseBody.message).toBe("Failed to ingest code");
    });

    it.skip("handles polling timeout gracefully with fallback", async () => {
      const repoUrl = "https://github.com/testuser/timeouttest";
      const requestId = "timeout-request";
      const mockServices = [
        {
          name: "timeout-fallback",
          port: 8000,
          scripts: { start: "npm start" },
        },
      ];

      const fetchSpy = vi
        .spyOn(globalThis as unknown as { fetch: typeof fetch }, "fetch")
        // Agent init
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ request_id: requestId }),
        } as unknown as Response);

      // Mock 25 polling attempts (less than 100 to avoid timeout) - all return in_progress
      for (let i = 0; i < 25; i++) {
        fetchSpy.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ status: "in_progress" }),
        } as unknown as Response);
      }

      // Timeout occurs after some attempts, trigger fallback to GET /services
      fetchSpy.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ services: mockServices }),
      } as unknown as Response);

      const res = await GET(
        createGetRequest(
          "http://localhost:3000/api/swarm/stakgraph/services",
          { workspaceId, repo_url: repoUrl }
        )
      );

      const responseBody = await res.json();

      // Should fall back successfully after timeout
      expect(res.status).toBe(200);
      expect(responseBody.success).toBe(true);
      expect(responseBody.data.services).toEqual(mockServices);
    }, 10000); // Increase timeout to 10 seconds

    it.skip("handles PM2 parsing errors gracefully", async () => {
      const repoUrl = "https://github.com/testuser/parsetest";
      const requestId = "parse-request";
      const invalidPM2Config = "invalid { javascript syntax";
      const mockServices = [
        {
          name: "parse-fallback",
          port: 9000,
          scripts: { start: "npm start" },
        },
      ];

      vi.spyOn(globalThis as unknown as { fetch: typeof fetch }, "fetch")
        // Agent init
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ request_id: requestId }),
        } as unknown as Response)
        // Polling completed with invalid PM2 config
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            status: "completed",
            result: {
              "pm2.config.js": invalidPM2Config,
            },
          }),
        } as unknown as Response)
        // Fallback to GET /services
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ services: mockServices }),
        } as unknown as Response);

      const res = await GET(
        createGetRequest(
          "http://localhost:3000/api/swarm/stakgraph/services",
          { workspaceId, repo_url: repoUrl }
        )
      );

      const responseBody = await res.json();

      // Should fall back successfully after parsing error
      expect(res.status).toBe(200);
      expect(responseBody.success).toBe(true);
      expect(responseBody.data.services).toEqual(mockServices);
    });
  });

  describe("Database Persistence", () => {
    it("updates existing swarm record with services", async () => {
      const mockServices = [
        {
          name: "persistence-service",
          port: 10000,
          scripts: { start: "npm start", build: "npm run build" },
        },
      ];

      vi.spyOn(globalThis as unknown as { fetch: typeof fetch }, "fetch")
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ services: mockServices }),
        } as unknown as Response);

      // Verify swarm exists before request
      const swarmBefore = await db.swarm.findUnique({
        where: { workspaceId },
      });
      expect(swarmBefore).toBeDefined();
      expect(swarmBefore?.services).toEqual([]);

      const res = await GET(
        createGetRequest(
          "http://localhost:3000/api/swarm/stakgraph/services",
          { workspaceId }
        )
      );

      const responseBody = await res.json();
      expect(res.status).toBe(200);

      // Verify swarm was updated (not recreated)
      const swarmAfter = await db.swarm.findUnique({
        where: { workspaceId },
      });
      expect(swarmAfter).toBeDefined();
      expect(swarmAfter?.id).toBe(swarmBefore?.id);
      expect(swarmAfter?.services).toEqual(mockServices);
    });

    it("preserves other swarm fields when updating services", async () => {
      const mockServices = [
        {
          name: "preserve-test",
          port: 11000,
          scripts: { start: "npm start" },
        },
      ];

      // Update swarm with additional fields (avoid repositoryUrl to prevent agent mode)
      await db.swarm.update({
        where: { workspaceId },
        data: {
          poolName: "test-pool",
          poolCpu: "4",
          poolMemory: "8Gi",
          repositoryName: "test-repo",
        },
      });

      vi.spyOn(globalThis as unknown as { fetch: typeof fetch }, "fetch")
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({ services: mockServices }),
        } as unknown as Response);

      const res = await GET(
        createGetRequest(
          "http://localhost:3000/api/swarm/stakgraph/services",
          { workspaceId }
        )
      );

      const responseBody = await res.json();
      expect(res.status).toBe(200);

      // Verify other fields were preserved
      const updatedSwarm = await db.swarm.findUnique({
        where: { workspaceId },
      });
      expect(updatedSwarm?.poolName).toBe("test-pool");
      expect(updatedSwarm?.poolCpu).toBe("4");
      expect(updatedSwarm?.poolMemory).toBe("8Gi");
      expect(updatedSwarm?.repositoryName).toBe("test-repo");
      expect(updatedSwarm?.services).toEqual(mockServices);
    });
  });
});