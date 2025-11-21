import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Circle } from "lucide-react";
import { VMData } from "@/types/pool-manager";

interface VMGridProps {
  vms: VMData[];
}

function getStatusIndicator(state: string, usage_status: string) {
  if (state === "running" && usage_status === "used") {
    return <Circle className="h-2 w-2 fill-green-500 text-green-500" />;
  }
  if (state === "pending") {
    return <Circle className="h-2 w-2 fill-yellow-500 text-yellow-500" />;
  }
  if (state === "failed") {
    return <Circle className="h-2 w-2 fill-red-500 text-red-500" />;
  }
  return <Circle className="h-2 w-2 fill-muted-foreground text-muted-foreground" />;
}

function VMCard({ vm }: { vm: VMData }) {
  const cpuPercent = vm.resource_usage.available
    ? (parseFloat(vm.resource_usage.usage.cpu) / parseFloat(vm.resource_usage.requests.cpu)) * 100
    : 0;
  const memoryPercent = vm.resource_usage.available
    ? (parseFloat(vm.resource_usage.usage.memory) / parseFloat(vm.resource_usage.requests.memory)) * 100
    : 0;

  const isHighUsage = cpuPercent > 70 || memoryPercent > 70;

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            {getStatusIndicator(vm.state, vm.usage_status)}
            <span className="font-mono text-sm font-medium truncate">{vm.subdomain}</span>
          </div>
          {vm.state === "pending" && (
            <Badge variant="outline" className="text-xs">
              Pending
            </Badge>
          )}
        </div>

        {/* User or Pending Message */}
        {vm.state === "pending" ? (
          <p className="text-xs text-muted-foreground">Preparing your environment...</p>
        ) : vm.user_info ? (
          <p className="text-xs text-muted-foreground truncate">{vm.user_info}</p>
        ) : null}

        {/* Resources */}
        {vm.resource_usage.available && (
          <div className="space-y-2 pt-1">
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">CPU</span>
                <span className={`font-medium tabular-nums ${isHighUsage && cpuPercent > 70 ? "text-amber-600" : ""}`}>
                  {cpuPercent.toFixed(1)}%
                </span>
              </div>
              <div className="h-1 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${cpuPercent > 70 ? "bg-amber-500" : "bg-primary"}`}
                  style={{ width: `${Math.min(cpuPercent, 100)}%` }}
                />
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Memory</span>
                <span
                  className={`font-medium tabular-nums ${isHighUsage && memoryPercent > 70 ? "text-amber-600" : ""}`}
                >
                  {memoryPercent.toFixed(1)}%
                </span>
              </div>
              <div className="h-1 bg-muted rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${memoryPercent > 70 ? "bg-amber-500" : "bg-primary"}`}
                  style={{ width: `${Math.min(memoryPercent, 100)}%` }}
                />
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function VMGrid({ vms }: VMGridProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-4">
      {vms.map((vm) => (
        <VMCard key={vm.id} vm={vm} />
      ))}
    </div>
  );
}
