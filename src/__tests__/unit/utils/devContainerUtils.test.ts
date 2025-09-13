import { describe, test, expect, beforeEach } from "vitest";
import { 
  generatePM2Apps,
  formatPM2Apps,
  getPM2AppsContent
} from "@/utils/devContainerUtils";
import type { ServiceDataConfig } from "@/types/devContainer";

describe("DevContainer Utils - Unit Tests", () => {
  beforeEach(() => {
    // Clear any test state if needed
  });

  describe("generatePM2Apps", () => {
    test("should return default configuration when no services provided", () => {
      const result = generatePM2Apps("test-repo", []);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: "default-service",
        script: "npm start",
        cwd: "/workspaces/test-repo",
        instances: 1,
        autorestart: true,
        watch: false,
        max_memory_restart: "1G",
        env: {
          INSTALL_COMMAND: "npm install",
          TEST_COMMAND: "npm test",
          BUILD_COMMAND: "npm run build",
          E2E_TEST_COMMAND: "npx playwright test",
          PORT: "3000",
        },
      });
    });

    test("should return default configuration when services is null/undefined", () => {
      const result = generatePM2Apps("test-repo", null as any);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("default-service");
      expect(result[0].cwd).toBe("/workspaces/test-repo");
    });

    test("should generate configuration for single service with all properties", () => {
      const serviceData: ServiceDataConfig[] = [
        {
          name: "web-service",
          port: 3000,
          interpreter: "node",
          scripts: {
            start: "npm run dev",
            install: "npm ci",
            test: "npm run test:unit",
            e2eTest: "npm run test:e2e",
            build: "npm run build:prod",
            preStart: "npm run setup",
            postStart: "npm run seed",
            rebuild: "npm run clean && npm run build",
          },
        },
      ];

      const result = generatePM2Apps("my-repo", serviceData);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: "web-service",
        script: "npm run dev",
        cwd: "/workspaces/my-repo",
        instances: 1,
        autorestart: true,
        watch: false,
        max_memory_restart: "1G",
        interpreter: "node",
        env: {
          PORT: "3000",
          INSTALL_COMMAND: "npm ci",
          TEST_COMMAND: "npm run test:unit",
          E2E_TEST_COMMAND: "npm run test:e2e",
          BUILD_COMMAND: "npm run build:prod",
          PRE_START_COMMAND: "npm run setup",
          POST_START_COMMAND: "npm run seed",
          REBUILD_COMMAND: "npm run clean && npm run build",
        },
      });
    });

    test("should generate configuration for service with minimal properties", () => {
      const serviceData: ServiceDataConfig[] = [
        {
          name: "minimal-service",
          scripts: {
            start: "python app.py",
          },
        },
      ];

      const result = generatePM2Apps("python-repo", serviceData);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: "minimal-service",
        script: "python app.py",
        cwd: "/workspaces/python-repo",
        instances: 1,
        autorestart: true,
        watch: false,
        max_memory_restart: "1G",
        interpreter: undefined,
        env: {},
      });
    });

    test("should generate configuration for multiple services", () => {
      const serviceData: ServiceDataConfig[] = [
        {
          name: "frontend",
          port: 3000,
          scripts: {
            start: "npm run dev",
            build: "npm run build",
          },
        },
        {
          name: "backend",
          port: 8080,
          interpreter: "python",
          scripts: {
            start: "python manage.py runserver",
            test: "pytest",
          },
        },
      ];

      const result = generatePM2Apps("fullstack-app", serviceData);

      expect(result).toHaveLength(2);
      
      expect(result[0]).toEqual({
        name: "frontend",
        script: "npm run dev",
        cwd: "/workspaces/fullstack-app",
        instances: 1,
        autorestart: true,
        watch: false,
        max_memory_restart: "1G",
        interpreter: undefined,
        env: {
          PORT: "3000",
          BUILD_COMMAND: "npm run build",
        },
      });

      expect(result[1]).toEqual({
        name: "backend",
        script: "python manage.py runserver",
        cwd: "/workspaces/fullstack-app",
        instances: 1,
        autorestart: true,
        watch: false,
        max_memory_restart: "1G",
        interpreter: "python",
        env: {
          PORT: "8080",
          TEST_COMMAND: "pytest",
        },
      });
    });

    test("should handle service with empty scripts object", () => {
      const serviceData: ServiceDataConfig[] = [
        {
          name: "empty-scripts",
          scripts: {},
        },
      ];

      const result = generatePM2Apps("test-repo", serviceData);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: "empty-scripts",
        script: "",
        cwd: "/workspaces/test-repo",
        instances: 1,
        autorestart: true,
        watch: false,
        max_memory_restart: "1G",
        interpreter: undefined,
        env: {},
      });
    });

    test("should convert numeric port to string in environment", () => {
      const serviceData: ServiceDataConfig[] = [
        {
          name: "port-test",
          port: 9000,
          scripts: {
            start: "node server.js",
          },
        },
      ];

      const result = generatePM2Apps("test-repo", serviceData);

      expect(result[0].env.PORT).toBe("9000");
      expect(typeof result[0].env.PORT).toBe("string");
    });

    test("should handle service with no start script", () => {
      const serviceData: ServiceDataConfig[] = [
        {
          name: "no-start",
          scripts: {
            build: "npm run build",
            test: "npm test",
          },
        },
      ];

      const result = generatePM2Apps("test-repo", serviceData);

      expect(result[0].script).toBe("");
      expect(result[0].env.BUILD_COMMAND).toBe("npm run build");
      expect(result[0].env.TEST_COMMAND).toBe("npm test");
    });
  });

  describe("formatPM2Apps", () => {
    test("should format single app configuration correctly", () => {
      const apps = [
        {
          name: "test-app",
          script: "npm start",
          cwd: "/workspaces/test",
          instances: 1,
          autorestart: true,
          watch: false,
          max_memory_restart: "1G",
          env: {
            PORT: "3000",
            NODE_ENV: "development",
          },
        },
      ];

      const result = formatPM2Apps(apps);

      expect(result).toContain('name: "test-app"');
      expect(result).toContain('script: "npm start"');
      expect(result).toContain('cwd: "/workspaces/test"');
      expect(result).toContain('instances: 1');
      expect(result).toContain('autorestart: true');
      expect(result).toContain('watch: false');
      expect(result).toContain('max_memory_restart: "1G"');
      expect(result).toContain('PORT: "3000"');
      expect(result).toContain('NODE_ENV: "development"');
    });

    test("should format multiple app configurations correctly", () => {
      const apps = [
        {
          name: "app1",
          script: "npm start",
          cwd: "/workspaces/test",
          instances: 1,
          autorestart: true,
          watch: false,
          max_memory_restart: "1G",
          env: { PORT: "3000" },
        },
        {
          name: "app2",
          script: "python app.py",
          cwd: "/workspaces/test",
          instances: 1,
          autorestart: true,
          watch: false,
          interpreter: "python",
          max_memory_restart: "1G",
          env: { PORT: "8080" },
        },
      ];

      const result = formatPM2Apps(apps);

      expect(result).toContain('name: "app1"');
      expect(result).toContain('name: "app2"');
      expect(result).toContain('interpreter: "python"');
      expect(result.split(',\n').filter(line => line.includes('name:'))).toHaveLength(2);
    });

    test("should handle app with empty environment", () => {
      const apps = [
        {
          name: "empty-env",
          script: "node app.js",
          cwd: "/workspaces/test",
          instances: 1,
          autorestart: true,
          watch: false,
          max_memory_restart: "1G",
          env: {},
        },
      ];

      const result = formatPM2Apps(apps);

      expect(result).toContain('name: "empty-env"');
      expect(result).toContain('env: {\n\n      }');
    });

    test("should include interpreter when provided", () => {
      const apps = [
        {
          name: "python-app",
          script: "app.py",
          cwd: "/workspaces/test",
          instances: 1,
          autorestart: true,
          watch: false,
          interpreter: "python3",
          max_memory_restart: "1G",
          env: {},
        },
      ];

      const result = formatPM2Apps(apps);

      expect(result).toContain('interpreter: "python3"');
    });

    test("should omit interpreter when not provided", () => {
      const apps = [
        {
          name: "node-app",
          script: "app.js",
          cwd: "/workspaces/test",
          instances: 1,
          autorestart: true,
          watch: false,
          max_memory_restart: "1G",
          env: {},
        },
      ];

      const result = formatPM2Apps(apps);

      expect(result).not.toContain('interpreter:');
    });
  });

  describe("getPM2AppsContent", () => {
    test("should generate complete PM2 config file content", () => {
      const serviceData: ServiceDataConfig[] = [
        {
          name: "test-service",
          port: 3000,
          scripts: {
            start: "npm run dev",
          },
        },
      ];

      const result = getPM2AppsContent("test-repo", serviceData);

      expect(result.name).toBe("pm2.config.js");
      expect(result.type).toBe("javascript");
      expect(result.content).toContain("module.exports = {");
      expect(result.content).toContain("apps: [");
      expect(result.content).toContain('name: "test-service"');
      expect(result.content).toContain('script: "npm run dev"');
      expect(result.content).toContain("};");
    });

    test("should generate config with default service when no services provided", () => {
      const result = getPM2AppsContent("default-repo", []);

      expect(result.content).toContain('name: "default-service"');
      expect(result.content).toContain('script: "npm start"');
      expect(result.content).toContain('cwd: "/workspaces/default-repo"');
    });

    test("should generate valid JavaScript module structure", () => {
      const result = getPM2AppsContent("test", []);

      expect(result.content.startsWith("module.exports = {")).toBe(true);
      expect(result.content.endsWith("};\n")).toBe(true);
      expect(result.content).toContain("apps: [");
    });
  });
});