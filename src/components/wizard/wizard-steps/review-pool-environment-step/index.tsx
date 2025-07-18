import React, { useState, useEffect, useCallback } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { 
  FileText, 
  Settings, 
  Package, 
  Container,
  AlertCircle,
  RotateCcw,
  ArrowRight
} from "lucide-react";
import { EnvironmentVariable } from "@/types/wizard";
import { ServicesData } from "@/components/stakgraph/types";

// Helper function to generate containerEnv from environment variables
const generateContainerEnv = (envVars: EnvironmentVariable[]) => {
  const containerEnv: Record<string, string> = {};
  
  envVars.forEach(envVar => {
    if (envVar.key && envVar.value) {
      containerEnv[envVar.key] = envVar.value;
    }
  });
  
  return containerEnv;
};

// Helper function to format containerEnv object as JSON string with proper indentation
const formatContainerEnv = (containerEnv: Record<string, string>) => {
  if (Object.keys(containerEnv).length === 0) {
    return '{}';
  }
  
  const entries = Object.entries(containerEnv);
  const formattedEntries = entries.map(([key, value]) => `    "${key}": "${value}"`);
  return `{\n${formattedEntries.join(',\n')}\n  }`;
};

// Helper function to generate PM2 apps from services data
const generatePM2Apps = (repoName: string, servicesData: ServicesData) => {
  if (!servicesData || !servicesData.services || servicesData.services.length === 0) {
    // Return default configuration if no services
    return [{
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
        PORT: "3000"
      }
    }];
  }

  return servicesData.services.map(service => ({
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
      PORT: service.port?.toString() || ""
    }
  }));
};

