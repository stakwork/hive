import { Badge } from "@/components/ui/badge";
import { formatNumber } from "@/lib/utils/format";

interface MetricDisplayProps {
  label: string;
  percent: number;
  covered: number;
  total: number;
  icon?: React.ReactNode;
}

export function MetricDisplay({ label, percent, covered, total, icon }: MetricDisplayProps) {
  const getPercentageColor = (percent: number) => {
    if (percent >= 70) return "text-green-600 border-green-200 bg-green-50";
    if (percent >= 15) return "text-yellow-600 border-yellow-200 bg-yellow-50";
    return "text-red-600 border-red-200 bg-red-50";
  };

  const getProgressColor = (percent: number) => {
    if (percent >= 70) return "bg-green-500";
    if (percent >= 15) return "bg-yellow-500";
    return "bg-red-500";
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-2">
          {icon}
          <span className="text-xs font-medium text-muted-foreground">{label}</span>
        </div>
        <Badge variant="outline" className={getPercentageColor(percent)}>
          {percent.toFixed(1)}%
        </Badge>
      </div>

      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className={`h-2 rounded-full transition-all duration-300 ${getProgressColor(percent)}`}
          style={{
            width: `${Math.min(percent, 100)}%`,
          }}
        />
      </div>

      <div className="flex justify-between text-xs text-muted-foreground">
        <span>{formatNumber(covered)} covered</span>
        <span>{formatNumber(total)} total</span>
      </div>
    </div>
  );
}
