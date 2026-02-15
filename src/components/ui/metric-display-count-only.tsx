import React from "react";
import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/utils/format";

interface MetricDisplayCountOnlyProps {
  label: string;
  count: number;
  icon?: React.ReactNode;
}

export function MetricDisplayCountOnly({ label, count, icon }: MetricDisplayCountOnlyProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          {icon}
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
        </div>
        <Badge variant="outline" className="text-green-600 border-green-200 bg-green-50">
          {formatNumber(count)} {count === 1 ? "test" : "tests"}
        </Badge>
      </div>
    </div>
  );
}
