import { Card, CardContent } from "@/components/ui/card";
import { PoolStatusResponse } from "@/types/pool-manager";

interface PoolSummaryProps {
  poolStatus: PoolStatusResponse["status"];
}

export function PoolSummary({ poolStatus }: PoolSummaryProps) {
  const totalVms = poolStatus.runningVms + poolStatus.pendingVms + poolStatus.failedVms;
  const usedPercent = (poolStatus.usedVms / totalVms) * 100;

  return (
    <Card>
      <CardContent className="p-6">
        <div className="flex items-center gap-6 mb-4">
          <div>
            <p className="text-sm text-muted-foreground">Active</p>
            <p className="text-2xl font-bold tabular-nums">{poolStatus.usedVms}/{totalVms}</p>
          </div>
          {poolStatus.pendingVms > 0 && (
            <div>
              <p className="text-sm text-muted-foreground">Pending</p>
              <p className="text-2xl font-bold tabular-nums text-amber-600">{poolStatus.pendingVms}</p>
            </div>
          )}
          <div>
            <p className="text-sm text-muted-foreground">Available</p>
            <p className="text-2xl font-bold tabular-nums">{poolStatus.unusedVms}</p>
          </div>
        </div>

        {/* Capacity bar */}
        <div className="space-y-2">
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>Capacity</span>
            <span className="tabular-nums">{usedPercent.toFixed(0)}% utilized</span>
          </div>
          <div className="h-2 bg-muted rounded-full overflow-hidden">
            <div
              className="h-full bg-primary transition-all"
              style={{ width: `${usedPercent}%` }}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
