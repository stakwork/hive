import { ServiceDataConfig } from "@/components/stakgraph/types";
import { ServiceConfig } from "@/services/swarm/db";

export interface DevContainerFile {
  name: string;
  content: string;
  type: string;
}

// PM2-specific settings that aren't in the services schema
export interface PM2Settings {
  instances?: number | string;
  autorestart?: boolean;
  watch?: boolean;
  max_memory_restart?: string;
  exec_mode?: string;
}

// Default PM2 settings
const DEFAULT_PM2_SETTINGS: PM2Settings = {
  instances: 1,
  autorestart: true,
  watch: false,
  max_memory_restart: "1G",
};

/**
 * Extract PM2-specific settings from existing pm2.config.js content
 * Returns a map of service name -> PM2 settings
 */
export function extractPM2Settings(pm2Content: string | undefined): Map<string, PM2Settings> {
  const settingsMap = new Map<string, PM2Settings>();
  if (!pm2Content) return settingsMap;

  try {
    // Match the apps array
    const appsMatch = pm2Content.match(/apps:\s*\[([\s\S]*?)\]/);
    if (!appsMatch) return settingsMap;

    const appsContent = appsMatch[1];
    const serviceBlocks = appsContent.split(/(?=name:)/);

    for (const block of serviceBlocks) {
      if (!block.trim()) continue;

      const nameMatch = block.match(/name:\s*["']([^"']+)["']/);
      if (!nameMatch) continue;

      const serviceName = nameMatch[1];
      const settings: PM2Settings = {};

      // Extract instances (can be number or "max")
      const instancesMatch = block.match(/instances:\s*(?:["']([^"']+)["']|(\d+))/);
      if (instancesMatch) {
        settings.instances = instancesMatch[1] || parseInt(instancesMatch[2]);
      }

      // Extract autorestart
      const autorestartMatch = block.match(/autorestart:\s*(true|false)/);
      if (autorestartMatch) {
        settings.autorestart = autorestartMatch[1] === "true";
      }

      // Extract watch
      const watchMatch = block.match(/watch:\s*(true|false)/);
      if (watchMatch) {
        settings.watch = watchMatch[1] === "true";
      }

      // Extract max_memory_restart
      const maxMemMatch = block.match(/max_memory_restart:\s*["']([^"']+)["']/);
      if (maxMemMatch) {
        settings.max_memory_restart = maxMemMatch[1];
      }

      // Extract exec_mode
      const execModeMatch = block.match(/exec_mode:\s*["']([^"']+)["']/);
      if (execModeMatch) {
        settings.exec_mode = execModeMatch[1];
      }

      settingsMap.set(serviceName, settings);
    }
  } catch (error) {
    console.error("Failed to extract PM2 settings:", error);
  }

  return settingsMap;
}

// Helper function to generate PM2 apps from services data
export const generatePM2Apps = (
  repoName: string,
  servicesData: ServiceDataConfig[],
  existingPM2Settings?: Map<string, PM2Settings>
) => {
  if (!servicesData || servicesData.length === 0) {
    // Return default configuration if no services
    return [
      {
        name: "default-service",
        script: "npm start",
        cwd: `/workspaces/${repoName}`,
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
      },
    ];
  }

  return servicesData.map((service) => {
    // If cwd is specified, treat it as a subdirectory within the workspace
    // Otherwise use the workspace root
    const cwd = service.cwd ? `/workspaces/${repoName}/${service.cwd.replace(/^\/+/, "")}` : `/workspaces/${repoName}`;

    // Get existing PM2 settings for this service, or use defaults
    const existingSettings = existingPM2Settings?.get(service.name) || {};
    const pm2Settings = { ...DEFAULT_PM2_SETTINGS, ...existingSettings };

    const appConfig = {
      name: service.name,
      script: service.scripts?.start || "",
      cwd,
      instances: pm2Settings.instances,
      autorestart: pm2Settings.autorestart,
      watch: pm2Settings.watch,
      max_memory_restart: pm2Settings.max_memory_restart,
      exec_mode: pm2Settings.exec_mode,
      env: {} as Record<string, string>,
      interpreter: service.interpreter?.toString(),
    };

    if (service.port) {
      appConfig.env.PORT = service.port.toString();
    }

    if (service.scripts?.install) {
      appConfig.env.INSTALL_COMMAND = service.scripts.install;
    }

    if (service.scripts?.test) {
      appConfig.env.TEST_COMMAND = service.scripts.test;
    }

    if (service.scripts?.e2eTest) {
      appConfig.env.E2E_TEST_COMMAND = service.scripts.e2eTest;
    }

    if (service.scripts?.build) {
      appConfig.env.BUILD_COMMAND = service.scripts.build;
    }

    if (service.scripts?.preStart) {
      appConfig.env.PRE_START_COMMAND = service.scripts.preStart;
    }

    if (service.scripts?.postStart) {
      appConfig.env.POST_START_COMMAND = service.scripts.postStart;
    }

    if (service.scripts?.rebuild) {
      appConfig.env.REBUILD_COMMAND = service.scripts.rebuild;
    }

    if (service.scripts?.reset) {
      appConfig.env.RESET_COMMAND = service.scripts.reset;
    }

    return appConfig;
  });
};

