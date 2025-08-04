import { FileTabs } from "@/components/stakgraph/forms/EditFilesForm";
import { ServiceDataConfig } from "@/components/stakgraph/types";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useWizardStore } from "@/stores/useWizardStore";
import { EnvironmentVariable } from "@/types/wizard";
import {
  AlertCircle,
  ArrowRight
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

const generatePM2Apps = (
  repoName: string,
  servicesData: ServiceDataConfig[],
) => {
  if (!servicesData || !servicesData || servicesData.length === 0) {
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

  return servicesData.map((service) => ({
    name: service.name,
    script: service.scripts?.start || "",
    cwd: `/workspaces/${repoName}`,
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: "1G",
    env: {
      INSTALL_COMMAND: service.scripts?.install || "",
      TEST_COMMAND: service.scripts?.test || "",
      BUILD_COMMAND: service.scripts?.build || "",
      PORT: service.port?.toString() || "",
    },
  }));
};

// Helper function to format PM2 apps as JavaScript string
const formatPM2Apps = (
  apps: Array<{
    name: string;
    script: string;
    cwd: string;
    instances: number;
    autorestart: boolean;
    watch: boolean;
    max_memory_restart: string;
    env: Record<string, string>;
  }>,
) => {
  const formattedApps = apps.map((app) => {
    const envEntries = Object.entries(app.env)
      .map(([key, value]) => `        ${key}: "${value}"`)
      .join(",\n");

    return `    {
      name: "${app.name}",
      script: "${app.script}",
      cwd: "${app.cwd}",
      instances: ${app.instances},
      autorestart: ${app.autorestart},
      watch: ${app.watch},
      max_memory_restart: "${app.max_memory_restart}",
      env: {
${envEntries}
      }
    }`;
  });

  return `[\n${formattedApps.join(",\n")}\n  ]`;
};

const getFiles = (
  repoName: string,
  projectName: string,
  servicesData: ServiceDataConfig[],
) => {
  const pm2Apps = generatePM2Apps(repoName, servicesData);

  return {
    "devcontainer.json": `{
  "name": "${projectName}",
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
}`,
    "pm2.config.js": `module.exports = {
  apps: ${formatPM2Apps(pm2Apps)},
};
`,
    "docker-compose.yml": `version: '3.8'
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
`,
    Dockerfile: `FROM mcr.microsoft.com/devcontainers/universal

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
`,
  };
};


interface ReviewPoolEnvironmentStepProps {
  repoName: string;
  projectName: string;
  servicesData: ServiceDataConfig[];
  envVars: EnvironmentVariable[];
  onConfirm: () => void;
  onBack: () => void;
  stepStatus?: "PENDING" | "STARTED" | "PROCESSING" | "COMPLETED" | "FAILED";
}

interface ReviewPoolEnvironmentStepProps {
  onNext: () => void;
  onBack: () => void;
}

export const ReviewPoolEnvironmentStep = ({
  onNext,
  onBack,
}: ReviewPoolEnvironmentStepProps) => {
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [originalContents, setOriginalContents] = useState<
    Record<string, string>
  >({});

  const poolName = useWizardStore((s) => s.poolName);
  const repoName = useWizardStore((s) => s.repoName);
  const projectName = useWizardStore((s) => s.projectName);
  const services = useWizardStore((s) => s.services);
  const swarmId = useWizardStore((s) => s.swarmId);
  const workspaceId = useWizardStore((s) => s.workspaceId);


  const files = getFiles(repoName, projectName, services);

  useEffect(() => {

    setOriginalContents(files);
    setFileContents(files);
  }, [services]);

  const handleContentChange = (fileName: string, value: string) => {
    setFileContents((prev) => ({ ...prev, [fileName]: value }));
  };

  const isFileModified = (fileName: string) =>
    fileContents[fileName] !== originalContents[fileName];

  const resetFiles = () => {
    setFileContents(originalContents);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        resetFiles();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [originalContents, resetFiles]);

  const hasModifications = Object.keys(fileContents).some((fileName) =>
    isFileModified(fileName),
  );

  const handleNext = useCallback(async () => {
    if (poolName) {
      onNext();
      return;
    }

    const base64EncodedFiles = Object.entries(fileContents).reduce(
      (acc, [name, content]) => {
        acc[name] = Buffer.from(content).toString("base64");
        return acc;
      },
      {} as Record<string, string>,
    );

    try {
      await fetch("/api/pool-manager/create-pool", {
        method: "POST",
        body: JSON.stringify({
          container_files: base64EncodedFiles,
          swarmId: swarmId,
          workspaceId: workspaceId,
        }),
      });

      onNext();
    } catch (error) {
      console.error(error);
    }
  }, [onNext, fileContents, poolName]);


  return (
    <Card className="max-w-4xl mx-auto">
      <CardHeader className="text-center">
        <div className="flex items-center justify-center mx-auto mb-4">
          <svg
            width="64"
            height="64"
            viewBox="0 0 64 64"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect
              x="12"
              y="12"
              width="40"
              height="40"
              rx="8"
              fill="#F3F4F6"
              stroke="#10B981"
              strokeWidth="2"
            />
            <path
              d="M24 28h16"
              stroke="#10B981"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <path
              d="M24 36h12"
              stroke="#10B981"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <circle cx="32" cy="32" r="3" fill="#10B981" />
          </svg>
        </div>
        <CardTitle className="text-2xl">Review Pool Environment</CardTitle>
        <CardDescription>
          Review and customize the configuration files for your development
          environment.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <FileTabs
          fileContents={fileContents}
          originalContents={originalContents}
          onChange={handleContentChange}
        />

        {hasModifications && (
          <div className="flex items-center gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
            <AlertCircle className="w-4 h-4 text-yellow-600" />
            <span className="text-sm text-yellow-800">
              You have unsaved changes. Press ESC to reset all files.
            </span>
          </div>
        )}

        <div className="flex justify-between pt-6">
          <Button variant="outline" type="button" onClick={onBack}>
            Back
          </Button>
          <Button
            className="px-8 bg-green-600 hover:bg-green-700"
            type="button"
            onClick={handleNext}
          >
            Confirm Setup
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
