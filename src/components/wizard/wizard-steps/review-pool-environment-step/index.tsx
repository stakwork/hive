import React, { useState, useEffect, useCallback } from "react";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "../ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../ui/tabs";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import { Badge } from "../ui/badge";
import {
    FileText,
    Settings,
    Package,
    Container,
    AlertCircle,
    RotateCcw,
    ArrowRight,
} from "lucide-react";
import { EnvironmentVariable } from "@/types/wizard";
import { ServicesData } from "@/components/stakgraph/types";

// Helper function to generate containerEnv from environment variables
const generateContainerEnv = (envVars: EnvironmentVariable[]) => {
    const containerEnv: Record<string, string> = {};

    envVars.forEach((envVar) => {
        if (envVar.key && envVar.value) {
            containerEnv[envVar.key] = envVar.value;
        }
    });

    return containerEnv;
};

// Helper function to format containerEnv object as JSON string with proper indentation
const formatContainerEnv = (containerEnv: Record<string, string>) => {
    if (Object.keys(containerEnv).length === 0) {
        return "{}";
    }

    const entries = Object.entries(containerEnv);
    const formattedEntries = entries.map(
        ([key, value]) => `    "${key}": "${value}"`
    );
    return `{\n${formattedEntries.join(",\n")}\n  }`;
};

