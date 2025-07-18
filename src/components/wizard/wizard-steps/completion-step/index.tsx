import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Activity, CheckCircle, Sparkles } from "lucide-react";

interface CompletionStepProps {
  onCreateTask: () => void;
}

const CompletionStep = ({ onCreateTask }: CompletionStepProps) => {
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
            <Sparkles className="w-3 h-3 text-blue-400 absolute -bottom-1 -left-1 animate-pulse" style={{ animationDelay: '0.5s' }} />
            <Sparkles className="w-3 h-3 text-purple-400 absolute top-1 -left-2 animate-pulse" style={{ animationDelay: '1s' }} />
          </div>
        </div>
        <CardTitle className="text-2xl text-foreground">
            You&apos;re All Set — Start Building
        </CardTitle>
        <CardDescription className="text-lg">
            Your workspace is ready and your code graph is fully set up.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="text-center">
          <p className="text-muted-foreground mb-6">
          Everything’s connected and good to go — you can now kick off your first task.
          </p>
          
          {/* Success indicators */}
          <div className="space-y-3 max-w-sm mx-auto mb-8">
            <div className="flex items-center gap-3 text-sm">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <span>Repository connected</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <span>Code ingested</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <span>Environment setup</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <CheckCircle className="w-4 h-4 text-green-500" />
              <span>Workspace ready</span>
            </div>
          </div>
        </div>

        <div className="flex justify-center">
          <Button 
            onClick={onCreateTask} 
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

export default CompletionStep;