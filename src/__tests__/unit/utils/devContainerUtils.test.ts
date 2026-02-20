import { describe, test, expect, beforeEach } from "vitest";
import {
  generatePM2Apps,
  formatPM2Apps,
  getPM2AppsContent,
  parsePM2Content,
  resolveCwd
} from "@/utils/devContainerUtils";
import type { ServiceDataConfig } from "@/components/stakgraph/types";

describe("DevContainer Utils - Unit Tests", () => {
  describe("resolveCwd", () => {
    test("should return default repo for empty cwd", () => {
      const result = resolveCwd("", ["repo1", "repo2"], "repo1");
      expect(result).toBe("/workspaces/repo1");
    });

    test("should return default repo for undefined cwd", () => {
      const result = resolveCwd(undefined, ["repo1", "repo2"], "repo1");
      expect(result).toBe("/workspaces/repo1");
    });

    test("should pass through absolute paths unchanged", () => {
      const result = resolveCwd("/workspaces/custom-repo/subdir", ["repo1", "repo2"], "repo1");
      expect(result).toBe("/workspaces/custom-repo/subdir");
    });

    test("should treat cwd as subdirectory for single repo", () => {
      const result = resolveCwd("subdir", ["repo1"], "repo1");
      expect(result).toBe("/workspaces/repo1/subdir");
    });

    test("should use repo name when first segment matches a repo (multi-repo)", () => {
      const result = resolveCwd("jarvis-backend", ["sphinx-nav-fiber", "jarvis-boltwall", "jarvis-backend"], "sphinx-nav-fiber");
      expect(result).toBe("/workspaces/jarvis-backend");
    });

    test("should use repo with subdir when first segment matches a repo (multi-repo)", () => {
      const result = resolveCwd("jarvis-boltwall/boltwall", ["sphinx-nav-fiber", "jarvis-boltwall", "jarvis-backend"], "sphinx-nav-fiber");
      expect(result).toBe("/workspaces/jarvis-boltwall/boltwall");
    });

    test("should use default repo when no match found (multi-repo)", () => {
      const result = resolveCwd("some-subdir", ["sphinx-nav-fiber", "jarvis-boltwall", "jarvis-backend"], "sphinx-nav-fiber");
      expect(result).toBe("/workspaces/sphinx-nav-fiber/some-subdir");
    });

    test("should not duplicate repo name when cwd matches repo name (single repo)", () => {
      const result = resolveCwd("sphinx-tribes", ["sphinx-tribes"], "sphinx-tribes");
      expect(result).toBe("/workspaces/sphinx-tribes");
    });

    test("should not duplicate repo name when cwd starts with repo name and has subdir (single repo)", () => {
      const result = resolveCwd("sphinx-tribes/src", ["sphinx-tribes"], "sphinx-tribes");
      expect(result).toBe("/workspaces/sphinx-tribes/src");
    });

    test("should handle leading slashes in cwd", () => {
      const result = resolveCwd("/subdir", ["repo1"], "repo1");
      expect(result).toBe("/workspaces/repo1/subdir");
    });

    test("should handle deeply nested subdirectories", () => {
      const result = resolveCwd("jarvis-backend/src/api", ["sphinx-nav-fiber", "jarvis-backend"], "sphinx-nav-fiber");
      expect(result).toBe("/workspaces/jarvis-backend/src/api");
    });
  });

  describe("generatePM2Apps", () => {
    test("should return default configuration when no services provided", () => {
      const result = generatePM2Apps(["test-repo"], []);

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
      const result = generatePM2Apps(["test-repo"], null as any);

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
            reset: "npm run db:reset",
          },
        },
      ];

      const result = generatePM2Apps(["my-repo"], serviceData);

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
          RESET_COMMAND: "npm run db:reset",
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

      const result = generatePM2Apps(["python-repo"], serviceData);

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

      const result = generatePM2Apps(["fullstack-app"], serviceData);

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

      const result = generatePM2Apps(["test-repo"], serviceData);

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

      const result = generatePM2Apps(["test-repo"], serviceData);
      const env = result[0].env as Record<string, string>;

      expect(env.PORT).toBe("9000");
      expect(typeof env.PORT).toBe("string");
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

      const result = generatePM2Apps(["test-repo"], serviceData);
      const env = result[0].env as Record<string, string>;

      expect(result[0].script).toBe("");
      expect(env.BUILD_COMMAND).toBe("npm run build");
      expect(env.TEST_COMMAND).toBe("npm test");
    });

    test("should override defaults with advanced fields", () => {
      const serviceData: ServiceDataConfig[] = [
        {
          name: "advanced-svc",
          port: 3000,
          scripts: { start: "npm start" },
          advanced: { instances: 4, watch: true, max_memory_restart: "2G" },
        },
      ];

      const result = generatePM2Apps(["test-repo"], serviceData);

      expect(result[0].instances).toBe(4);
      expect(result[0].watch).toBe(true);
      expect(result[0].max_memory_restart).toBe("2G");
      expect(result[0].autorestart).toBe(true); // default kept
    });

    test("should not let advanced override env or interpreter", () => {
      const serviceData: ServiceDataConfig[] = [
        {
          name: "override-test",
          port: 3000,
          interpreter: "node",
          scripts: { start: "npm start" },
          env: { MY_VAR: "real" },
          advanced: { interpreter: "python", env: "should-be-ignored" } as any,
        },
      ];

      const result = generatePM2Apps(["test-repo"], serviceData);

      // interpreter and env come after the spread, so they win
      expect(result[0].interpreter).toBe("node");
      const env = result[0].env as Record<string, string>;
      expect(env.MY_VAR).toBe("real");
      expect(env.PORT).toBe("3000");
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

    test("should render extra fields in PM2 output", () => {
      const apps = [
        {
          name: "extra-app",
          script: "npm start",
          cwd: "/workspaces/test",
          instances: 1,
          autorestart: true,
          watch: false,
          max_memory_restart: "1G",
          kill_timeout: 5000,
          listen_timeout: 3000,
          env: {},
        },
      ];

      const result = formatPM2Apps(apps);

      expect(result).toContain("kill_timeout: 5000,");
      expect(result).toContain("listen_timeout: 3000,");
    });

    test("should quote string extra fields and leave numbers/booleans unquoted", () => {
      const apps = [
        {
          name: "types-app",
          script: "npm start",
          cwd: "/workspaces/test",
          instances: 1,
          autorestart: true,
          watch: false,
          max_memory_restart: "1G",
          custom_string: "hello",
          custom_num: 42,
          custom_bool: true,
          env: {},
        },
      ];

      const result = formatPM2Apps(apps);

      expect(result).toContain('custom_string: "hello",');
      expect(result).toContain("custom_num: 42,");
      expect(result).toContain("custom_bool: true,");
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

  describe("parsePM2Content", () => {
    test("parses a basic PM2 config", () => {
      const pm2 = `module.exports = {
  apps: [
    {
      name: "api",
      script: "npm start",
      cwd: "/workspaces/my-repo",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        PORT: "3000"
      }
    }
  ],
};`;

      const result = parsePM2Content(pm2);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("api");
      expect(result[0].scripts.start).toBe("npm start");
      expect(result[0].port).toBe(3000);
      expect(result[0].cwd).toBe("my-repo");
    });

    test("parses advanced fields into advanced object", () => {
      const pm2 = `module.exports = {
  apps: [
    {
      name: "api",
      script: "npm start",
      cwd: "/workspaces/my-repo",
      instances: 4,
      autorestart: false,
      watch: true,
      max_memory_restart: "2G",
      env: {
        PORT: "3000"
      }
    }
  ],
};`;

      const result = parsePM2Content(pm2);

      expect(result).toHaveLength(1);
      expect(result[0].advanced).toBeDefined();
      expect(result[0].advanced!.instances).toBe(4);
      expect(result[0].advanced!.autorestart).toBe(false);
      expect(result[0].advanced!.watch).toBe(true);
      expect(result[0].advanced!.max_memory_restart).toBe("2G");
    });

    test("does not put known keys in advanced", () => {
      const pm2 = `module.exports = {
  apps: [
    {
      name: "api",
      script: "npm start",
      cwd: "/workspaces/my-repo",
      interpreter: "node",
      instances: 4,
      env: {
        PORT: "3000"
      }
    }
  ],
};`;

      const result = parsePM2Content(pm2);
      const advanced = result[0].advanced || {};

      expect(advanced).not.toHaveProperty("name");
      expect(advanced).not.toHaveProperty("script");
      expect(advanced).not.toHaveProperty("cwd");
      expect(advanced).not.toHaveProperty("interpreter");
      expect(advanced).toHaveProperty("instances", 4);
    });

    test("handles PM2 with no advanced fields", () => {
      const pm2 = `module.exports = {
  apps: [
    {
      name: "api",
      script: "npm start",
      cwd: "/workspaces/my-repo",
      env: {
        PORT: "3000"
      }
    }
  ],
};`;

      const result = parsePM2Content(pm2);

      expect(result).toHaveLength(1);
      expect(result[0].advanced).toBeUndefined();
    });

    test("handles multiple services with different advanced fields", () => {
      const pm2 = `module.exports = {
  apps: [
    {
      name: "api",
      script: "npm start",
      cwd: "/workspaces/repo",
      instances: 4,
      watch: true,
      env: {
        PORT: "3000"
      }
    },
    {
      name: "worker",
      script: "npm run worker",
      cwd: "/workspaces/repo",
      instances: 2,
      autorestart: false,
      env: {
        PORT: "0"
      }
    }
  ],
};`;

      const result = parsePM2Content(pm2);

      expect(result).toHaveLength(2);
      expect(result[0].advanced).toEqual({ instances: 4, watch: true });
      expect(result[1].advanced).toEqual({ instances: 2, autorestart: false });
    });

    test("parses custom/unknown PM2 fields into advanced", () => {
      const pm2 = `module.exports = {
  apps: [
    {
      name: "api",
      script: "npm start",
      cwd: "/workspaces/repo",
      kill_timeout: 5000,
      listen_timeout: 3000,
      env: {
        PORT: "3000"
      }
    }
  ],
};`;

      const result = parsePM2Content(pm2);

      expect(result[0].advanced).toBeDefined();
      expect(result[0].advanced!.kill_timeout).toBe(5000);
      expect(result[0].advanced!.listen_timeout).toBe(3000);
    });

  });

  describe("advanced round-trip", () => {
    test("services → PM2 → parse → services preserves advanced", () => {
      const serviceData: ServiceDataConfig[] = [
        {
          name: "api",
          port: 3000,
          env: {},
          scripts: { start: "npm start" },
          advanced: { instances: 4, watch: true },
        },
      ];

      // Generate PM2 from services
      const pm2Content = getPM2AppsContent(["my-repo"], serviceData);

      // Verify the generated PM2 has the advanced values
      expect(pm2Content.content).toContain("instances: 4");
      expect(pm2Content.content).toContain("watch: true");

      // Parse PM2 back to services
      const parsed = parsePM2Content(pm2Content.content);

      expect(parsed).toHaveLength(1);
      expect(parsed[0].name).toBe("api");
      expect(parsed[0].advanced).toBeDefined();
      expect(parsed[0].advanced!.instances).toBe(4);
      expect(parsed[0].advanced!.watch).toBe(true);
    });
  });
});