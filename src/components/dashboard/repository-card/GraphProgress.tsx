import { StakgraphProgressEvent } from "@/types/stakgraph";
import { Progress } from "@/components/ui/progress";

interface GraphProgressProps {
  event: StakgraphProgressEvent | null;
}

export function GraphProgress({ event }: GraphProgressProps) {
  if (!event) return null;

  return (
    <div className="space-y-3 py-4">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">
          Step {event.step} of {event.total_steps}
        </span>
        <span className="font-medium">{Math.round(event.progress)}%</span>
      </div>
      <Progress value={event.progress} className="h-2.5 [&>div]:bg-blue-500" />
      <div className="text-xs text-muted-foreground">{event.message}</div>
      {event.stats && Object.keys(event.stats).length > 0 && (
        <div className="flex gap-3 text-xs text-muted-foreground">
          {Object.entries(event.stats).map(([key, value]) => (
            <span key={key}>
              {key}: <span className="font-medium text-foreground">{value}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
