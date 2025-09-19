import { describe, test, expect, beforeEach } from "vitest";
import { 
  generatePM2Apps,
  formatPM2Apps,
  getPM2AppsContent,
  devcontainerJsonContent,
  dockerComposeContent,
  dockerfileContent,
  getDevContainerFiles,
  parsePM2Content,
  parsePM2ConfigToServices,
  getDevContainerFilesFromBase64
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

  describe("devcontainerJsonContent", () => {
    test("should generate valid devcontainer.json content with repo name", () => {
      const result = devcontainerJsonContent("my-awesome-repo");

      // Parse the JSON to validate structure
      const parsed = JSON.parse(result);

      expect(parsed.name).toBe("my-awesome-repo");
      expect(parsed.dockerComposeFile).toBe("./docker-compose.yml");
      expect(parsed.workspaceFolder).toBe("/workspaces");
      expect(parsed.features).toHaveProperty("ghcr.io/devcontainers/features/docker-outside-of-docker");
      expect(parsed.customizations.vscode.settings).toHaveProperty("git.autofetch", true);
      expect(parsed.customizations.vscode.settings).toHaveProperty("editor.formatOnSave", true);
      expect(parsed.customizations.vscode.settings).toHaveProperty("telemetry.telemetryLevel", "off");
      expect(parsed.customizations.vscode.settings).toHaveProperty("editor.defaultFormatter", "esbenp.prettier-vscode");
      expect(parsed.customizations.vscode.extensions).toContain("stakwork.staklink");
      expect(parsed.customizations.vscode.extensions).toContain("esbenp.prettier-vscode");
    });

    test("should handle repo names with special characters", () => {
      const result = devcontainerJsonContent("my-repo_123");
      const parsed = JSON.parse(result);

      expect(parsed.name).toBe("my-repo_123");
    });

    test("should handle empty repo name", () => {
      const result = devcontainerJsonContent("");
      const parsed = JSON.parse(result);

      expect(parsed.name).toBe("");
    });

    test("should generate properly formatted JSON", () => {
      const result = devcontainerJsonContent("test-repo");

      // Should be valid JSON
      expect(() => JSON.parse(result)).not.toThrow();
      
      // Should contain all required sections
      expect(result).toContain('"name"');
      expect(result).toContain('"dockerComposeFile"');
      expect(result).toContain('"workspaceFolder"');
      expect(result).toContain('"features"');
      expect(result).toContain('"customizations"');
    });
  });

  describe("dockerComposeContent", () => {
    test("should generate valid Docker Compose YAML content", () => {
      const result = dockerComposeContent();

      expect(result).toContain("version: '3.8'");
      expect(result).toContain("networks:");
      expect(result).toContain("app_network:");
      expect(result).toContain("driver: bridge");
      expect(result).toContain("services:");
      expect(result).toContain("app:");
      expect(result).toContain("build:");
      expect(result).toContain("context: .");
      expect(result).toContain("dockerfile: Dockerfile");
      expect(result).toContain("volumes:");
      expect(result).toContain("- ../..:/workspaces:cached");
      expect(result).toContain("command: sleep infinity");
      expect(result).toContain("networks:");
      expect(result).toContain("- app_network");
      expect(result).toContain("extra_hosts:");
      expect(result).toContain('- "localhost:172.17.0.1"');
      expect(result).toContain('- "host.docker.internal:host-gateway"');
    });

    test("should generate consistent output", () => {
      const result1 = dockerComposeContent();
      const result2 = dockerComposeContent();

      expect(result1).toBe(result2);
    });

    test("should end with newline", () => {
      const result = dockerComposeContent();
      
      expect(result.endsWith('\n')).toBe(true);
    });
  });

  describe("dockerfileContent", () => {
    test("should generate Dockerfile with staklink base image", () => {
      const result = dockerfileContent();

      expect(result).toBe("FROM ghcr.io/stakwork/staklink-js:v0.1.2\n");
    });

    test("should generate consistent output", () => {
      const result1 = dockerfileContent();
      const result2 = dockerfileContent();

      expect(result1).toBe(result2);
    });

    test("should end with newline", () => {
      const result = dockerfileContent();
      
      expect(result.endsWith('\n')).toBe(true);
    });
  });

  describe("getDevContainerFiles", () => {
    test("should generate all required dev container files", () => {
      const serviceData: ServiceDataConfig[] = [
        {
          name: "test-service",
          port: 3000,
          scripts: {
            start: "npm run dev",
          },
        },
      ];

      const result = getDevContainerFiles({
        repoName: "test-repo",
        servicesData: serviceData,
      });

      // Should have all 4 required files
      expect(Object.keys(result)).toHaveLength(4);
      expect(result).toHaveProperty("devcontainer_json");
      expect(result).toHaveProperty("pm2_config_js");
      expect(result).toHaveProperty("docker_compose_yml");
      expect(result).toHaveProperty("dockerfile");

      // Validate devcontainer.json file
      expect(result.devcontainer_json.name).toBe("devcontainer.json");
      expect(result.devcontainer_json.type).toBe("json");
      expect(() => JSON.parse(result.devcontainer_json.content)).not.toThrow();

      // Validate pm2.config.js file
      expect(result.pm2_config_js.name).toBe("pm2.config.js");
      expect(result.pm2_config_js.type).toBe("javascript");
      expect(result.pm2_config_js.content).toContain("module.exports = {");
      expect(result.pm2_config_js.content).toContain("apps: [");

      // Validate docker-compose.yml file
      expect(result.docker_compose_yml.name).toBe("docker-compose.yml");
      expect(result.docker_compose_yml.type).toBe("yaml");
      expect(result.docker_compose_yml.content).toContain("version: '3.8'");

      // Validate Dockerfile
      expect(result.dockerfile.name).toBe("Dockerfile");
      expect(result.dockerfile.type).toBe("dockerfile");
      expect(result.dockerfile.content).toContain("FROM ghcr.io/stakwork/staklink-js");
    });

    test("should work with empty services data", () => {
      const result = getDevContainerFiles({
        repoName: "empty-repo",
        servicesData: [],
      });

      expect(Object.keys(result)).toHaveLength(4);
      expect(result.pm2_config_js.content).toContain('name: "default-service"');
    });

    test("should work with multiple services", () => {
      const serviceData: ServiceDataConfig[] = [
        {
          name: "frontend",
          port: 3000,
          scripts: { start: "npm run dev" },
        },
        {
          name: "backend",
          port: 8080,
          interpreter: "python",
          scripts: { start: "python app.py" },
        },
      ];

      const result = getDevContainerFiles({
        repoName: "multi-service-repo",
        servicesData: serviceData,
      });

      expect(result.pm2_config_js.content).toContain('name: "frontend"');
      expect(result.pm2_config_js.content).toContain('name: "backend"');
      expect(result.pm2_config_js.content).toContain('interpreter: "python"');
    });

    test("should use correct repo name in all files", () => {
      const result = getDevContainerFiles({
        repoName: "custom-repo-name",
        servicesData: [],
      });

      // Check devcontainer.json
      const devcontainerJson = JSON.parse(result.devcontainer_json.content);
      expect(devcontainerJson.name).toBe("custom-repo-name");

      // Check PM2 config
      expect(result.pm2_config_js.content).toContain("/workspaces/custom-repo-name");
    });
  });

  describe("parsePM2Content", () => {
    test("should parse valid PM2 config content", () => {
      const pm2Content = `module.exports = {
  apps: [
    {
      name: "test-app",
      script: "npm start",
      cwd: "/workspaces/test-repo",
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {
        PORT: "3000",
        INSTALL_COMMAND: "npm install",
        BUILD_COMMAND: "npm run build"
      }
    }
  ]
};`;

      const result = parsePM2Content(pm2Content);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("test-app");
      expect(result[0].port).toBe(3000);
      expect(result[0].scripts.start).toBe("npm start");
      expect(result[0].scripts.install).toBe("npm install");
      expect(result[0].scripts.build).toBe("npm run build");
    });

    test("should parse base64 encoded PM2 content", () => {
      const pm2Content = `module.exports = {
  apps: [
    {
      name: "base64-app",
      script: "python app.py",
      cwd: "/workspaces/python-repo",
      env: {
        PORT: "8080"
      }
    }
  ]
};`;
      const base64Content = Buffer.from(pm2Content, 'utf-8').toString('base64');

      const result = parsePM2Content(base64Content);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("base64-app");
      expect(result[0].port).toBe(8080);
      expect(result[0].scripts.start).toBe("python app.py");
    });

    test("should return empty array for undefined content", () => {
      const result = parsePM2Content(undefined);

      expect(result).toEqual([]);
    });

    test("should return empty array for empty content", () => {
      const result = parsePM2Content("");

      expect(result).toEqual([]);
    });

    test("should handle malformed content gracefully", () => {
      const result = parsePM2Content("invalid content");

      expect(result).toEqual([]);
    });

    test("should handle malformed base64 content gracefully", () => {
      const result = parsePM2Content("invalid-base64!");

      expect(result).toEqual([]);
    });
  });

  describe("parsePM2ConfigToServices", () => {
    test("should parse complete PM2 config with all fields", () => {
      const pm2Content = `module.exports = {
  apps: [
    {
      name: "full-app",
      script: "npm run dev",
      cwd: "/workspaces/test-repo/frontend",
      instances: 1,
      autorestart: true,
      watch: false,
      interpreter: "node",
      max_memory_restart: "1G",
      env: {
        PORT: "3000",
        INSTALL_COMMAND: "npm ci",
        BUILD_COMMAND: "npm run build",
        TEST_COMMAND: "npm test",
        PRE_START_COMMAND: "npm run setup",
        POST_START_COMMAND: "npm run seed",
        REBUILD_COMMAND: "npm run clean && npm run build"
      }
    }
  ]
};`;

      const result = parsePM2ConfigToServices(pm2Content);

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        name: "full-app",
        port: 3000,
        cwd: "frontend",
        interpreter: "node",
        scripts: {
          start: "npm run dev",
          install: "npm ci",
          build: "npm run build",
          test: "npm test",
          preStart: "npm run setup",
          postStart: "npm run seed",
          rebuild: "npm run clean && npm run build",
        },
      });
    });

    test("should parse multiple services", () => {
      const pm2Content = `module.exports = {
  apps: [
    {
      name: "frontend",
      script: "npm start",
      cwd: "/workspaces/repo/frontend",
      env: {
        PORT: "3000"
      }
    },
    {
      name: "backend",
      script: "python manage.py runserver",
      cwd: "/workspaces/repo/backend",
      interpreter: "python",
      env: {
        PORT: "8000",
        TEST_COMMAND: "pytest"
      }
    }
  ]
};`;

      const result = parsePM2ConfigToServices(pm2Content);

      expect(result).toHaveLength(2);
      
      expect(result[0].name).toBe("frontend");
      expect(result[0].port).toBe(3000);
      expect(result[0].cwd).toBe("frontend");
      expect(result[0].scripts.start).toBe("npm start");
      expect(result[0].interpreter).toBeUndefined();

      expect(result[1].name).toBe("backend");
      expect(result[1].port).toBe(8000);
      expect(result[1].cwd).toBe("backend");
      expect(result[1].interpreter).toBe("python");
      expect(result[1].scripts.start).toBe("python manage.py runserver");
      expect(result[1].scripts.test).toBe("pytest");
    });

    test("should handle services without subdirectories", () => {
      const pm2Content = `module.exports = {
  apps: [
    {
      name: "root-app",
      script: "node server.js",
      cwd: "/workspaces/simple-repo",
      env: {
        PORT: "4000"
      }
    }
  ]
};`;

      const result = parsePM2ConfigToServices(pm2Content);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("root-app");
      expect(result[0].cwd).toBeUndefined(); // Should be undefined for root directory
      expect(result[0].port).toBe(4000);
    });

    test("should handle missing environment variables", () => {
      const pm2Content = `module.exports = {
  apps: [
    {
      name: "minimal-app",
      script: "yarn start",
      cwd: "/workspaces/minimal-repo"
    }
  ]
};`;

      const result = parsePM2ConfigToServices(pm2Content);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("minimal-app");
      expect(result[0].port).toBe(3000); // Default port
      expect(result[0].scripts.start).toBe("yarn start");
      expect(result[0].scripts.install).toBeUndefined();
    });

    test("should return empty array for invalid content", () => {
      const result = parsePM2ConfigToServices("invalid content");

      expect(result).toEqual([]);
    });

    test("should return empty array for content without apps array", () => {
      const pm2Content = `module.exports = {
  settings: {
    daemon: false
  }
};`;

      const result = parsePM2ConfigToServices(pm2Content);

      expect(result).toEqual([]);
    });

    test("should handle services with empty env objects", () => {
      const pm2Content = `module.exports = {
  apps: [
    {
      name: "empty-env-app",
      script: "python app.py",
      cwd: "/workspaces/test",
      env: {}
    }
  ]
};`;

      const result = parsePM2ConfigToServices(pm2Content);

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("empty-env-app");
      expect(result[0].port).toBe(3000); // Default port
      expect(result[0].scripts.start).toBe("python app.py");
    });

    test("should handle malformed JSON gracefully", () => {
      const pm2Content = `module.exports = {
  apps: [
    {
      name: "broken-app"
      script: "missing comma"
    }
  ]
};`;

      const result = parsePM2ConfigToServices(pm2Content);

      expect(result).toEqual([]);
    });
  });

  describe("getDevContainerFilesFromBase64", () => {
    test("should decode and convert base64 files correctly", () => {
      const devcontainerJson = JSON.stringify({ name: "test-repo" });
      const pm2Config = "module.exports = { apps: [] };";
      const dockerCompose = "version: '3.8'";
      const dockerfile = "FROM node:18";

      const base64Files = {
        "devcontainer.json": Buffer.from(devcontainerJson, "utf-8").toString("base64"),
        "pm2.config.js": Buffer.from(pm2Config, "utf-8").toString("base64"),
        "docker-compose.yml": Buffer.from(dockerCompose, "utf-8").toString("base64"),
        "Dockerfile": Buffer.from(dockerfile, "utf-8").toString("base64"),
      };

      const result = getDevContainerFilesFromBase64(base64Files);

      expect(Object.keys(result)).toHaveLength(4);

      // Check devcontainer.json
      expect(result.devcontainer_json.name).toBe("devcontainer_json");
      expect(result.devcontainer_json.content).toBe(devcontainerJson);
      expect(result.devcontainer_json.type).toBe("json");

      // Check pm2.config.js
      expect(result.pm2_config_js.name).toBe("pm2_config_js");
      expect(result.pm2_config_js.content).toBe(pm2Config);
      expect(result.pm2_config_js.type).toBe("javascript");

      // Check docker-compose.yml
      expect(result.docker_compose_yml.name).toBe("docker_compose_yml");
      expect(result.docker_compose_yml.content).toBe(dockerCompose);
      expect(result.docker_compose_yml.type).toBe("yaml");

      // Check Dockerfile
      expect(result.dockerfile.name).toBe("dockerfile");
      expect(result.dockerfile.content).toBe(dockerfile);
      expect(result.dockerfile.type).toBe("dockerfile");
    });

    test("should handle partial file sets", () => {
      const base64Files = {
        "devcontainer.json": Buffer.from('{"name": "partial"}', "utf-8").toString("base64"),
        "Dockerfile": Buffer.from("FROM alpine", "utf-8").toString("base64"),
      };

      const result = getDevContainerFilesFromBase64(base64Files);

      expect(Object.keys(result)).toHaveLength(2);
      expect(result.devcontainer_json.content).toBe('{"name": "partial"}');
      expect(result.dockerfile.content).toBe("FROM alpine");
    });

    test("should handle empty input", () => {
      const result = getDevContainerFilesFromBase64({});

      expect(result).toEqual({});
    });

    test("should decode complex content correctly", () => {
      const complexJson = JSON.stringify({
        name: "complex-repo",
        dockerComposeFile: "./docker-compose.yml",
        features: { "docker-in-docker": {} },
        customizations: {
          vscode: {
            extensions: ["ms-python.python", "esbenp.prettier-vscode"]
          }
        }
      }, null, 2);

      const base64Files = {
        "devcontainer.json": Buffer.from(complexJson, "utf-8").toString("base64"),
      };

      const result = getDevContainerFilesFromBase64(base64Files);

      expect(result.devcontainer_json.content).toBe(complexJson);
      
      // Verify it's valid JSON
      const parsed = JSON.parse(result.devcontainer_json.content);
      expect(parsed.name).toBe("complex-repo");
      expect(parsed.customizations.vscode.extensions).toContain("ms-python.python");
    });

    test("should handle malformed base64 gracefully", () => {
      const base64Files = {
        "devcontainer.json": "invalid-base64-content!@#",
      };

      // This should not throw, but the content might be corrupted
      // Buffer.from handles invalid base64 by attempting to decode what it can
      expect(() => getDevContainerFilesFromBase64(base64Files)).not.toThrow();
    });

    test("should preserve exact content after base64 round trip", () => {
      const originalContent = `module.exports = {
  apps: [
    {
      name: "test-app",
      script: "npm start",
      env: {
        PORT: "3000",
        NODE_ENV: "development"
      }
    }
  ]
};`;

      const base64 = Buffer.from(originalContent, "utf-8").toString("base64");
      const base64Files = {
        "pm2.config.js": base64,
      };

      const result = getDevContainerFilesFromBase64(base64Files);

      expect(result.pm2_config_js.content).toBe(originalContent);
    });
  });
});