// Helper function to format PM2 apps as JavaScript string
const formatPM2Apps = (apps: Array<{
  name: string;
  script: string;
  cwd: string;
  instances: number;
  autorestart: boolean;
  watch: boolean;
  max_memory_restart: string;
  env: Record<string, string>;
}>) => {
  const formattedApps = apps.map(app => {
    const envEntries = Object.entries(app.env)
      .map(([key, value]) => `        ${key}: "${value}"`)
      .join(',\n');
    
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

  return `[\n${formattedApps.join(',\n')}\n  ]`;
};

const getFiles = (repoName: string, projectName: string, servicesData: ServicesData, envVars: EnvironmentVariable[]) => {
  const containerEnv = generateContainerEnv(envVars);
  const pm2Apps = generatePM2Apps(repoName, servicesData);
  
  return [
    {
      name: "devcontainer.json",
      content: `{
  "name": "${projectName}",
  "dockerComposeFile": "./docker-compose.yml",
  "workspaceFolder": "/workspaces",
  "features": {
    "ghcr.io/devcontainers/features/docker-outside-of-docker": {}
  },
  "containerEnv": ${formatContainerEnv(containerEnv)},
  "customizations": {
    "vscode": {
        "settings": {
          "git.autofetch": true,
          "editor.formatOnSave": true
        },
        "extensions": [
            "stakwork.staklink"
        ]
    }
  }
}`,
      type: "json"
    },
    {
      name: "pm2.config.js",
      content: `module.exports = {
  apps: ${formatPM2Apps(pm2Apps)},
};
`,
      type: "javascript"
    },
    {
      name: "docker-compose.yml",
      content: `version: '3.8'
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
      type: "yaml"
    },
    {
      name: "Dockerfile",
      content: `FROM mcr.microsoft.com/devcontainers/universal

# [Optional] Uncomment this section to install additional OS packages.
RUN apt-get update && export DEBIAN_FRONTEND=noninteractive \
    && apt-get -y install --no-install-recommends wget sed

RUN sudo mkdir -p -m 755 /etc/apt/keyrings \
        && out=$(mktemp) && wget -nv -O$out https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        && cat $out | sudo tee /etc/apt/keyrings/githubcli-archive-keyring.gpg > /dev/null \
    && sudo chmod go+r /etc/apt/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" | sudo tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && sudo apt update -y \
    && sudo apt install gh -y

# Install PM2 globally and ensure it's accessible
RUN npm install -g pm2 && \
    # Create symlink in /usr/local/bin to ensure it's always in PATH
    ln -sf /usr/local/node/bin/pm2 /usr/local/bin/pm2 && \
    # Verify installation
    pm2 --version
`,
      type: "dockerfile"
    }
  ];
};

const getFileIcon = (type: string) => {
  switch (type) {
    case "json":
      return <Settings className="w-3 h-3" />;
    case "javascript":
      return <FileText className="w-3 h-3" />;
    case "yaml":
      return <Package className="w-3 h-3" />;
    case "dockerfile":
      return <Container className="w-3 h-3" />;
    default:
      return <FileText className="w-3 h-3" />;
  }
};

const getFileStats = (content: string) => {
  const lines = content.split('\n').length;
  const chars = content.length;
  const bytes = new Blob([content]).size;
  return { lines, chars, bytes };
};

const formatBytes = (bytes: number) => {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
};

interface ReviewPoolEnvironmentStepProps {
  repoName: string;
  projectName: string;
  servicesData: ServicesData;
  envVars: EnvironmentVariable[];
  onConfirm: () => void;
  onBack: () => void;
  stepStatus?: 'PENDING' | 'STARTED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
}

const ReviewPoolEnvironmentStep = ({ 
  repoName,
  projectName,
  servicesData,
  envVars,
  onConfirm, 
  onBack,
  stepStatus: _stepStatus
}: ReviewPoolEnvironmentStepProps) => {
  const [activeTab, setActiveTab] = useState("devcontainer");
  const [fileContents, setFileContents] = useState<Record<string, string>>({});
  const [originalContents, setOriginalContents] = useState<Record<string, string>>({});

  const files = getFiles(repoName, projectName, servicesData, envVars);

  useEffect(() => {
    const initialContents: Record<string, string> = {};
    files.forEach(file => {
      initialContents[file.name] = file.content;
    });
    setOriginalContents(initialContents);
    setFileContents(initialContents);
  }, [repoName, projectName, servicesData, envVars]);

  const handleContentChange = (fileName: string, value: string) => {
    setFileContents(prev => ({ ...prev, [fileName]: value }));
  };

  const isFileModified = (fileName: string) => fileContents[fileName] !== originalContents[fileName];

  const resetFiles = () => {
    setFileContents(originalContents);
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        resetFiles();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [originalContents]);

  const hasModifications = Object.keys(fileContents).some(fileName => isFileModified(fileName));

  return (
    <Card className="max-w-4xl mx-auto">
      <CardHeader className="text-center">
        <div className="flex items-center justify-center mx-auto mb-4">
          <svg width="64" height="64" viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg">
            <rect x="12" y="12" width="40" height="40" rx="8" fill="#F3F4F6" stroke="#10B981" strokeWidth="2" />
            <path d="M24 28h16" stroke="#10B981" strokeWidth="2" strokeLinecap="round" />
            <path d="M24 36h12" stroke="#10B981" strokeWidth="2" strokeLinecap="round" />
            <circle cx="32" cy="32" r="3" fill="#10B981" />
          </svg>
        </div>
        <CardTitle className="text-2xl">Review Pool Environment</CardTitle>
        <CardDescription>
          Review and customize the configuration files for your development environment.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="devcontainer" className="flex items-center gap-2">
              {getFileIcon("json")}
              DevContainer
            </TabsTrigger>
            <TabsTrigger value="pm2" className="flex items-center gap-2">
              {getFileIcon("javascript")}
              PM2 Config
            </TabsTrigger>
            <TabsTrigger value="docker-compose" className="flex items-center gap-2">
              {getFileIcon("yaml")}
              Docker Compose
            </TabsTrigger>
            <TabsTrigger value="dockerfile" className="flex items-center gap-2">
              {getFileIcon("dockerfile")}
              Dockerfile
            </TabsTrigger>
          </TabsList>

          {files.map(file => (
            <TabsContent key={file.name} value={file.name.toLowerCase().replace('.', '-')} className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {getFileIcon(file.type)}
                  <span className="font-medium">{file.name}</span>
                  {isFileModified(file.name) && (
                    <Badge variant="secondary" className="text-xs">
                      Modified
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span>{getFileStats(fileContents[file.name] || file.content).lines} lines</span>
                  <span>•</span>
                  <span>{formatBytes(getFileStats(fileContents[file.name] || file.content).bytes)}</span>
                </div>
              </div>
              
              <div className="relative">
                <Textarea
                  value={fileContents[file.name] || file.content}
                  onChange={(e) => handleContentChange(file.name, e.target.value)}
                  className="font-mono text-sm min-h-[300px] resize-none"
                  placeholder={`Enter ${file.name} content...`}
                />
                {isFileModified(file.name) && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleContentChange(file.name, originalContents[file.name])}
                    className="absolute top-2 right-2"
                  >
                    <RotateCcw className="w-3 h-3 mr-1" />
                    Reset
                  </Button>
                )}
              </div>
            </TabsContent>
          ))}
        </Tabs>

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
            onClick={onConfirm}
          >
            Confirm Setup
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default ReviewPoolEnvironmentStep;
