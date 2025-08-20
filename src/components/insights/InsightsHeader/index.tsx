import { BarChart3 } from "lucide-react";

export function InsightsHeader() {
  return (
    <div className="flex items-center space-x-3">
      <BarChart3 className="h-8 w-8 text-blue-600" />
      <div>
        <h1 className="text-3xl font-bold">Insights</h1>
        <p className="text-muted-foreground">Automated codebase analysis and recommendations</p>
      </div>
    </div>
  );
}