import { describe, it, expect } from "vitest";
import { generatePM2Apps } from "@/utils/devContainerUtils";
import { ServiceDataConfig } from "@/components/stakgraph/types";

describe("PM2 Config Environment Variable Merging", () => {
  const repoName = ["test-repo"];

  it("should merge global env vars into default service config", () => {
    const globalEnvVars = [
      { name: "GLOBAL_VAR_1", value: "global-value-1" },
      { name: "GLOBAL_VAR_2", value: "global-value-2" },
    ];

    const pm2Apps = generatePM2Apps(repoName, [], globalEnvVars);

    expect(pm2Apps).toHaveLength(1);
    expect(pm2Apps[0].env.GLOBAL_VAR_1).toBe("global-value-1");
    expect(pm2Apps[0].env.GLOBAL_VAR_2).toBe("global-value-2");
  });

  it("should merge global env vars with correct precedence for single service", () => {
    const globalEnvVars = [
      { name: "SHARED_VAR", value: "global-value" },
      { name: "GLOBAL_ONLY", value: "global-only-value" },
      { name: "PORT", value: "9999" }, // Should be overridden by service port
    ];

    const services: ServiceDataConfig[] = [
      {
        name: "frontend",
        port: 3000,
        scripts: {
          start: "npm start",
          install: "npm install",
        },
        env: {
          SHARED_VAR: "service-value", // Overrides global
          SERVICE_ONLY: "service-only-value",
        },
      },
    ];

    const pm2Apps = generatePM2Apps(repoName, services, globalEnvVars);

    expect(pm2Apps).toHaveLength(1);
    const app = pm2Apps[0];

    // Global vars should be present
    expect(app.env.GLOBAL_ONLY).toBe("global-only-value");

    // Service-specific vars should override global
    expect(app.env.SHARED_VAR).toBe("service-value");
    expect(app.env.SERVICE_ONLY).toBe("service-only-value");

    // Command vars (PORT, INSTALL_COMMAND) should override everything
    expect(app.env.PORT).toBe("3000");
    expect(app.env.INSTALL_COMMAND).toBe("npm install");
  });

  it("should apply different service-specific env vars to multiple services", () => {
    const globalEnvVars = [
      { name: "API_URL", value: "https://api.example.com" },
      { name: "ENV", value: "production" },
    ];

    const services: ServiceDataConfig[] = [
      {
        name: "frontend",
        port: 3000,
        scripts: { start: "npm start" },
        env: {
          SERVICE_NAME: "frontend",
          ENV: "development", // Override global ENV
        },
      },
      {
        name: "backend",
        port: 4000,
        scripts: { start: "npm run server" },
        env: {
          SERVICE_NAME: "backend",
          DATABASE_URL: "postgres://localhost/db",
        },
      },
    ];

    const pm2Apps = generatePM2Apps(repoName, services, globalEnvVars);

    expect(pm2Apps).toHaveLength(2);

    // Frontend service
    const frontend = pm2Apps[0];
    expect(frontend.env.API_URL).toBe("https://api.example.com"); // Global
    expect(frontend.env.ENV).toBe("development"); // Overridden
    expect(frontend.env.SERVICE_NAME).toBe("frontend");
    expect(frontend.env.PORT).toBe("3000");
    expect(frontend.env.DATABASE_URL).toBeUndefined();

    // Backend service
    const backend = pm2Apps[1];
    expect(backend.env.API_URL).toBe("https://api.example.com"); // Global
    expect(backend.env.ENV).toBe("production"); // Uses global
    expect(backend.env.SERVICE_NAME).toBe("backend");
    expect(backend.env.PORT).toBe("4000");
    expect(backend.env.DATABASE_URL).toBe("postgres://localhost/db");
  });

  it("should handle command variables with highest precedence", () => {
    const globalEnvVars = [
      { name: "INSTALL_COMMAND", value: "yarn install" },
      { name: "BUILD_COMMAND", value: "yarn build" },
    ];

    const services: ServiceDataConfig[] = [
      {
        name: "service",
        port: 3000,
        scripts: {
          start: "npm start",
          install: "pnpm install", // Should override global INSTALL_COMMAND
          build: "pnpm build", // Should override global BUILD_COMMAND
        },
        env: {
          INSTALL_COMMAND: "npm ci", // Should be overridden by scripts.install
        },
      },
    ];

    const pm2Apps = generatePM2Apps(repoName, services, globalEnvVars);

    expect(pm2Apps).toHaveLength(1);
    const app = pm2Apps[0];

    // Command variables from scripts should have highest precedence
    expect(app.env.INSTALL_COMMAND).toBe("pnpm install");
    expect(app.env.BUILD_COMMAND).toBe("pnpm build");
  });

  it("should handle services without env vars", () => {
    const globalEnvVars = [
      { name: "GLOBAL_VAR", value: "global-value" },
    ];

    const services: ServiceDataConfig[] = [
      {
        name: "simple-service",
        port: 3000,
        scripts: {
          start: "npm start",
        },
        // No env property
      },
    ];

    const pm2Apps = generatePM2Apps(repoName, services, globalEnvVars);

    expect(pm2Apps).toHaveLength(1);
    const app = pm2Apps[0];

    // Should still have global vars
    expect(app.env.GLOBAL_VAR).toBe("global-value");
    expect(app.env.PORT).toBe("3000");
  });

  it("should work without global env vars", () => {
    const services: ServiceDataConfig[] = [
      {
        name: "service",
        port: 3000,
        scripts: {
          start: "npm start",
        },
        env: {
          SERVICE_VAR: "service-value",
        },
      },
    ];

    const pm2Apps = generatePM2Apps(repoName, services);

    expect(pm2Apps).toHaveLength(1);
    const app = pm2Apps[0];

    // Should have service-specific env
    expect(app.env.SERVICE_VAR).toBe("service-value");
    expect(app.env.PORT).toBe("3000");
  });

  it("should handle empty global env vars array", () => {
    const services: ServiceDataConfig[] = [
      {
        name: "service",
        port: 3000,
        scripts: {
          start: "npm start",
        },
        env: {
          SERVICE_VAR: "service-value",
        },
      },
    ];

    const pm2Apps = generatePM2Apps(repoName, services, []);

    expect(pm2Apps).toHaveLength(1);
    const app = pm2Apps[0];

    expect(app.env.SERVICE_VAR).toBe("service-value");
    expect(app.env.PORT).toBe("3000");
  });

  it("should preserve all command variables", () => {
    const globalEnvVars = [{ name: "GLOBAL", value: "global" }];

    const services: ServiceDataConfig[] = [
      {
        name: "full-service",
        port: 3000,
        scripts: {
          start: "npm start",
          install: "npm install",
          test: "npm test",
          build: "npm run build",
          e2eTest: "npx playwright test",
          preStart: "npm run migrate",
          postStart: "npm run seed",
          rebuild: "npm run rebuild",
          reset: "npm run reset",
        },
      },
    ];

    const pm2Apps = generatePM2Apps(repoName, services, globalEnvVars);

    expect(pm2Apps).toHaveLength(1);
    const app = pm2Apps[0];

    expect(app.env.GLOBAL).toBe("global");
    expect(app.env.PORT).toBe("3000");
    expect(app.env.INSTALL_COMMAND).toBe("npm install");
    expect(app.env.TEST_COMMAND).toBe("npm test");
    expect(app.env.BUILD_COMMAND).toBe("npm run build");
    expect(app.env.E2E_TEST_COMMAND).toBe("npx playwright test");
    expect(app.env.PRE_START_COMMAND).toBe("npm run migrate");
    expect(app.env.POST_START_COMMAND).toBe("npm run seed");
    expect(app.env.REBUILD_COMMAND).toBe("npm run rebuild");
    expect(app.env.RESET_COMMAND).toBe("npm run reset");
  });

  it("should correctly format PM2 config precedence in real-world scenario", () => {
    const globalEnvVars = [
      { name: "NODE_ENV", value: "production" },
      { name: "LOG_LEVEL", value: "info" },
      { name: "API_KEY", value: "global-api-key" },
      { name: "DATABASE_URL", value: "postgres://global-db" },
    ];

    const services: ServiceDataConfig[] = [
      {
        name: "api",
        port: 4000,
        cwd: "packages/api",
        scripts: {
          start: "node dist/index.js",
          install: "npm install",
          build: "npm run build",
          test: "npm test",
        },
        env: {
          NODE_ENV: "development", // Override global
          DATABASE_URL: "postgres://api-specific-db", // Override global
          JWT_SECRET: "api-jwt-secret",
        },
      },
      {
        name: "worker",
        port: 5000,
        scripts: {
          start: "node worker.js",
        },
        env: {
          LOG_LEVEL: "debug", // Override global
          QUEUE_URL: "redis://localhost",
        },
      },
    ];

    const pm2Apps = generatePM2Apps(repoName, services, globalEnvVars);

    expect(pm2Apps).toHaveLength(2);

    // API service - has overrides
    const api = pm2Apps[0];
    expect(api.name).toBe("api");
    expect(api.cwd).toBe(`/workspaces/${repoName[0]}/packages/api`);
    expect(api.env.NODE_ENV).toBe("development"); // Service override
    expect(api.env.LOG_LEVEL).toBe("info"); // Global
    expect(api.env.API_KEY).toBe("global-api-key"); // Global
    expect(api.env.DATABASE_URL).toBe("postgres://api-specific-db"); // Service override
    expect(api.env.JWT_SECRET).toBe("api-jwt-secret"); // Service-only
    expect(api.env.PORT).toBe("4000"); // Command var
    expect(api.env.INSTALL_COMMAND).toBe("npm install"); // Command var
    expect(api.env.BUILD_COMMAND).toBe("npm run build"); // Command var

    // Worker service - uses mostly globals
    const worker = pm2Apps[1];
    expect(worker.name).toBe("worker");
    expect(worker.env.NODE_ENV).toBe("production"); // Global
    expect(worker.env.LOG_LEVEL).toBe("debug"); // Service override
    expect(worker.env.API_KEY).toBe("global-api-key"); // Global
    expect(worker.env.DATABASE_URL).toBe("postgres://global-db"); // Global
    expect(worker.env.QUEUE_URL).toBe("redis://localhost"); // Service-only
    expect(worker.env.PORT).toBe("5000"); // Command var
    expect(worker.env.JWT_SECRET).toBeUndefined(); // Not inherited from api
  });
});
