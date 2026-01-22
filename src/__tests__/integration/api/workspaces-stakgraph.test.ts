import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  GET as GET_STAK,
  PUT as PUT_STAK,
} from "@/app/api/workspaces/[slug]/stakgraph/route";
import { db } from "@/lib/db";
import { encryptEnvVars, EncryptionService } from "@/lib/encryption";
import {
  createAuthenticatedSession,
  generateUniqueId,
  generateUniqueSlug,
  getMockedSession,
  createGetRequest,
  createPutRequest,
  expectSuccess,
} from "@/__tests__/support/helpers";

// Test fixtures for PM2 config and container files
const DEFAULT_PM2_CONFIG = `module.exports = {
  apps: [
    {
      name: "frontend",
      script: "bin/rails",
      args: "server -b 0.0.0.0 -p 3000",
      cwd: "/workspaces/acme",
      interpreter: "/usr/local/rvm/rubies/ruby-3.3.10/bin/ruby",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        PORT: "3000",
        INSTALL_COMMAND: "bundle install",
        BUILD_COMMAND: "echo 'Build not needed'",
        PRE_START_COMMAND: "echo 'Skipping db:prepare'"
      }
    },
    {
      name: "sidekiq",
      script: "bin/worker",
      cwd: "/workspaces/acme",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        PORT: "0"
      }
    }
  ],
};`;

const UPDATED_PM2_CONFIG = `module.exports = {
  apps: [
    {
      name: "api",
      script: "npm",
      args: "start",
      cwd: "/workspaces/acme",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        PORT: "4000",
        INSTALL_COMMAND: "npm install"
      }
    }
  ],
};`;

const DEFAULT_SERVICES = [
  {
    name: "frontend",
    port: 3000,
    scripts: {
      start: "bin/rails server -b 0.0.0.0 -p 3000",
      install: "bundle install",
      build: "echo 'Build not needed'",
      preStart: "echo 'Skipping db:prepare'",
    },
    interpreter: "/usr/local/rvm/rubies/ruby-3.3.10/bin/ruby",
    cwd: "",
  },
  {
    name: "sidekiq",
    port: 0,
    scripts: {
      start: "bin/worker",
    },
    cwd: "",
  },
];

const DEFAULT_DOCKERFILE =
  "FROM ghcr.io/stakwork/staklink-universal:latest\nRUN echo 'original'";
const UPDATED_DOCKERFILE = "FROM node:20-alpine\nRUN echo 'updated'";
const DEFAULT_DOCKER_COMPOSE =
  "version: '3.8'\nservices:\n  app:\n    build: .";

// Helper to base64 encode strings
const toBase64 = (str: string) => Buffer.from(str).toString("base64");
const fromBase64 = (str: string) => Buffer.from(str, "base64").toString("utf-8");

const encryptionService = EncryptionService.getInstance();

