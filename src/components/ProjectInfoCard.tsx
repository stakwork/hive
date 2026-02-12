import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Calendar, GitBranch, Workflow, Activity } from "lucide-react";
import { formatRelativeOrDate } from "@/lib/date-utils";

interface ProjectInfoCardProps {
  projectData: {
    id: number;
    name: string;
    workflow_state: string;
    workflow_id: number;
    created_at: string;
    updated_at: string;
    current_transition?: number;
    current_transition_completion?: number;
  };
}

const getWorkflowStateBadgeVariant = (state: string): "default" | "destructive" | "secondary" => {
  switch (state.toLowerCase()) {
    case "error":
    case "failed":
      return "destructive";
    case "running":
    case "in_progress":
      return "secondary";
    case "completed":
    case "success":
      return "default";
    default:
      return "secondary";
  }
};

const getWorkflowStateColor = (state: string): string => {
  switch (state.toLowerCase()) {
    case "error":
    case "failed":
      return "text-red-600 dark:text-red-400";
    case "running":
    case "in_progress":
      return "text-yellow-600 dark:text-yellow-400";
    case "completed":
    case "success":
      return "text-green-600 dark:text-green-400";
    default:
      return "text-gray-600 dark:text-gray-400";
  }
};

export function ProjectInfoCard({ projectData }: ProjectInfoCardProps) {
  const {
    id,
    name,
    workflow_state,
    workflow_id,
    created_at,
    updated_at,
    current_transition_completion,
  } = projectData;

  const progress =
    current_transition_completion !== undefined ? Math.round(current_transition_completion * 100) : null;

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5" />
          Project Information
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Project Name */}
          <div>
            <div className="text-sm font-medium text-muted-foreground mb-1">Project Name</div>
            <div className="text-base font-semibold">{name}</div>
          </div>

          {/* Project ID */}
          <div>
            <div className="text-sm font-medium text-muted-foreground mb-1">Project ID</div>
            <div className="text-base font-mono">{id}</div>
          </div>

          {/* Workflow State */}
          <div>
            <div className="text-sm font-medium text-muted-foreground mb-1">Workflow State</div>
            <Badge variant={getWorkflowStateBadgeVariant(workflow_state)}>
              <span className={getWorkflowStateColor(workflow_state)}>{workflow_state}</span>
            </Badge>
          </div>

          {/* Workflow ID */}
          <div>
            <div className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-1">
              <Workflow className="h-4 w-4" />
              Using Workflow
            </div>
            <div className="text-base font-mono flex items-center gap-2">
              <GitBranch className="h-4 w-4" />
              {workflow_id}
            </div>
          </div>

          {/* Created At */}
          <div>
            <div className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-1">
              <Calendar className="h-4 w-4" />
              Created At
            </div>
            <div className="text-base">{formatRelativeOrDate(new Date(created_at))}</div>
          </div>

          {/* Updated At */}
          <div>
            <div className="text-sm font-medium text-muted-foreground mb-1 flex items-center gap-1">
              <Calendar className="h-4 w-4" />
              Updated At
            </div>
            <div className="text-base">{formatRelativeOrDate(new Date(updated_at))}</div>
          </div>
        </div>

        {/* Progress Bar */}
        {progress !== null && (
          <div className="mt-4">
            <div className="flex justify-between items-center mb-2">
              <div className="text-sm font-medium text-muted-foreground">Current Transition Progress</div>
              <div className="text-sm font-semibold">{progress}%</div>
            </div>
            <div className="w-full bg-gray-200 dark:bg-gray-700 rounded-full h-2.5">
              <div
                className="bg-blue-600 dark:bg-blue-500 h-2.5 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