// Helper function to format PM2 apps as JavaScript string
export const formatPM2Apps = (
  apps: Array<{
    name: string;
    script: string;
    cwd: string;
    instances?: number | string;
    autorestart?: boolean;
    watch?: boolean;
    interpreter?: string;
    exec_mode?: string;
    max_memory_restart?: string;
    env: Record<string, string>;
  }>,
) => {
  const formattedApps = apps.map((app) => {
    const envEntries = Object.entries(app.env)
      .map(([key, value]) => `        ${key}: "${value}"`)
      .join(",\n");

    const interpreterLine = app.interpreter ? `      interpreter: "${app.interpreter}",\n` : "";
    const execModeLine = app.exec_mode ? `      exec_mode: "${app.exec_mode}",\n` : "";

    // Format instances - could be number or string like "max"
    const instancesValue = typeof app.instances === "string" ? `"${app.instances}"` : (app.instances ?? 1);

    return `    {
      name: "${app.name}",
      script: "${app.script}",
      cwd: "${app.cwd}",
      instances: ${instancesValue},
      autorestart: ${app.autorestart ?? true},
      watch: ${app.watch ?? false},
${interpreterLine}${execModeLine}      max_memory_restart: "${app.max_memory_restart ?? "1G"}",
      env: {
${envEntries}
      }
    }`;
  });

  return `[\n${formattedApps.join(",\n")}\n  ]`;
};

export const getPM2AppsContent = (
  repoName: string,
  servicesData: ServiceDataConfig[],
  existingPM2Content?: string
) => {
  // Extract existing PM2 settings to preserve them during regeneration
  const existingSettings = existingPM2Content ? extractPM2Settings(existingPM2Content) : undefined;
  const pm2Apps = generatePM2Apps(repoName, servicesData, existingSettings);
  const pm2AppFormatted = formatPM2Apps(pm2Apps);

  return {
    name: "pm2.config.js",
    content: `module.exports = {
  apps: ${pm2AppFormatted},
};
`,
    type: "javascript",
  };
};

export function devcontainerJsonContent(repoName: string) {
  return `{
  "name": "${repoName}",
  "dockerComposeFile": "./docker-compose.yml",
  "workspaceFolder": "/workspaces",
  "features": {
    "ghcr.io/devcontainers/features/docker-outside-of-docker": {}
  },
  "customizations": {
    "vscode": {
      "settings": {
        "git.autofetch": true,
        "editor.formatOnSave": true,
        "telemetry.telemetryLevel": "off",
        "editor.defaultFormatter": "esbenp.prettier-vscode"
      },
      "extensions": [
        "stakwork.staklink",
        "esbenp.prettier-vscode"
      ]
    }
  }
}`;
}

export function dockerComposeContent() {
  return `version: '3.8'
networks:
  app_network:
    driver: bridge
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    volumes:
      - ../..:/workspaces:cached
    command: sleep infinity
    networks:
      - app_network
    extra_hosts:
      - "localhost:172.17.0.1"
      - "host.docker.internal:host-gateway"
`;
}

export function dockerfileContent() {
  return `FROM ghcr.io/stakwork/staklink-js:v0.1.2
`;
}

const fileTypeMapper = {
  "devcontainer.json": "json",
  "pm2.config.js": "javascript",
  "docker-compose.yml": "yaml",
  Dockerfile: "dockerfile",
};

const fileNamesMapper = {
  "devcontainer.json": "devcontainer_json",
  "pm2.config.js": "pm2_config_js",
  "docker-compose.yml": "docker_compose_yml",
  Dockerfile: "dockerfile",
};

