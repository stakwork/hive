import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Play,
  Download,
  Hammer,
  TestTube,
  PlusCircle,
  XCircle,
  FastForward,
  Rewind,
  RefreshCw,
  Zap,
  RotateCcw,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FormSectionProps, ServiceDataConfig } from "../types";
import { useState } from "react";

type ScriptConfig = {
  key: keyof ServiceDataConfig["scripts"];
  label: string;
  icon: React.ReactNode;
  placeholder: string;
  description: string;
  required?: boolean;
};

export default function ServicesForm({
  data,
  loading,
  onChange,
}: Omit<FormSectionProps<ServiceDataConfig[]>, "errors">) {
  // Track which service env sections are expanded
  const [expandedEnvSections, setExpandedEnvSections] = useState<Record<number, boolean>>({});
  // Track which advanced PM2 config sections are expanded
  const [expandedAdvancedSections, setExpandedAdvancedSections] = useState<Record<number, boolean>>({});
  // Track which env var values are shown (not hidden)
  const [visibleEnvVars, setVisibleEnvVars] = useState<Record<string, boolean>>({});

  const scriptConfigs: Record<string, ScriptConfig> = {
    start: {
      key: "start",
      label: "Start",
      icon: <Play className="w-4 h-4 text-muted-foreground" />,
      placeholder: "npm start",
      description: "start your dev server",
      required: true,
    },
    install: {
      key: "install",
      label: "Install",
      icon: <Download className="w-4 h-4 text-muted-foreground" />,
      placeholder: "npm install",
      description: "install dependencies",
    },
    test: {
      key: "test",
      label: "Test",
      icon: <TestTube className="w-4 h-4 text-muted-foreground" />,
      placeholder: "npm test",
      description: "test command",
    },
    e2eTest: {
      key: "e2eTest",
      label: "E2E Test Command",
      icon: <Zap className="w-4 h-4 text-muted-foreground" />,
      placeholder: "npx playwright test",
      description: "end-to-end test command",
    },
    preStart: {
      key: "preStart",
      label: "Pre-Start",
      icon: <Rewind className="w-4 h-4 text-muted-foreground" />,
      placeholder: "npx prisma migrate dev",
      description: "run before the start command",
    },
    postStart: {
      key: "postStart",
      label: "Post-Start",
      icon: <FastForward className="w-4 h-4 text-muted-foreground" />,
      placeholder: "echo 'Service started'",
      description: "run after the start command",
    },
    rebuild: {
      key: "rebuild",
      label: "Rebuild",
      icon: <RefreshCw className="w-4 h-4 text-muted-foreground" />,
      placeholder: "npm run build",
      description: "rebuild on code change",
    },
    build: {
      key: "build",
      label: "Build",
      icon: <Hammer className="w-4 h-4 text-muted-foreground" />,
      placeholder: "npm run build",
      description: "build for production",
    },
    reset: {
      key: "reset",
      label: "Reset",
      icon: <RotateCcw className="w-4 h-4 text-muted-foreground" />,
      placeholder: "npm run db:reset",
      description: "reset database or state",
    },
  };

  const handleAddService = () => {
    const newServices = [
      ...data,
      {
        name: "",
        port: 0,
        cwd: "",
        scripts: { start: "", install: "" },
        env: {},
      },
    ];

    onChange(newServices);
  };

  const handleRemoveService = (idx: number) => {
    const newServices = data.filter((_, i) => i !== idx);
    onChange(newServices);
  };

  const handleServiceChange = (
    idx: number,
    field: keyof ServiceDataConfig,
    value: string | number,
  ) => {
    const updatedServices = [...data];
    if (field === "port") {
      updatedServices[idx].port =
        typeof value === "number" ? value : Number(value);
    } else if (field === "name") {
      updatedServices[idx].name = value as string;
    } else if (field === "interpreter") {
      updatedServices[idx].interpreter = value as string;
    } else if (field === "cwd") {
      updatedServices[idx].cwd = value as string;
    }
    onChange(updatedServices);
  };

  const handleServiceScriptChange = (
    idx: number,
    scriptKey: keyof ServiceDataConfig["scripts"],
    value: string,
  ) => {
    const updatedServices = data.map((svc, i) =>
      i === idx
        ? {
            ...svc,
            scripts: {
              ...(svc.scripts || {}),
              [scriptKey]: value,
            } as ServiceDataConfig["scripts"],
          }
        : svc,
    );
    onChange(updatedServices);
  };

  const handleAddScript = (
    idx: number,
    scriptKey: keyof ServiceDataConfig["scripts"],
  ) => {
    const updatedServices = data.map((svc, i) => {
      if (i === idx) {
        return {
          ...svc,
          scripts: {
            ...(svc.scripts || {}),
            [scriptKey]: "",
          } as ServiceDataConfig["scripts"],
        };
      }
      return svc;
    });
    onChange(updatedServices);
  };

  const handleRemoveScript = (
    idx: number,
    scriptKey: keyof ServiceDataConfig["scripts"],
  ) => {
    const updatedServices = data.map((svc, i) => {
      if (i === idx) {
        const updatedScripts = { ...(svc.scripts || {}) } as Record<
          string,
          string
        >;
        delete updatedScripts[scriptKey as string];
        return {
          ...svc,
          scripts: updatedScripts as unknown as ServiceDataConfig["scripts"],
        };
      }
      return svc;
    });
    onChange(updatedServices);
  };

  // Service environment variable handlers
  const toggleEnvSection = (idx: number) => {
    setExpandedEnvSections(prev => ({
      ...prev,
      [idx]: !prev[idx]
    }));
  };

  const handleServiceEnvChange = (
    serviceIdx: number,
    envKey: string,
    field: 'key' | 'value',
    value: string,
    oldKey?: string
  ) => {
    const updatedServices = [...data];
    const service = updatedServices[serviceIdx];
    const env = { ...(service.env || {}) };

    if (field === 'key') {
      // Rename key
      if (oldKey && oldKey !== value) {
        const oldValue = env[oldKey];
        delete env[oldKey];
        if (value.trim()) {
          env[value] = oldValue || '';
        }
      } else if (!oldKey && value.trim()) {
        env[value] = '';
      }
    } else {
      // Update value
      if (envKey) {
        env[envKey] = value;
      }
    }

    updatedServices[serviceIdx] = {
      ...service,
      env
    };
    onChange(updatedServices);
  };

  const handleAddServiceEnv = (serviceIdx: number) => {
    const updatedServices = [...data];
    const service = updatedServices[serviceIdx];
    
    // Find a unique temp key
    let counter = 1;
    while (`NEW_VAR_${counter}` in (service.env || {})) {
      counter++;
    }
    
    updatedServices[serviceIdx] = {
      ...service,
      env: {
        ...(service.env || {}),
        [`NEW_VAR_${counter}`]: ''
      }
    };
    onChange(updatedServices);
  };

  const handleRemoveServiceEnv = (serviceIdx: number, envKey: string) => {
    const updatedServices = [...data];
    const service = updatedServices[serviceIdx];
    const env = { ...(service.env || {}) };
    delete env[envKey];
    
    updatedServices[serviceIdx] = {
      ...service,
      env
    };
    onChange(updatedServices);
  };

  const toggleEnvVisibility = (serviceIdx: number, envKey: string) => {
    const visKey = `${serviceIdx}-${envKey}`;
    setVisibleEnvVars(prev => ({
      ...prev,
      [visKey]: !prev[visKey]
    }));
  };

  // Advanced PM2 config handlers
  const toggleAdvancedSection = (idx: number) => {
    setExpandedAdvancedSections(prev => ({
      ...prev,
      [idx]: !prev[idx]
    }));
  };

  const parseAdvancedValue = (raw: string): string | number | boolean => {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    const num = Number(raw);
    if (!isNaN(num) && raw.trim() !== '') return num;
    return raw;
  };

  const handleAdvancedChange = (
    serviceIdx: number,
    oldKey: string,
    field: 'key' | 'value',
    value: string,
  ) => {
    const updatedServices = [...data];
    const service = updatedServices[serviceIdx];
    const advanced = { ...(service.advanced || {}) };

    if (field === 'key') {
      if (oldKey !== value) {
        const oldValue = advanced[oldKey];
        delete advanced[oldKey];
        if (value.trim()) {
          advanced[value] = oldValue ?? '';
        }
      }
    } else {
      advanced[oldKey] = parseAdvancedValue(value);
    }

    updatedServices[serviceIdx] = { ...service, advanced };
    onChange(updatedServices);
  };

  const handleAddAdvanced = (serviceIdx: number) => {
    const updatedServices = [...data];
    const service = updatedServices[serviceIdx];
    let counter = 1;
    while (`new_field_${counter}` in (service.advanced || {})) {
      counter++;
    }
    updatedServices[serviceIdx] = {
      ...service,
      advanced: {
        ...(service.advanced || {}),
        [`new_field_${counter}`]: ''
      }
    };
    onChange(updatedServices);
  };

  const handleRemoveAdvanced = (serviceIdx: number, key: string) => {
    const updatedServices = [...data];
    const service = updatedServices[serviceIdx];
    const advanced = { ...(service.advanced || {}) };
    delete advanced[key];
    updatedServices[serviceIdx] = { ...service, advanced };
    onChange(updatedServices);
  };

  return (
    <div className="space-y-4">
      <h3 className="text-lg font-semibold mb-2">Services</h3>
      <p className="text-xs text-muted-foreground mb-2">
        Define your services, their ports, and scripts. The <b>start</b> script
        is required.
      </p>

      {data.length === 0 ? (
        <Button
          type="button"
          variant="secondary"
          onClick={handleAddService}
          disabled={loading}
        >
          Add Service
        </Button>
      ) : (
        <>
          {data.map((svc, idx) => (
            <Card key={idx} className="mb-2">
              <CardContent className="space-y-3 py-2">
                <div className="mb-2 flex justify-between items-center">
                  <span className="text-md font-bold">Service</span>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleRemoveService(idx)}
                    className="px-2"
                    disabled={loading}
                  >
                    Remove
                  </Button>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-2">
                  <div>
                    <Label htmlFor={`service-name-${idx}`} className="mb-1">
                      Name
                    </Label>
                    <Input
                      id={`service-name-${idx}`}
                      placeholder="e.g. api-server"
                      value={svc.name}
                      onChange={(e) =>
                        handleServiceChange(idx, "name", e.target.value)
                      }
                      disabled={loading}
                    />
                  </div>

                  <div>
                    <Label htmlFor={`service-port-${idx}`} className="mb-1">
                      Port
                    </Label>
                    <Input
                      id={`service-port-${idx}`}
                      placeholder="e.g. 3000"
                      type="text"
                      value={svc.port === 0 ? "" : svc.port}
                      onChange={(e) => {
                        const val = e.target.value;
                        if (val === "") {
                          handleServiceChange(idx, "port", 0);
                          return;
                        }
                        if (/^(0|[1-9][0-9]*)$/.test(val)) {
                          handleServiceChange(idx, "port", Number(val));
                        }
                      }}
                      disabled={loading}
                      required
                    />
                  </div>

                  <div>
                    <Label
                      htmlFor={`service-interpreter-${idx}`}
                      className="mb-1"
                    >
                      Interpreter
                    </Label>
                    <Input
                      id={`service-interpreter-${idx}`}
                      placeholder="e.g. node"
                      type="text"
                      value={svc.interpreter}
                      onChange={(e) => {
                        handleServiceChange(idx, "interpreter", e.target.value);
                      }}
                      disabled={loading}
                    />
                  </div>

                  <div>
                    <Label
                      htmlFor={`service-cwd-${idx}`}
                      className="mb-1"
                    >
                      CWD
                    </Label>
                    <Input
                      id={`service-cwd-${idx}`}
                      placeholder="e.g. my-repo, my-repo/backend"
                      type="text"
                      value={svc.cwd || ""}
                      onChange={(e) => {
                        handleServiceChange(idx, "cwd", e.target.value);
                      }}
                      disabled={loading}
                    />
                  </div>
                </div>

                <div className="mb-2 mt-2">
                  <span className="text-md font-bold">
                    Scripts Configuration
                  </span>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center gap-2">
                    {scriptConfigs.start.icon}
                    <Label
                      htmlFor={`service-${scriptConfigs.start.key}-${idx}`}
                    >
                      {scriptConfigs.start.label}
                    </Label>
                  </div>
                  <Input
                    id={`service-${scriptConfigs.start.key}-${idx}`}
                    placeholder={scriptConfigs.start.placeholder}
                    value={svc.scripts?.start ?? ""}
                    onChange={(e) =>
                      handleServiceScriptChange(idx, "start", e.target.value)
                    }
                    className="font-mono"
                    disabled={loading}
                    required
                  />

                  {svc.scripts?.install !== undefined && (
                    <>
                      <div className="flex items-center gap-2 mt-3 justify-between">
                        <div className="flex items-center gap-2">
                          {scriptConfigs.install.icon}
                          <Label
                            htmlFor={`service-${scriptConfigs.install.key}-${idx}`}
                          >
                            {scriptConfigs.install.label}
                          </Label>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveScript(idx, "install")}
                          disabled={loading}
                          className="h-6 w-6"
                        >
                          <XCircle className="h-4 w-4" />
                        </Button>
                      </div>
                      <Input
                        id={`service-${scriptConfigs.install.key}-${idx}`}
                        placeholder={scriptConfigs.install.placeholder}
                        value={svc.scripts?.install || ""}
                        onChange={(e) =>
                          handleServiceScriptChange(
                            idx,
                            "install",
                            e.target.value,
                          )
                        }
                        className="font-mono"
                        disabled={loading}
                      />
                    </>
                  )}

                  {Object.entries(scriptConfigs)
                    .filter(([key]) => key !== "start" && key !== "install")
                    .map(([key, config]) => {
                      if (
                        (svc.scripts || {})[
                          key as keyof ServiceDataConfig["scripts"]
                        ] === undefined
                      ) {
                        return null;
                      }

                      return (
                        <div key={key}>
                          <div className="flex items-center gap-2 mt-3 justify-between">
                            <div className="flex items-center gap-2">
                              {config.icon}
                              <Label htmlFor={`service-${key}-${idx}`}>
                                {config.label}
                              </Label>
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              onClick={() =>
                                handleRemoveScript(
                                  idx,
                                  key as keyof ServiceDataConfig["scripts"],
                                )
                              }
                              disabled={loading}
                              className="h-6 w-6"
                            >
                              <XCircle className="h-4 w-4" />
                            </Button>
                          </div>
                          <Input
                            id={`service-${key}-${idx}`}
                            placeholder={config.placeholder}
                            value={
                              (svc.scripts || {})[
                                key as keyof ServiceDataConfig["scripts"]
                              ] || ""
                            }
                            onChange={(e) =>
                              handleServiceScriptChange(
                                idx,
                                key as keyof ServiceDataConfig["scripts"],
                                e.target.value,
                              )
                            }
                            className="font-mono"
                            disabled={loading}
                          />
                        </div>
                      );
                    })}

                  {Object.entries(scriptConfigs).some(
                    ([key]) =>
                      key !== "start" &&
                      (svc.scripts || {})[
                        key as keyof ServiceDataConfig["scripts"]
                      ] === undefined,
                  ) && (
                    <div className="mt-4">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={loading}
                            className="w-full flex items-center justify-center"
                          >
                            <PlusCircle className="h-4 w-4 mr-2" />
                            Add Script
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          {Object.entries(scriptConfigs)
                            .filter(
                              ([key]) =>
                                key !== "start" &&
                                svc.scripts[
                                  key as keyof ServiceDataConfig["scripts"]
                                ] === undefined,
                            )
                            .map(([key, config]) => (
                              <DropdownMenuItem
                                key={key}
                                onClick={() =>
                                  handleAddScript(
                                    idx,
                                    key as keyof ServiceDataConfig["scripts"],
                                  )
                                }
                                disabled={loading}
                                className="flex items-center gap-2"
                              >
                                {config.icon}
                                {config.label}
                                <span className="text-xs text-muted-foreground ml-1">
                                  ({config.description})
                                </span>
                              </DropdownMenuItem>
                            ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  )}
                </div>

                {/* Environment Variables Section */}
                <div className="border-t pt-4 mt-4">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => toggleEnvSection(idx)}
                    disabled={loading}
                    className="flex items-center space-x-2 p-0 h-auto hover:bg-transparent"
                  >
                    {expandedEnvSections[idx] ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                    <span className="text-sm font-medium">
                      Environment Variables
                      {Object.keys(svc.env || {}).length > 0 && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          ({Object.keys(svc.env || {}).length})
                        </span>
                      )}
                    </span>
                  </Button>

                  {expandedEnvSections[idx] && (
                    <div className="mt-3 space-y-3 animate-in fade-in-0 slide-in-from-top-2 duration-200">
                      <p className="text-xs text-muted-foreground">
                        Service-specific environment variables. These override global variables with the same name.
                      </p>

                      {Object.entries(svc.env || {}).length === 0 ? (
                        <p className="text-sm text-muted-foreground italic">
                          No environment variables defined for this service.
                        </p>
                      ) : (
                        Object.entries(svc.env || {}).map(([key, value]) => {
                          const visKey = `${idx}-${key}`;
                          const isVisible = visibleEnvVars[visKey];

                          return (
                            <div key={key} className="flex gap-2 items-center">
                              <Input
                                placeholder="KEY"
                                value={key}
                                onChange={(e) =>
                                  handleServiceEnvChange(
                                    idx,
                                    key,
                                    'key',
                                    e.target.value,
                                    key
                                  )
                                }
                                className="w-1/3 font-mono"
                                disabled={loading}
                              />
                              <div className="relative w-1/2">
                                <Input
                                  placeholder="VALUE"
                                  type={isVisible ? "text" : "password"}
                                  value={value}
                                  onChange={(e) =>
                                    handleServiceEnvChange(
                                      idx,
                                      key,
                                      'value',
                                      e.target.value
                                    )
                                  }
                                  className="pr-10 font-mono"
                                  disabled={loading}
                                />
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => toggleEnvVisibility(idx, key)}
                                  className="absolute right-0 top-0 h-full px-3"
                                  disabled={loading}
                                >
                                  {isVisible ? (
                                    <EyeOff className="h-4 w-4" />
                                  ) : (
                                    <Eye className="h-4 w-4" />
                                  )}
                                </Button>
                              </div>
                              <Button
                                type="button"
                                variant="outline"
                                onClick={() => handleRemoveServiceEnv(idx, key)}
                                className="px-2"
                                disabled={loading}
                              >
                                Remove
                              </Button>
                            </div>
                          );
                        })
                      )}

                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => handleAddServiceEnv(idx)}
                        disabled={loading}
                        className="mt-2"
                      >
                        <PlusCircle className="h-4 w-4 mr-2" />
                        Add Variable
                      </Button>
                    </div>
                  )}
                </div>

                {/* Advanced PM2 Config Section */}
                <div className="border-t pt-4 mt-4">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => toggleAdvancedSection(idx)}
                    disabled={loading}
                    className="flex items-center space-x-2 p-0 h-auto hover:bg-transparent"
                  >
                    {expandedAdvancedSections[idx] ? (
                      <ChevronDown className="w-4 h-4" />
                    ) : (
                      <ChevronRight className="w-4 h-4" />
                    )}
                    <span className="text-sm font-medium">
                      Advanced PM2 Config
                      {Object.keys(svc.advanced || {}).length > 0 && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          ({Object.keys(svc.advanced || {}).length})
                        </span>
                      )}
                    </span>
                  </Button>

                  {expandedAdvancedSections[idx] && (
                    <div className="mt-3 space-y-3 animate-in fade-in-0 slide-in-from-top-2 duration-200">
                      <p className="text-xs text-muted-foreground">
                        PM2-level config fields like instances, autorestart, watch, max_memory_restart.
                      </p>

                      {Object.entries(svc.advanced || {}).length === 0 ? (
                        <p className="text-sm text-muted-foreground italic">
                          No advanced config defined for this service.
                        </p>
                      ) : (
                        Object.entries(svc.advanced || {}).map(([key, value]) => (
                          <div key={key} className="flex gap-2 items-center">
                            <Input
                              placeholder="Field name"
                              value={key}
                              onChange={(e) =>
                                handleAdvancedChange(idx, key, 'key', e.target.value)
                              }
                              className="w-1/3 font-mono"
                              disabled={loading}
                            />
                            <Input
                              placeholder="Value"
                              value={String(value)}
                              onChange={(e) =>
                                handleAdvancedChange(idx, key, 'value', e.target.value)
                              }
                              className="w-1/2 font-mono"
                              disabled={loading}
                            />
                            <Button
                              type="button"
                              variant="outline"
                              onClick={() => handleRemoveAdvanced(idx, key)}
                              className="px-2"
                              disabled={loading}
                            >
                              Remove
                            </Button>
                          </div>
                        ))
                      )}

                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => handleAddAdvanced(idx)}
                        disabled={loading}
                        className="mt-2"
                      >
                        <PlusCircle className="h-4 w-4 mr-2" />
                        Add Config
                      </Button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}

          <Button
            type="button"
            variant="secondary"
            onClick={handleAddService}
            disabled={loading}
          >
            Add Service
          </Button>
        </>
      )}
    </div>
  );
}
