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
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FormSectionProps, ServiceDataConfig } from "../types";

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
  };

  const handleAddService = () => {
    const newServices = [
      ...data,
      {
        name: "",
        port: 0,
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
        ? { ...svc, scripts: { ...svc.scripts, [scriptKey]: value } }
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
          scripts: { ...svc.scripts, [scriptKey]: "" },
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
        const updatedScripts = { ...svc.scripts };
        delete updatedScripts[scriptKey];
        return { ...svc, scripts: updatedScripts };
      }
      return svc;
    });
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
                <div className="mb-2">
                  <span className="text-md font-bold">Service</span>
                </div>

                <div className="flex gap-2 mb-2 items-end">
                  <div className="w-1/3">
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

                  <div className="w-1/6">
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

                  <div className="w-1/4">
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

                  <div className="flex-1 flex justify-end">
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
                    value={svc.scripts.start}
                    onChange={(e) =>
                      handleServiceScriptChange(idx, "start", e.target.value)
                    }
                    className="font-mono"
                    disabled={loading}
                    required
                  />

                  {svc.scripts.install !== undefined && (
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
                        value={svc.scripts.install || ""}
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
                        svc.scripts[
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
                              svc.scripts[
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
                      svc.scripts[key as keyof ServiceDataConfig["scripts"]] ===
                        undefined,
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
