import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Activity, CheckCircle, Sparkles } from "lucide-react";
import { useRouter } from "next/navigation";
import { useWizardStore } from "@/stores/useWizardStore";

export const CompletionStep = () => {
  const workspaceSlug = useWizardStore((s) => s.workspaceSlug);

  const router = useRouter();

  const onNewTask = () => {
    router.push(`/w/${workspaceSlug}/task/new`);
  };

  return (
    <Card className="max-w-2xl mx-auto bg-card text-card-foreground">
      <CardHeader className="text-center">
        <div className="flex items-center justify-center mx-auto mb-4">
          {/* Animated success checkmark with sparkles */}
          <div className="relative">
            <div className="w-16 h-16 bg-green-600 rounded-full flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-white" />
            </div>
            {/* Sparkle animations */}
            <Sparkles className="w-4 h-4 text-yellow-400 absolute -top-1 -right-1 animate-pulse" />
            <Sparkles
              className="w-3 h-3 text-blue-400 absolute -bottom-1 -left-1 animate-pulse"
              style={{ animationDelay: "0.5s" }}
            />
            <Sparkles
              className="w-3 h-3 text-purple-400 absolute top-1 -left-2 animate-pulse"
              style={{ animationDelay: "1s" }}
            />
          </div>
        </div>
        <CardTitle className="text-2xl text-foreground">
          You're All Set — Start Building
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="text-center">
          {/* Success indicators - centered as a group with aligned checkmarks */}
          <div className="flex flex-col items-center space-y-3 mb-8">
            <div className="flex items-center gap-3 text-sm w-48">
              <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
              <span className="text-left">Repository connected</span>
            </div>
            <div className="flex items-center gap-3 text-sm w-48">
              <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
              <span className="text-left">Codebase ingested</span>
            </div>
            <div className="flex items-center gap-3 text-sm w-48">
              <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
              <span className="text-left">Environment setup</span>
            </div>
            <div className="flex items-center gap-3 text-sm w-48">
              <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
              <span className="text-left">Workspace ready</span>
            </div>
          </div>
        </div>

        <div className="flex justify-center">
          <Button
            onClick={onNewTask}
            className="w-full max-w-xs bg-black hover:bg-gray-800 text-white p-4 flex items-center justify-center gap-2"
          >
            <Activity className="h-4 w-4" />
            Create Task
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};
