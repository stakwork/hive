import { ServiceDataConfig } from "@/components/stakgraph/types";
import { ServiceConfig } from "@/services/swarm/db";

/**
 * Resolves a service's cwd field to an absolute /workspaces path.
 * 
 * @param cwd - The cwd value from the service config (can be empty, relative, or absolute)
 * @param repoNames - Array of repository names in the workspace
 * @param defaultRepoName - The primary/first repository name (fallback)
 * @returns The resolved absolute cwd path
 */
export function resolveCwd(
  cwd: string | undefined,
  repoNames: string[],
  defaultRepoName: string
): string {
  // Step 1: Handle empty cwd - use default repo
  if (!cwd || cwd.trim() === "") {
    return `/workspaces/${defaultRepoName}`;
  }

  const trimmedCwd = cwd.trim();

  // Step 2: Already absolute path - use as-is
  if (trimmedCwd.startsWith("/workspaces/")) {
    return trimmedCwd;
  }

  // Step 3: Single repo - treat as relative to that repo, but avoid duplicating
  // the repo name when cwd already starts with it (e.g. cwd="sphinx-tribes" + repo="sphinx-tribes")
  if (repoNames.length <= 1) {
    const cleanedCwd = trimmedCwd.replace(/^\/+/, "");
    const segments = cleanedCwd.split("/");
    if (segments[0] === defaultRepoName) {
      return `/workspaces/${cleanedCwd}`;
    }
    return `/workspaces/${defaultRepoName}/${cleanedCwd}`;
  }

  // Step 4: Multiple repos - check if first segment matches a repo name
  const segments = trimmedCwd.replace(/^\/+/, "").split("/");
  const firstSegment = segments[0];

  // Step 5: First segment matches a repo name exactly - use that repo
  if (repoNames.includes(firstSegment)) {
    return `/workspaces/${segments.join("/")}`;
  }

  // Step 6: No repo match - treat as relative to default repo
  return `/workspaces/${defaultRepoName}/${trimmedCwd.replace(/^\/+/, "")}`;
}

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
export function generatePM2Apps(
  repoNames: string[],
  servicesData: ServiceDataConfig[],
  globalEnvVars?: Array<{ name: string; value: string }>,
): Array<Record<string, unknown>> {
  const defaultRepoName = repoNames[0] || "workspace";

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
        cwd: `/workspaces/${defaultRepoName}`,
        instances: 1,
        autorestart: true,
        watch: false,
        max_memory_restart: "1G",
        env,
      },
    ];
  }

  return servicesData.map((service) => {
    // Resolve cwd using smart logic for single/multi-repo workspaces
    const cwd = resolveCwd(service.cwd, repoNames, defaultRepoName);

    const appConfig = {
      name: service.name,
      script: service.scripts?.start || "",
      cwd,
      // defaults (can be overridden by advanced)
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: "1G",
      // advanced overrides
      ...(service.advanced || {}),
      // env and interpreter are always explicit, never from advanced
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
}

// Known PM2 app keys that have dedicated rendering
const KNOWN_PM2_KEYS = new Set(['name', 'script', 'cwd', 'instances', 'autorestart', 'watch', 'interpreter', 'max_memory_restart', 'env']);

export function formatPM2Apps(
  apps: Array<Record<string, unknown>>,
): string {
  const formattedApps = apps.map((app) => {
    const env = (app.env || {}) as Record<string, string>;
    const envEntries = Object.entries(env)
      .map(([key, value]) => `        ${key}: "${value}"`)
      .join(",\n");

    const interpreterLine = app.interpreter ? `      interpreter: "${app.interpreter}",\n` : "";

    // Render any extra fields beyond the known set
    const extraLines = Object.entries(app)
      .filter(([key]) => !KNOWN_PM2_KEYS.has(key))
      .map(([key, value]) => {
        if (typeof value === 'string') {
          return `      ${key}: "${value}",`;
        }
        return `      ${key}: ${value},`;
      })
      .join("\n");
    const extraBlock = extraLines ? `${extraLines}\n` : "";

    return `    {
      name: "${app.name}",
      script: "${app.script}",
      cwd: "${app.cwd}",
      instances: ${app.instances},
      autorestart: ${app.autorestart},
      watch: ${app.watch},
${interpreterLine}${extraBlock}      max_memory_restart: "${app.max_memory_restart}",
      env: {
${envEntries}
      }
    }`;
  });

  return `[\n${formattedApps.join(",\n")}\n  ]`;
}

/**
 * Extract all env vars from PM2 config, grouped by service name
 * Filters out script commands and PORT which are service config, not env vars
 * Returns a map of service name -> env vars array
 */
export function extractEnvVarsFromPM2Config(
  pm2Content: string,
): Map<string, Array<{ name: string; value: string }>> {
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
}

export function maskEnvVarsInPM2Config(pm2Content: string): string {
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
}

export function getPM2AppsContent(
  repoNames: string | string[],
  servicesData: ServiceDataConfig[],
  globalEnvVars?: Array<{ name: string; value: string }>,
): DevContainerFile {
  // Normalize to array for backward compatibility
  const repoNamesArray = Array.isArray(repoNames) ? repoNames : [repoNames];
  const pm2Apps = generatePM2Apps(repoNamesArray, servicesData, globalEnvVars);
  const pm2AppFormatted = formatPM2Apps(pm2Apps);

  return {
    name: "pm2.config.js",
    content: `module.exports = {
  apps: ${pm2AppFormatted},
};
`,
    type: "javascript",
  };
}

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

/**
 * Match a quoted string value for a given key in PM2 config text.
 * Supports both double-quoted and single-quoted values.
 */
function matchQuotedValue(text: string, key: string): string | undefined {
  const match = text.match(new RegExp(`${key}:\\s*"([^"]+)"`, "")) ||
    text.match(new RegExp(`${key}:\\s*'([^']+)'`, ""));
  return match?.[1];
}

/**
 * Extract the cwd subdirectory from an absolute /workspaces/ path.
 * e.g., /workspaces/jarvis-backend -> "jarvis-backend"
 * e.g., /workspaces/jarvis-boltwall/boltwall -> "jarvis-boltwall/boltwall"
 */
function extractCwdSubdir(cwdPath: string): string | undefined {
  const pathParts = cwdPath.split("/").filter((p) => p);
  if (pathParts.length >= 2 && pathParts[0] === "workspaces") {
    return pathParts.slice(1).join("/");
  }
  return undefined;
}

// Known PM2 app keys that map to dedicated ServiceConfig fields
const KNOWN_APP_KEYS = new Set(["name", "script", "cwd", "interpreter", "env"]);

/**
 * Extract advanced PM2 fields (anything not in the known set) from an app block.
 */
function extractAdvancedFields(block: string): Record<string, string | number | boolean> | undefined {
  const advanced: Record<string, string | number | boolean> = {};

  // Strip out the env block to avoid matching keys inside it
  const blockWithoutEnv = block.replace(/env:\s*\{[\s\S]*?\}/, "");

  const fieldRegex = /(\w+):\s*(?:"([^"]+)"|'([^']+)'|(\d+(?:\.\d+)?)|(\btrue\b|\bfalse\b))/g;
  let fieldMatch;
  while ((fieldMatch = fieldRegex.exec(blockWithoutEnv)) !== null) {
    const key = fieldMatch[1];
    if (KNOWN_APP_KEYS.has(key)) continue;

    if (fieldMatch[5] !== undefined) {
      advanced[key] = fieldMatch[5] === "true";
    } else if (fieldMatch[4] !== undefined) {
      advanced[key] = Number(fieldMatch[4]);
    } else {
      advanced[key] = fieldMatch[2] || fieldMatch[3];
    }
  }

  return Object.keys(advanced).length > 0 ? advanced : undefined;
}

/**
 * Parse pm2.config.js text content into ServiceConfig[].
 */
function parsePM2ConfigText(pm2Content: string): ServiceConfig[] {
  const services: ServiceConfig[] = [];

  try {
    const appsMatch = pm2Content.match(/apps:\s*\[([\s\S]*?)\]/);
    if (!appsMatch) return services;

    const serviceBlocks = appsMatch[1].split(/(?=name:)/);

    for (const block of serviceBlocks) {
      if (!block.trim()) continue;

      const name = matchQuotedValue(block, "name");
      const script = matchQuotedValue(block, "script");
      if (!name || !script) continue;

      const cwdValue = matchQuotedValue(block, "cwd");
      const interpreter = matchQuotedValue(block, "interpreter");

      // Extract env variables for port and script commands
      let port = 3000;
      let installCmd: string | undefined;
      let buildCmd: string | undefined;
      let testCmd: string | undefined;
      let preStartCmd: string | undefined;
      let postStartCmd: string | undefined;
      let rebuildCmd: string | undefined;
      let resetCmd: string | undefined;

      const envMatch = block.match(/env:\s*\{([\s\S]*?)\}/);
      if (envMatch) {
        const envContent = envMatch[1];
        const portMatch = envContent.match(/PORT:\s*["'](\d+)["']/);
        if (portMatch) port = parseInt(portMatch[1]);

        installCmd = matchQuotedValue(envContent, "INSTALL_COMMAND");
        buildCmd = matchQuotedValue(envContent, "BUILD_COMMAND");
        testCmd = matchQuotedValue(envContent, "TEST_COMMAND");
        preStartCmd = matchQuotedValue(envContent, "PRE_START_COMMAND");
        postStartCmd = matchQuotedValue(envContent, "POST_START_COMMAND");
        rebuildCmd = matchQuotedValue(envContent, "REBUILD_COMMAND");
        resetCmd = matchQuotedValue(envContent, "RESET_COMMAND");
      }

      const service: ServiceConfig = {
        name,
        port,
        cwd: cwdValue ? extractCwdSubdir(cwdValue) : undefined,
        interpreter,
        scripts: {
          start: script,
          install: installCmd,
          build: buildCmd,
          test: testCmd,
          preStart: preStartCmd,
          postStart: postStartCmd,
          rebuild: rebuildCmd,
          reset: resetCmd,
        },
      };

      const advanced = extractAdvancedFields(block);
      if (advanced) {
        service.advanced = advanced;
      }

      services.push(service);
    }
  } catch (error) {
    console.error("Failed to parse pm2.config.js:", error);
  }

  return services;
}

// Parse pm2.config.js content regardless of encoding (plain text or base64)
export function parsePM2Content(content: string | undefined): ServiceConfig[] {
  if (!content) return [];

  // Try plain text first
  const result = parsePM2ConfigText(content);
  if (result.length > 0) return result;

  // Fall back to base64 decoding
  try {
    const decoded = Buffer.from(content, "base64").toString("utf-8");
    return parsePM2ConfigText(decoded);
  } catch {
    console.error("Failed to parse pm2.config.js");
    return [];
  }
}

export function getDevContainerFilesFromBase64(
  base64Files: Record<string, string>,
): Record<string, DevContainerFile> {
  return Object.entries(base64Files).reduce(
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
}
