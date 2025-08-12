import { ServiceDataConfig } from "@/components/stakgraph/types";

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
          PORT: "3000",
        },
      },
    ];
  }

  return servicesData.map((service) => {
    const appConfig = {
      name: service.name,
      script: service.scripts?.start || "",
      cwd: `/workspaces/${repoName}`,
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
volumes:
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
  return `FROM mcr.microsoft.com/devcontainers/universal

# [Optional] Uncomment this section to install additional OS packages.
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \\
    && apt-get -y install --no-install-recommends wget sed

RUN sudo mkdir -p -m 755 /etc/apt/keyrings \\
    && out=$(mktemp) && wget -nv -O$out https://cli.github.com/packages/githubcli-archive-keyring.gpg \\
    && cat $out | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \\
    && sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \\
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null \\
    && sudo apt update -y \\
    && sudo apt install gh -y

# Install PM2 globally and ensure it's accessible
RUN npm install -g pm2 && \\
    ln -sf /usr/local/node/bin/pm2 /usr/local/bin/pm2 && \\
    pm2 --version
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