// Parse pm2.config.js content regardless of encoding (plain text or base64)
export function parsePM2Content(content: string | undefined): ServiceConfig[] {
  if (!content) return [];

  const services: ServiceConfig[] = [];

  // Helper function to parse pm2.config.js content to extract ServiceConfig[]
  const parsePM2ConfigToServices = (pm2Content: string): ServiceConfig[] => {
    console.log(">>> pm2Content", pm2Content);
    const parsedServices: ServiceConfig[] = [];

    try {
      // Match the apps array in the module.exports
      const appsMatch = pm2Content.match(/apps:\s*\[([\s\S]*?)\]/);
      if (!appsMatch) return parsedServices;

      const appsContent = appsMatch[1];

      // Split by service objects (look for name: pattern)
      const serviceBlocks = appsContent.split(/(?=name:)/);

      for (const block of serviceBlocks) {
        if (!block.trim()) continue;

        // Extract fields using regex
        const nameMatch = block.match(/name:\s*["']([^"']+)["']/);
        const scriptMatch = block.match(/script:\s*["']([^"']+)["']/);
        const cwdMatch = block.match(/cwd:\s*["']([^"']+)["']/);
        const interpreterMatch = block.match(/interpreter:\s*["']([^"']+)["']/);

        // Extract env variables
        const envMatch = block.match(/env:\s*\{([\s\S]*?)\}/);
        let port = 3000;
        let installCmd: string | undefined;
        let buildCmd: string | undefined;
        let testCmd: string | undefined;
        let preStartCmd: string | undefined;
        let postStartCmd: string | undefined;
        let rebuildCmd: string | undefined;
        let resetCmd: string | undefined;

        if (envMatch) {
          const envContent = envMatch[1];
          const portMatch = envContent.match(/PORT:\s*["'](\d+)["']/);
          const installMatch = envContent.match(/INSTALL_COMMAND:\s*["']([^"']+)["']/);
          const buildMatch = envContent.match(/BUILD_COMMAND:\s*["']([^"']+)["']/);
          const testMatch = envContent.match(/TEST_COMMAND:\s*["']([^"']+)["']/);
          const preStartMatch = envContent.match(/PRE_START_COMMAND:\s*["']([^"']+)["']/);
          const postStartMatch = envContent.match(/POST_START_COMMAND:\s*["']([^"']+)["']/);
          const rebuildMatch = envContent.match(/REBUILD_COMMAND:\s*["']([^"']+)["']/);
          const resetMatch = envContent.match(/RESET_COMMAND:\s*["']([^"']+)["']/);

          if (portMatch) port = parseInt(portMatch[1]);
          if (installMatch) installCmd = installMatch[1];
          if (buildMatch) buildCmd = buildMatch[1];
          if (testMatch) testCmd = testMatch[1];
          if (preStartMatch) preStartCmd = preStartMatch[1];
          if (postStartMatch) postStartCmd = postStartMatch[1];
          if (rebuildMatch) rebuildCmd = rebuildMatch[1];
          if (resetMatch) resetCmd = resetMatch[1];
        }

        if (nameMatch && scriptMatch) {
          // Extract cwd to determine if it's a subdirectory
          let serviceDir: string | undefined;
          if (cwdMatch) {
            const cwdPath = cwdMatch[1];
            // Extract subdirectory from path like /workspaces/reponame/subdirectory
            const pathParts = cwdPath.split("/").filter((p) => p);
            if (pathParts.length > 2) {
              // Has subdirectory beyond /workspaces/reponame
              serviceDir = pathParts.slice(2).join("/");
            }
          }

          const service: ServiceConfig = {
            name: nameMatch[1],
            port,
            cwd: serviceDir,
            interpreter: interpreterMatch ? interpreterMatch[1] : undefined,
            scripts: {
              start: scriptMatch[1],
              install: installCmd,
              build: buildCmd,
              test: testCmd,
              preStart: preStartCmd,
              postStart: postStartCmd,
              rebuild: rebuildCmd,
              reset: resetCmd,
            },
          };

          parsedServices.push(service);
        }
      }
    } catch (error) {
      console.error("Failed to parse pm2.config.js:", error);
    }

    return parsedServices;
  };

  // Try plain text first, then base64
  try {
    return parsePM2ConfigToServices(content);
  } catch {
    try {
      const decoded = Buffer.from(content, "base64").toString("utf-8");
      return parsePM2ConfigToServices(decoded);
    } catch {
      console.error("Failed to parse pm2.config.js");
      return services;
    }
  }
}

export const getDevContainerFilesFromBase64 = (base64Files: Record<string, string>) => {
  const containerFiles = Object.entries(base64Files).reduce(
    (acc, [name, content]) => {
      const keyName = fileNamesMapper[name as keyof typeof fileNamesMapper];
      acc[keyName] = {
        name: keyName,
        content: Buffer.from(content, "base64").toString("utf-8"),
        type: fileTypeMapper[name as keyof typeof fileTypeMapper],
      };
      return acc;
    },
    {} as Record<string, DevContainerFile>,
  );

  return containerFiles;
};
