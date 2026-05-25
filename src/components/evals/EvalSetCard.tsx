import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { JarvisNode } from "@/types/jarvis";

interface EvalSetCardProps {
  evalSet: JarvisNode;
  onClick: () => void;
}

export function EvalSetCard({ evalSet, onClick }: EvalSetCardProps) {
  const name = String(evalSet.properties?.name ?? "Unnamed Eval Set");
  const description = evalSet.properties?.description
    ? String(evalSet.properties.description)
    : null;
  const requirementCount =
    typeof evalSet.properties?.requirement_count === "number"
      ? evalSet.properties.requirement_count
      : 0;

  return (
    <Card
      className="cursor-pointer hover:border-primary/50 transition-colors"
      onClick={onClick}
      data-testid="eval-set-card"
    >
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base font-semibold">{name}</CardTitle>
          <Badge variant="secondary" className="shrink-0">
            {requirementCount} req{requirementCount !== 1 ? "s" : ""}
          </Badge>
        </div>
      </CardHeader>
      {description && (
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground line-clamp-2">{description}</p>
        </CardContent>
      )}
    </Card>
  );
}
