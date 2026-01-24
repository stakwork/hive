import { ServiceDataConfig } from "@/components/stakgraph/types";
import { ServiceConfig } from "@/services/swarm/db";

// These are service configuration commands, not actual env vars to persist
// Used to filter out non-sensitive/non-secret values when saving or displaying
export const SERVICE_CONFIG_ENV_VARS = [
  "PORT",
  "INSTALL_COMMAND",
  "TEST_COMMAND",
  "BUILD_COMMAND",
  "E2E_TEST_COMMAND",
  "PRE_START_COMMAND",
  "POST_START_COMMAND",
  "REBUILD_COMMAND",
  "RESET_COMMAND",
];

export interface DevContainerFile {
  name: string;
  content: string;
  type: string;
}

// Helper function to generate PM2 apps from services data
export const generatePM2Apps = (
  repoName: string,
  servicesData: ServiceDataConfig[],
  globalEnvVars?: Array<{ name: string; value: string }>
) => {
  if (!servicesData || servicesData.length === 0) {
    // Build env object with merged variables
    const env: Record<string, string> = {};

    // 1. First apply global env vars (skip empty names)
    if (globalEnvVars) {
      globalEnvVars.forEach((envVar) => {
        if (envVar.name.trim()) {
          env[envVar.name] = envVar.value;
        }
      });
    }

    // 2. Then apply command-related defaults (override globals)
    env.INSTALL_COMMAND = "npm install";
    env.TEST_COMMAND = "npm test";
    env.BUILD_COMMAND = "npm run build";
    env.E2E_TEST_COMMAND = "npx playwright test";
    env.PORT = "3000";

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
        env,
      },
    ];
  }

  return servicesData.map((service) => {
    // If cwd is specified, treat it as a subdirectory within the workspace
    // Otherwise use the workspace root
    const cwd = service.cwd ? `/workspaces/${repoName}/${service.cwd.replace(/^\/+/, "")}` : `/workspaces/${repoName}`;

    const appConfig = {
      name: service.name,
      script: service.scripts?.start || "",
      cwd,
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      env: {} as Record<string, string>,
      interpreter: service.interpreter?.toString(),
    };

    // Environment variable merging with correct precedence:
    // 1. Global env vars (lowest priority, skip empty names)
    if (globalEnvVars) {
      globalEnvVars.forEach((envVar) => {
        if (envVar.name.trim()) {
          appConfig.env[envVar.name] = envVar.value;
        }
      });
    }

    // 2. Service-specific env vars from service.env (overrides globals)
    if (service.env) {
      Object.entries(service.env).forEach(([key, value]) => {
        appConfig.env[key] = String(value);
      });
    }

    // 3. Command-related variables and PORT (highest priority, override everything)
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
    instances: number;
    autorestart: boolean;
    watch: boolean;
    interpreter?: string;
    max_memory_restart: string;
    env: Record<string, string>;
  }>,
) => {
  const formattedApps = apps.map((app) => {
    const envEntries = Object.entries(app.env)
      .map(([key, value]) => `        ${key}: "${value}"`)
      .join(",\n");

    const interpreterLine = app.interpreter ? `      interpreter: "${app.interpreter}",\n` : "";

    return `    {
      name: "${app.name}",
      script: "${app.script}",
      cwd: "${app.cwd}",
      instances: ${app.instances},
      autorestart: ${app.autorestart},
      watch: ${app.watch},
${interpreterLine}      max_memory_restart: "${app.max_memory_restart}",
      env: {
${envEntries}
      }
    }`;
  });

  return `[\n${formattedApps.join(",\n")}\n  ]`;
};

/**
 * Mask env var values in PM2 config content for display purposes
 * Only masks values inside env: { } blocks, not other config like name, script, etc.
 */
/**
 * Extract all env vars from PM2 config, grouped by service name
 * Filters out script commands and PORT which are service config, not env vars
 * Returns a map of service name -> env vars array
 */
export const extractEnvVarsFromPM2Config = (
  pm2Content: string
): Map<string, Array<{ name: string; value: string }>> => {
  const result = new Map<string, Array<{ name: string; value: string }>>();

  try {
    // Match each app block to get service name and env block
    const appBlockRegex = /\{\s*name:\s*["']([^"']+)["'][^}]*env:\s*\{([^}]*)\}/g;
    let match;

    while ((match = appBlockRegex.exec(pm2Content)) !== null) {
      const serviceName = match[1];
      const envBlock = match[2];
      const envVars: Array<{ name: string; value: string }> = [];

      // Parse individual env var entries
      const envVarRegex = /(\w+):\s*["']([^"']*)["']/g;
      let envMatch;

      while ((envMatch = envVarRegex.exec(envBlock)) !== null) {
        const varName = envMatch[1];
        // Skip service config vars (scripts and PORT)
        if (!SERVICE_CONFIG_ENV_VARS.includes(varName)) {
          envVars.push({ name: varName, value: envMatch[2] });
        }
      }

      if (envVars.length > 0) {
        result.set(serviceName, envVars);
      }
    }
  } catch (error) {
    console.warn("[extractEnvVarsFromPM2Config] Failed to parse PM2 config:", error);
  }

  return result;
};

export const maskEnvVarsInPM2Config = (pm2Content: string): string => {
  // Find and replace only the env: { ... } blocks
  return pm2Content.replace(
    /env:\s*\{([^}]*)\}/g,
    (envBlock) => {
      // Within each env block, mask the values
      return envBlock.replace(
        /(\s+)(\w+):\s*["']([^"']*)["']/g,
        (match, whitespace, key, _value) => {
          // Don't mask service config vars (non-sensitive)
          if (SERVICE_CONFIG_ENV_VARS.includes(key)) {
            return match;
          }
          // Mask the value
          return `${whitespace}${key}: "****"`;
        }
      );
    }
  );
};

export const getPM2AppsContent = (
  repoName: string,
  servicesData: ServiceDataConfig[],
  globalEnvVars?: Array<{ name: string; value: string }>
) => {
  const pm2Apps = generatePM2Apps(repoName, servicesData, globalEnvVars);
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
