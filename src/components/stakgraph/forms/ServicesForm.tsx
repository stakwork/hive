import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Play, Download, Hammer, TestTube } from "lucide-react";
import { ServicesData, FormSectionProps, ServiceDataConfig } from "../types";

export default function ServicesForm({
  data,
  loading,
  onChange,
}: Omit<FormSectionProps<ServiceDataConfig[]>, "errors">) {
  console.log("SERVICES DATA: ", data);

  const handleAddService = () => {
    const newServices = [
      ...data,
      {
        name: "",
        port: 0,
        scripts: { start: "", install: "", build: "", test: "" },
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

                  <div className="w-1/4">
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
                    <Play className="w-4 h-4 text-muted-foreground" />
                    <Label htmlFor={`service-start-${idx}`}>Start</Label>
                  </div>
                  <Input
                    id={`service-start-${idx}`}
                    placeholder="npm start"
                    value={svc.scripts.start}
                    onChange={(e) =>
                      handleServiceScriptChange(idx, "start", e.target.value)
                    }
                    className="font-mono"
                    disabled={loading}
                    required
                  />

                  <div className="flex items-center gap-2 mt-3">
                    <Download className="w-4 h-4 text-muted-foreground" />
                    <Label htmlFor={`service-install-${idx}`}>Install</Label>
                  </div>
                  <Input
                    id={`service-install-${idx}`}
                    placeholder="npm install"
                    value={svc.scripts.install || ""}
                    onChange={(e) =>
                      handleServiceScriptChange(idx, "install", e.target.value)
                    }
                    className="font-mono"
                    disabled={loading}
                  />

                  <div className="flex items-center gap-2 mt-3">
                    <Hammer className="w-4 h-4 text-muted-foreground" />
                    <Label htmlFor={`service-build-${idx}`}>Build</Label>
                  </div>
                  <Input
                    id={`service-build-${idx}`}
                    placeholder="npm run build"
                    value={svc.scripts.build || ""}
                    onChange={(e) =>
                      handleServiceScriptChange(idx, "build", e.target.value)
                    }
                    className="font-mono"
                    disabled={loading}
                  />

                  <div className="flex items-center gap-2 mt-3">
                    <TestTube className="w-4 h-4 text-muted-foreground" />
                    <Label htmlFor={`service-test-${idx}`}>Test</Label>
                  </div>
                  <Input
                    id={`service-test-${idx}`}
                    placeholder="npm test"
                    value={svc.scripts.test || ""}
                    onChange={(e) =>
                      handleServiceScriptChange(idx, "test", e.target.value)
                    }
                    className="font-mono"
                    disabled={loading}
                  />
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
