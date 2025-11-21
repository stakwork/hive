import { Handle, Position } from "@xyflow/react";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { User as UserIcon, Bot } from "lucide-react";
import type { TicketListItem } from "@/types/roadmap";
import { PRIORITY_LABELS } from "@/types/roadmap";

interface RoadmapTaskNodeProps {
  data: TicketListItem;
}

export function RoadmapTaskNode({ data }: RoadmapTaskNodeProps) {
  const statusColors = {
    TODO: {
      border: "border-gray-400",
      bg: "bg-gray-50 dark:bg-gray-900",
      hover: "hover:border-gray-600",
    },
    IN_PROGRESS: {
      border: "border-amber-400",
      bg: "bg-amber-50 dark:bg-amber-950",
      hover: "hover:border-amber-600",
    },
    DONE: {
      border: "border-green-500",
      bg: "bg-green-50 dark:bg-green-950",
      hover: "hover:border-green-700",
    },
    BLOCKED: {
      border: "border-red-500",
      bg: "bg-red-50 dark:bg-red-950",
      hover: "hover:border-red-700",
    },
    CANCELLED: {
      border: "border-slate-400",
      bg: "bg-slate-50 dark:bg-slate-950",
      hover: "hover:border-slate-600",
    },
  };

  const colors = statusColors[data.status];

  return (
    <>
      <Handle type="target" position={Position.Left} />
      <div
        className={`px-4 py-3 rounded-lg border-2 ${colors.border} ${colors.bg} ${colors.hover} shadow-lg hover:shadow-xl transition-all cursor-pointer min-w-[250px]`}
      >
        <div className="flex flex-col gap-2">
          <div className="font-semibold text-sm line-clamp-2 text-gray-900 dark:text-gray-100">{data.title}</div>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="outline" className="text-xs font-medium">
              {data.status.replace("_", " ")}
            </Badge>
            <Badge variant="outline" className="text-xs font-medium bg-slate-100 dark:bg-slate-800">
              {PRIORITY_LABELS[data.priority]}
            </Badge>
          </div>
          {data.assignee && (
            <div className="flex items-center gap-2">
              <Avatar className="h-5 w-5">
                <AvatarImage src={data.assignee.image || undefined} />
                <AvatarFallback className="text-xs bg-gray-200 dark:bg-gray-700">
                  {data.assignee.icon === "bot" ? (
                    <Bot className="h-3 w-3" />
                  ) : (
                    data.assignee.name?.charAt(0).toUpperCase() || <UserIcon className="h-3 w-3" />
                  )}
                </AvatarFallback>
              </Avatar>
              <div className="text-xs text-gray-600 dark:text-gray-400 truncate">
                {data.assignee.name || data.assignee.email}
              </div>
            </div>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} />
    </>
  );
}