describe("/api/workspaces/[slug]/stakgraph", () => {
  const PLAINTEXT_ENV = [{ name: "SECRET", value: "my_value" }];
  let testData: {
    user: any;
    workspace: any;
    swarm: any;
    repository: any;
  };

  beforeEach(async () => {
    vi.clearAllMocks();

    // Use transaction to atomically create test data with services and containerFiles
    testData = await db.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          id: generateUniqueId("user"),
          email: `user-${generateUniqueId()}@example.com`,
          name: "Test User",
        },
      });

      const workspace = await tx.workspace.create({
        data: {
          name: "Test Workspace",
          slug: generateUniqueSlug("test-ws"),
          ownerId: user.id,
        },
      });

      // Create repository for repoName extraction
      const repository = await tx.repository.create({
        data: {
          workspaceId: workspace.id,
          repositoryUrl: "https://github.com/testorg/acme",
          branch: "main",
          name: "acme",
        },
      });

      const swarm = await tx.swarm.create({
        data: {
          workspaceId: workspace.id,
          name: generateUniqueId("swarm"),
          status: "ACTIVE",
          swarmUrl: "https://test.sphinx.chat",
          poolCpu: "2",
          poolMemory: "8Gi",
          poolApiKey: JSON.stringify(encryptionService.encryptField("poolApiKey", "test-pool-key")),
          environmentVariables: encryptEnvVars(PLAINTEXT_ENV as any) as any,
          services: DEFAULT_SERVICES,
          containerFiles: {
            "pm2.config.js": toBase64(DEFAULT_PM2_CONFIG),
            Dockerfile: toBase64(DEFAULT_DOCKERFILE),
            "docker-compose.yml": toBase64(DEFAULT_DOCKER_COMPOSE),
          },
          agentRequestId: null,
          agentStatus: null,
        },
      });

      return { user, workspace, swarm, repository };
    });

    getMockedSession().mockResolvedValue(
      createAuthenticatedSession(testData.user)
    );
  });

  describe("GET /api/workspaces/[slug]/stakgraph", () => {
    it("returns decrypted env vars but DB remains encrypted", async () => {
      const req = createGetRequest(
        `http://localhost:3000/api/workspaces/${testData.workspace.slug}/stakgraph`
      );
      const res = await GET_STAK(req, {
        params: Promise.resolve({ slug: testData.workspace.slug }),
      });
      const response = await expectSuccess(res, 200);

      expect(response.data.environmentVariables).toEqual(PLAINTEXT_ENV);

      // Verify DB remains encrypted
      const swarm = await db.swarm.findFirst({
        where: { name: testData.swarm.name },
      });
      const stored = swarm?.environmentVariables as unknown as string;
      expect(JSON.stringify(stored)).not.toContain("my_value");
    });
  });

  describe("PUT /api/workspaces/[slug]/stakgraph - Partial Updates", () => {
    describe("containerFiles partial updates", () => {
      it("updates only Dockerfile when only Dockerfile sent", async () => {
        const newDockerfile = toBase64(UPDATED_DOCKERFILE);

        const req = createPutRequest(
          `http://localhost:3000/api/workspaces/${testData.workspace.slug}/stakgraph`,
          { containerFiles: { Dockerfile: newDockerfile } }
        );

        const res = await PUT_STAK(req, {
          params: Promise.resolve({ slug: testData.workspace.slug }),
        });
        const response = await expectSuccess(res, 200);
        expect(response.success).toBe(true);

        // Verify in database
        const swarm = await db.swarm.findUnique({
          where: { workspaceId: testData.workspace.id },
        });
        const containerFiles = swarm?.containerFiles as Record<string, string>;

        // Dockerfile should be updated
        expect(containerFiles["Dockerfile"]).toBe(newDockerfile);

        // Other files should be unchanged
        expect(containerFiles["pm2.config.js"]).toBe(toBase64(DEFAULT_PM2_CONFIG));
        expect(containerFiles["docker-compose.yml"]).toBe(toBase64(DEFAULT_DOCKER_COMPOSE));

        // Services should be unchanged
        const services = swarm?.services as any[];
        expect(services).toHaveLength(2);
        expect(services.map((s) => s.name)).toEqual(["frontend", "sidekiq"]);
      });

      it("updates docker-compose.yml without affecting other files", async () => {
        const newDockerCompose = toBase64(
          "version: '3.8'\nservices:\n  app:\n    build: .\n    ports:\n      - '3000:3000'"
        );

        const req = createPutRequest(
          `http://localhost:3000/api/workspaces/${testData.workspace.slug}/stakgraph`,
          { containerFiles: { "docker-compose.yml": newDockerCompose } }
        );

        const res = await PUT_STAK(req, {
          params: Promise.resolve({ slug: testData.workspace.slug }),
        });
        await expectSuccess(res, 200);

        const swarm = await db.swarm.findUnique({
          where: { workspaceId: testData.workspace.id },
        });
        const containerFiles = swarm?.containerFiles as Record<string, string>;

        expect(containerFiles["docker-compose.yml"]).toBe(newDockerCompose);
        expect(containerFiles["Dockerfile"]).toBe(toBase64(DEFAULT_DOCKERFILE));
        expect(containerFiles["pm2.config.js"]).toBe(toBase64(DEFAULT_PM2_CONFIG));
      });

      it("updates multiple non-pm2 containerFiles at once", async () => {
        const newDockerfile = toBase64(UPDATED_DOCKERFILE);
        const newDockerCompose = toBase64("version: '3.9'\nservices:\n  updated: true");

        const req = createPutRequest(
          `http://localhost:3000/api/workspaces/${testData.workspace.slug}/stakgraph`,
          {
            containerFiles: {
              Dockerfile: newDockerfile,
              "docker-compose.yml": newDockerCompose,
            },
          }
        );

        const res = await PUT_STAK(req, {
          params: Promise.resolve({ slug: testData.workspace.slug }),
        });
        await expectSuccess(res, 200);

        const swarm = await db.swarm.findUnique({
          where: { workspaceId: testData.workspace.id },
        });
        const containerFiles = swarm?.containerFiles as Record<string, string>;

        expect(containerFiles["Dockerfile"]).toBe(newDockerfile);
        expect(containerFiles["docker-compose.yml"]).toBe(newDockerCompose);
        // pm2.config.js unchanged
        expect(containerFiles["pm2.config.js"]).toBe(toBase64(DEFAULT_PM2_CONFIG));
      });
    });

    describe("pm2.config.js ↔ services bidirectional sync", () => {
      it("updates pm2.config.js and syncs to services column", async () => {
        const newPm2Config = toBase64(UPDATED_PM2_CONFIG);

        const req = createPutRequest(
          `http://localhost:3000/api/workspaces/${testData.workspace.slug}/stakgraph`,
          { containerFiles: { "pm2.config.js": newPm2Config } }
        );

        const res = await PUT_STAK(req, {
          params: Promise.resolve({ slug: testData.workspace.slug }),
        });
        await expectSuccess(res, 200);

        const swarm = await db.swarm.findUnique({
          where: { workspaceId: testData.workspace.id },
        });
        const containerFiles = swarm?.containerFiles as Record<string, string>;
        const services = swarm?.services as any[];

        // pm2.config.js should be updated
        expect(containerFiles["pm2.config.js"]).toBe(newPm2Config);

        // Services should include the new "api" service from pm2 parsing
        const apiService = services.find((s) => s.name === "api");
        expect(apiService).toBeDefined();
        expect(apiService.port).toBe(4000);

        // Existing services should be preserved (merge behavior)
        expect(services.find((s) => s.name === "frontend")).toBeDefined();
        expect(services.find((s) => s.name === "sidekiq")).toBeDefined();
      });

      it("updates services and regenerates pm2.config.js", async () => {
        const newServices = [
          {
            name: "backend",
            port: 5000,
            scripts: { start: "npm run server", install: "npm ci" },
          },
        ];

        const req = createPutRequest(
          `http://localhost:3000/api/workspaces/${testData.workspace.slug}/stakgraph`,
          { services: newServices }
        );

        const res = await PUT_STAK(req, {
          params: Promise.resolve({ slug: testData.workspace.slug }),
        });
        await expectSuccess(res, 200);

        const swarm = await db.swarm.findUnique({
          where: { workspaceId: testData.workspace.id },
        });
        const containerFiles = swarm?.containerFiles as Record<string, string>;
        const services = swarm?.services as any[];

        // New service should be added
        const backendService = services.find((s) => s.name === "backend");
        expect(backendService).toBeDefined();
        expect(backendService.port).toBe(5000);

        // pm2.config.js should be regenerated with new service
        const pm2Content = fromBase64(containerFiles["pm2.config.js"]);
        expect(pm2Content).toContain("backend");
        expect(pm2Content).toContain("5000");
      });

      it("services takes precedence when both services and pm2.config.js sent", async () => {
        const newServices = [
          { name: "winner-service", port: 9999, scripts: { start: "npm run winner" } },
        ];
        const newPm2Config = toBase64(UPDATED_PM2_CONFIG); // Has "api" service

        const req = createPutRequest(
          `http://localhost:3000/api/workspaces/${testData.workspace.slug}/stakgraph`,
          {
            services: newServices,
            containerFiles: { "pm2.config.js": newPm2Config },
          }
        );

        const res = await PUT_STAK(req, {
          params: Promise.resolve({ slug: testData.workspace.slug }),
        });
        await expectSuccess(res, 200);

        const swarm = await db.swarm.findUnique({
          where: { workspaceId: testData.workspace.id },
        });
        const containerFiles = swarm?.containerFiles as Record<string, string>;
        const services = swarm?.services as any[];

        // Services should include winner-service (from services array)
        const winnerService = services.find((s) => s.name === "winner-service");
        expect(winnerService).toBeDefined();
        expect(winnerService.port).toBe(9999);

        // pm2.config.js should be REGENERATED from services (not the one sent)
        const pm2Content = fromBase64(containerFiles["pm2.config.js"]);
        expect(pm2Content).toContain("winner-service");
        expect(pm2Content).toContain("9999");
      });

      it("merges services by name - updating existing service", async () => {
        // Update existing "frontend" service with new port
        const updatedFrontend = {
          name: "frontend",
          port: 8080, // Changed from 3000
          scripts: { start: "npm run dev" },
        };

        const req = createPutRequest(
          `http://localhost:3000/api/workspaces/${testData.workspace.slug}/stakgraph`,
          { services: [updatedFrontend] }
        );

        const res = await PUT_STAK(req, {
          params: Promise.resolve({ slug: testData.workspace.slug }),
        });
        await expectSuccess(res, 200);

        const swarm = await db.swarm.findUnique({
          where: { workspaceId: testData.workspace.id },
        });
        const services = swarm?.services as any[];

        // Frontend should be updated
        const frontend = services.find((s) => s.name === "frontend");
        expect(frontend.port).toBe(8080);
        expect(frontend.scripts.start).toBe("npm run dev");

        // Sidekiq should still exist (preserved)
        expect(services.find((s) => s.name === "sidekiq")).toBeDefined();
      });
    });

    describe("other field partial updates", () => {
      it("updates only name when only name sent", async () => {
        const newName = "updated-swarm-name";

        const req = createPutRequest(
          `http://localhost:3000/api/workspaces/${testData.workspace.slug}/stakgraph`,
          { name: newName }
        );

        const res = await PUT_STAK(req, {
          params: Promise.resolve({ slug: testData.workspace.slug }),
        });
        const response = await expectSuccess(res, 200);
        expect(response.data.name).toBe(newName);

        const swarm = await db.swarm.findUnique({
          where: { workspaceId: testData.workspace.id },
        });
        expect(swarm?.name).toBe(newName);

        // Everything else unchanged
        const services = swarm?.services as any[];
        expect(services).toHaveLength(2);
        const containerFiles = swarm?.containerFiles as Record<string, string>;
        expect(containerFiles["Dockerfile"]).toBe(toBase64(DEFAULT_DOCKERFILE));
      });

      it("updates swarmUrl only", async () => {
        const newUrl = "https://new-swarm.sphinx.chat";

        const req = createPutRequest(
          `http://localhost:3000/api/workspaces/${testData.workspace.slug}/stakgraph`,
          { swarmUrl: newUrl }
        );

        const res = await PUT_STAK(req, {
          params: Promise.resolve({ slug: testData.workspace.slug }),
        });
        const response = await expectSuccess(res, 200);
        expect(response.data.swarmUrl).toBe(newUrl);

        const swarm = await db.swarm.findUnique({
          where: { workspaceId: testData.workspace.id },
        });
        expect(swarm?.swarmUrl).toBe(newUrl);
      });

      it("updates poolCpu and poolMemory only", async () => {
        const req = createPutRequest(
          `http://localhost:3000/api/workspaces/${testData.workspace.slug}/stakgraph`,
          { poolCpu: "4", poolMemory: "8Gi" }
        );

        const res = await PUT_STAK(req, {
          params: Promise.resolve({ slug: testData.workspace.slug }),
        });
        await expectSuccess(res, 200);

        const swarm = await db.swarm.findUnique({
          where: { workspaceId: testData.workspace.id },
        });
        expect(swarm?.poolCpu).toBe("4");
        expect(swarm?.poolMemory).toBe("8Gi");

        // Name unchanged
        expect(swarm?.name).toBe(testData.swarm.name);
      });
    });

    describe("edge cases", () => {
      it("makes no changes on empty request", async () => {
        const originalSwarm = await db.swarm.findUnique({
          where: { workspaceId: testData.workspace.id },
        });

        const req = createPutRequest(
          `http://localhost:3000/api/workspaces/${testData.workspace.slug}/stakgraph`,
          {}
        );

        const res = await PUT_STAK(req, {
          params: Promise.resolve({ slug: testData.workspace.slug }),
        });
        await expectSuccess(res, 200);

        const swarm = await db.swarm.findUnique({
          where: { workspaceId: testData.workspace.id },
        });

        expect(swarm?.name).toBe(originalSwarm?.name);
        expect(JSON.stringify(swarm?.services)).toBe(
          JSON.stringify(originalSwarm?.services)
        );
        expect(JSON.stringify(swarm?.containerFiles)).toBe(
          JSON.stringify(originalSwarm?.containerFiles)
        );
      });

      it("handles empty services array gracefully", async () => {
        const req = createPutRequest(
          `http://localhost:3000/api/workspaces/${testData.workspace.slug}/stakgraph`,
          { services: [] }
        );

        const res = await PUT_STAK(req, {
          params: Promise.resolve({ slug: testData.workspace.slug }),
        });
        await expectSuccess(res, 200);

        // Empty services array should not change existing services
        // (treated as "not sent" for merge purposes)
        const swarm = await db.swarm.findUnique({
          where: { workspaceId: testData.workspace.id },
        });
        const services = swarm?.services as any[];
        expect(services).toHaveLength(2);
      });

      it("handles empty containerFiles object gracefully", async () => {
        const req = createPutRequest(
          `http://localhost:3000/api/workspaces/${testData.workspace.slug}/stakgraph`,
          { containerFiles: {} }
        );

        const res = await PUT_STAK(req, {
          params: Promise.resolve({ slug: testData.workspace.slug }),
        });
        await expectSuccess(res, 200);

        // Empty containerFiles should not change existing files
        const swarm = await db.swarm.findUnique({
          where: { workspaceId: testData.workspace.id },
        });
        const containerFiles = swarm?.containerFiles as Record<string, string>;
        expect(Object.keys(containerFiles)).toHaveLength(3);
      });
    });
  });
});
