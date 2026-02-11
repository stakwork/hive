import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export function VMCardSkeleton() {
  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Skeleton className="h-2 w-2 rounded-full" />
            <Skeleton className="h-4 w-32" />
          </div>
          <Skeleton className="h-6 w-6 rounded" />
        </div>

        {/* User/Status Message */}
        <Skeleton className="h-3 w-24" />

        {/* Resource Placeholders */}
        <div className="space-y-2 pt-1">
          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <Skeleton className="h-3 w-8" />
              <Skeleton className="h-3 w-12" />
            </div>
            <Skeleton className="h-1 w-full rounded-full" />
          </div>

          <div className="space-y-1">
            <div className="flex items-center justify-between text-xs">
              <Skeleton className="h-3 w-12" />
              <Skeleton className="h-3 w-12" />
            </div>
            <Skeleton className="h-1 w-full rounded-full" />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