// Helper function to generate PM2 apps from services data
const generatePM2Apps = (repoName: string, servicesData: ServicesData) => {
    if (
        !servicesData ||
        !servicesData.services ||
        servicesData.services.length === 0
    ) {
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

    return servicesData.services.map((service) => ({
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
    }>
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
    servicesData: ServicesData,
    envVars: EnvironmentVariable[]
) => {
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
            type: "json",
        },
        {
            name: "pm2.config.js",
            content: `module.exports = {
  apps: ${formatPM2Apps(pm2Apps)},
};
`,
            type: "javascript",
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
            type: "yaml",
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
            type: "dockerfile",
        },
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
    const lines = content.split("\n").length;
    const chars = content.length;
    const bytes = new Blob([content]).size;
    return { lines, chars, bytes };
};

const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
};

interface ReviewPoolEnvironmentStepProps {
    repoName: string;
    projectName: string;
    servicesData: ServicesData;
    envVars: EnvironmentVariable[];
    onConfirm: () => void;
    onBack: () => void;
    stepStatus?: "PENDING" | "STARTED" | "PROCESSING" | "COMPLETED" | "FAILED";
}

export default function ReviewPoolEnvironmentStep({
    repoName,
    projectName,
    servicesData,
    envVars,
    onConfirm,
    onBack,
}: ReviewPoolEnvironmentStepProps) {
    const FILES = getFiles(repoName, projectName, servicesData, envVars);

    const [activeFile, setActiveFile] = useState(FILES[0].name);
    const [fileContents, setFileContents] = useState(
        Object.fromEntries(FILES.map((f) => [f.name, f.content]))
    );
    const [originalContents] = useState(
        Object.fromEntries(FILES.map((f) => [f.name, f.content]))
    );
    const [errors, setErrors] = useState<Record<string, string>>({});

    // Update file contents when envVars change
    useEffect(() => {
        const newFiles = getFiles(repoName, projectName, servicesData, envVars);
        const newContents = Object.fromEntries(
            newFiles.map((f) => [f.name, f.content])
        );
        setFileContents(newContents);
    }, [repoName, projectName, servicesData, envVars]);

    const validateFile = useCallback(
        (fileName: string, content: string) => {
            const file = FILES.find((f) => f.name === fileName);
            if (!file) return;
            try {
                if (file.type === "json") {
                    JSON.parse(content);
                }
                setErrors((prev) => ({ ...prev, [fileName]: "" }));
            } catch {
                setErrors((prev) => ({
                    ...prev,
                    [fileName]:
                        file.type === "json"
                            ? "Invalid JSON format"
                            : "Invalid file format",
                }));
            }
        },
        [FILES]
    );

    const handleContentChange = (fileName: string, value: string) => {
        setFileContents((prev) => ({ ...prev, [fileName]: value }));
        validateFile(fileName, value);
    };

    const isFileModified = (fileName: string) =>
        fileContents[fileName] !== originalContents[fileName];
    const hasErrors = Object.values(errors).some((error) => error !== "");
    const resetFiles = () => {
        setFileContents(originalContents);
        setErrors({});
    };

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.key === "Tab") {
                e.preventDefault();
                const currentIndex = FILES.findIndex(
                    (f) => f.name === activeFile
                );
                const nextIndex = (currentIndex + 1) % FILES.length;
                setActiveFile(FILES[nextIndex].name);
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [activeFile, FILES]);

    useEffect(() => {
        FILES.forEach((file) =>
            validateFile(file.name, fileContents[file.name])
        );
    }, [validateFile, fileContents, FILES]);

    const currentFileStats = getFileStats(fileContents[activeFile]);

    return (
        <Card className="max-w-4xl mx-auto bg-card text-card-foreground">
            <CardHeader className="text-center">
                <div className="flex items-center justify-center mx-auto mb-4">
                    {/* Animated SVG omitted for brevity */}
                </div>
                <CardTitle className="text-2xl">
                    Review Pool Environment
                </CardTitle>
                <CardDescription>
                    Review and edit your environment files. Your services and
                    environment variables have been automatically populated.
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
                <Tabs
                    value={activeFile}
                    onValueChange={setActiveFile}
                    className="w-full"
                >
                    <div className="mb-4 overflow-x-auto">
                        <TabsList className="inline-flex w-auto min-w-full sm:min-w-0">
                            {FILES.map((file) => (
                                <TabsTrigger
                                    key={file.name}
                                    value={file.name}
                                    className={`font-mono text-xs flex items-center gap-2 relative ${
                                        isFileModified(file.name)
                                            ? "text-orange-600"
                                            : ""
                                    }`}
                                >
                                    {getFileIcon(file.type)}
                                    <span className="hidden sm:inline">
                                        {file.name}
                                    </span>
                                    <span className="sm:hidden">
                                        {file.name.split(".")[0]}
                                    </span>
                                    {isFileModified(file.name) && (
                                        <span className="w-2 h-2 bg-orange-500 rounded-full" />
                                    )}
                                    {errors[file.name] && (
                                        <AlertCircle className="w-3 h-3 text-red-500" />
                                    )}
                                </TabsTrigger>
                            ))}
                        </TabsList>
                    </div>

                    {FILES.map((file) => (
                        <TabsContent
                            key={file.name}
                            value={file.name}
                            className="w-full space-y-4"
                        >
                            {/* File Stats */}
                            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                                <Badge variant="outline" className="text-xs">
                                    {currentFileStats.lines} lines
                                </Badge>
                                <Badge variant="outline" className="text-xs">
                                    {currentFileStats.chars} chars
                                </Badge>
                                <Badge variant="outline" className="text-xs">
                                    {formatBytes(currentFileStats.bytes)}
                                </Badge>
                                {isFileModified(file.name) && (
                                    <Badge
                                        variant="outline"
                                        className="text-xs text-orange-600"
                                    >
                                        Modified
                                    </Badge>
                                )}
                            </div>

                            {/* Show error message if any */}
                            {errors[file.name] && (
                                <div className="flex items-center gap-2 p-2 bg-red-50 border border-red-200 rounded text-red-700 text-sm">
                                    <AlertCircle className="w-4 h-4" />
                                    {errors[file.name]}
                                </div>
                            )}

                            {/* Code Editor */}
                            <div className="relative">
                                <Textarea
                                    className={`font-mono text-xs min-h-[300px] sm:min-h-[400px] resize-vertical ${
                                        errors[file.name]
                                            ? "border-red-500"
                                            : ""
                                    }`}
                                    value={fileContents[file.name]}
                                    onChange={(e) =>
                                        handleContentChange(
                                            file.name,
                                            e.target.value
                                        )
                                    }
                                    spellCheck={false}
                                    placeholder="Enter your code here..."
                                    style={{
                                        tabSize: 2,
                                        fontFamily:
                                            'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                                    }}
                                />
                            </div>
                        </TabsContent>
                    ))}
                </Tabs>

                {/* Action Buttons */}
                <div className="flex justify-between pt-4">
                    <Button variant="outline" onClick={onBack}>
                        Back
                    </Button>
                    <div className="flex gap-2">
                        <Button
                            variant="outline"
                            onClick={resetFiles}
                            disabled={
                                !FILES.some((f) => isFileModified(f.name))
                            }
                            className="flex items-center gap-2"
                        >
                            <RotateCcw className="w-4 h-4" />
                            Reset All
                        </Button>
                        <Button
                            className="px-8 bg-primary text-primary-foreground hover:bg-primary/90"
                            onClick={onConfirm}
                            disabled={hasErrors}
                        >
                            Confirm & Continue
                            <ArrowRight className="w-4 h-4 ml-2" />
                        </Button>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
}
