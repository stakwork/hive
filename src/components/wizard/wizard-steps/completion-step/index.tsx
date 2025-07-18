import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Activity, CheckCircle, Sparkles } from "lucide-react";

interface CompletionStepProps {
  onCreateTask: () => void;
  stepStatus?: 'PENDING' | 'STARTED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  onStatusChange?: (status: 'PENDING' | 'STARTED' | 'PROCESSING' | 'COMPLETED' | 'FAILED') => void;
}

const CompletionStep = ({ 
  onCreateTask, 
  onStatusChange 
}: CompletionStepProps) => {
  const handleCreateTask = () => {
    onStatusChange?.('COMPLETED');
    onCreateTask();
  };

  return (
    <Card className="max-w-2xl mx-auto bg-card text-card-foreground">
      <CardHeader className="text-center">
        <div className="flex items-center justify-center mx-auto mb-4">
          {/* Animated success checkmark with sparkles */}
          <div className="relative">
            <div className="w-16 h-16 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center">
              <CheckCircle className="w-8 h-8 text-green-600 dark:text-green-300">
                <animate attributeName="opacity" values="0;1" dur="0.8s" fill="freeze" />
              </CheckCircle>
            </div>
            {/* Sparkle animations */}
            <Sparkles className="w-4 h-4 text-yellow-500 absolute -top-1 -right-1 animate-pulse" />
            <Sparkles className="w-3 h-3 text-blue-500 absolute -bottom-1 -left-1 animate-pulse" style={{ animationDelay: '0.5s' }} />
            <Sparkles className="w-3 h-3 text-purple-500 absolute top-1 -left-2 animate-pulse" style={{ animationDelay: '1s' }} />
          </div>
        </div>
        <CardTitle className="text-2xl text-green-700 dark:text-green-300">
          Code Graph Complete!
        </CardTitle>
        <CardDescription className="text-lg">
          Your workspace is ready and connected to Stakwork
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="text-center">
          <p className="text-muted-foreground mb-6">
            Everything is set up and ready to go. You can now start creating tasks and automating your workflows.
          </p>
          
          {/* Success indicators */}
          <div className="space-y-3 max-w-sm mx-auto mb-8">
            <div className="flex items-center gap-3 text-sm">
              <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-300" />
              <span>Repository connected</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-300" />
              <span>Stakwork account created</span>
            </div>
            <div className="flex items-center gap-3 text-sm">
              <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-300" />
              <span>Automation engine ready</span>
            </div>
          </div>
        </div>

        <div className="flex justify-center">
          <Button 
            onClick={handleCreateTask} 
            className="w-full max-w-xs text-left p-4 bg-primary hover:bg-primary/90 flex items-center justify-center gap-2"
          >
            <Activity className="h-4 w-4" />
            Create new task
          </Button>
        </div>
      </CardContent>
    </Card>
  );
};

export default CompletionStep; 