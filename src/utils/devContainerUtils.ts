import { ServiceDataConfig } from "@/components/stakgraph/types";
import { ServiceConfig } from "@/services/swarm/db";

export interface DevContainerFile {
  name: string;
  content: string;
  type: string;
}

// Helper function to generate PM2 apps from services data
export const generatePM2Apps = (
  repoName: string,
  servicesData: ServiceDataConfig[],
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
    const cwd = service.cwd
      ? `/workspaces/${repoName}/${service.cwd.replace(/^\/+/, '')}`
      : `/workspaces/${repoName}`;

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

    const interpreterLine = app.interpreter
      ? `      interpreter: "${app.interpreter}",\n`
      : "";

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

export interface GetFilesParams {
  repoName: string;
  servicesData: ServiceDataConfig[];
}

export const getPM2AppsContent = (
  repoName: string,
  servicesData: ServiceDataConfig[],
) => {
  const pm2Apps = generatePM2Apps(repoName, servicesData);
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

export const getDevContainerFiles = (
  params: GetFilesParams,
): Record<string, DevContainerFile> => {
  const { repoName, servicesData } = params;

  return {
    devcontainer_json: {
      name: "devcontainer.json",
      content: devcontainerJsonContent(repoName),
      type: "json",
    },
    pm2_config_js: getPM2AppsContent(repoName, servicesData),
    docker_compose_yml: {
      name: "docker-compose.yml",
      content: dockerComposeContent(),
      type: "yaml",
    },
    dockerfile: {
      name: "Dockerfile",
      content: dockerfileContent(),
      type: "dockerfile",
    },
  };
};

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

  let contentToParse = content;

  // First check if it's base64 by trying to decode it
  // A typical base64 string will be longer and contain only valid base64 chars
  const isBase64Pattern = /^[A-Za-z0-9+/]*={0,2}$/;
  
  if (isBase64Pattern.test(content) && content.length > 100) {
    try {
      const decoded = Buffer.from(content, 'base64').toString('utf-8');
      // If decoded content looks like a valid PM2 config, use it
      if (decoded.includes('module.exports') && decoded.includes('apps')) {
        contentToParse = decoded;
      }
    } catch {
      // If base64 decoding fails, use original content
    }
  }

  return parsePM2ConfigToServices(contentToParse);
}

// Parse pm2.config.js content to extract ServiceConfig[]
export function parsePM2ConfigToServices(pm2Content: string): ServiceConfig[] {
  const services: ServiceConfig[] = [];

  try {
    // Match the apps array in the module.exports
    const appsMatch = pm2Content.match(/apps:\s*\[([\s\S]*?)\]/);
    if (!appsMatch) return services;

    const appsContent = appsMatch[1];

    // Check for syntax errors in the content - missing commas after property names
    if (/name:\s*["'][^"']*["']\s*script:/.test(appsContent)) {
      // This indicates malformed JSON (missing comma between name and script)
      return [];
    }

    // Use a more robust approach to split service objects
    // Look for complete service objects by matching balanced braces
    const parsedServices: ServiceConfig[] = [];
    let braceCount = 0;
    let currentService = '';
    let inService = false;
    
    for (let i = 0; i < appsContent.length; i++) {
      const char = appsContent[i];
      
      if (char === '{') {
        if (!inService) {
          inService = true;
          currentService = char;
        } else {
          currentService += char;
        }
        braceCount++;
      } else if (char === '}') {
        currentService += char;
        braceCount--;
        
        if (braceCount === 0 && inService) {
          // Complete service object found
          const nameMatch = currentService.match(/name:\s*["']([^"']+)["']/);
          if (nameMatch) {
            // Process this service object
            const serviceName = nameMatch[1];
            const serviceContent = currentService;
            
            // Extract fields using regex
            const scriptMatch = serviceContent.match(/script:\s*["']([^"']+)["']/);
            const cwdMatch = serviceContent.match(/cwd:\s*["']([^"']+)["']/);
            const interpreterMatch = serviceContent.match(/interpreter:\s*["']([^"']+)["']/);

            // Extract env variables
            const envMatch = serviceContent.match(/env:\s*\{([\s\S]*?)\}/);
            let port = 3000;
            let installCmd: string | undefined;
            let buildCmd: string | undefined;
            let testCmd: string | undefined;
            let preStartCmd: string | undefined;
            let postStartCmd: string | undefined;
            let rebuildCmd: string | undefined;

            if (envMatch) {
              const envContent = envMatch[1];
              const portMatch = envContent.match(/PORT:\s*["'](\d+)["']/);
              const installMatch = envContent.match(/INSTALL_COMMAND:\s*["']([^"']+)["']/);
              const buildMatch = envContent.match(/BUILD_COMMAND:\s*["']([^"']+)["']/);
              const testMatch = envContent.match(/TEST_COMMAND:\s*["']([^"']+)["']/);
              const preStartMatch = envContent.match(/PRE_START_COMMAND:\s*["']([^"']+)["']/);
              const postStartMatch = envContent.match(/POST_START_COMMAND:\s*["']([^"']+)["']/);
              const rebuildMatch = envContent.match(/REBUILD_COMMAND:\s*["']([^"']+)["']/);

              if (portMatch) port = parseInt(portMatch[1]);
              if (installMatch) installCmd = installMatch[1];
              if (buildMatch) buildCmd = buildMatch[1];
              if (testMatch) testCmd = testMatch[1];
              if (preStartMatch) preStartCmd = preStartMatch[1];
              if (postStartMatch) postStartCmd = postStartMatch[1];
              if (rebuildMatch) rebuildCmd = rebuildMatch[1];
            }

            if (serviceName && scriptMatch) {
              // Extract cwd to determine if it's a subdirectory
              let serviceDir: string | undefined;
              if (cwdMatch) {
                const cwdPath = cwdMatch[1];
                // Extract subdirectory from path like /workspaces/reponame/subdirectory
                const pathParts = cwdPath.split('/').filter(p => p);
                if (pathParts.length > 2) {
                  // Has subdirectory beyond /workspaces/reponame
                  serviceDir = pathParts.slice(2).join('/');
                }
              }

              const service: ServiceConfig = {
                name: serviceName,
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
                }
              };

              parsedServices.push(service);
            }
          }
          currentService = '';
          inService = false;
        }
      } else if (inService) {
        currentService += char;
      }
    }

    return parsedServices;
  } catch (error) {
    console.error("Failed to parse pm2.config.js:", error);
    return [];
  }
}

export const getDevContainerFilesFromBase64 = (
  base64Files: Record<string, string>,
) => {
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
