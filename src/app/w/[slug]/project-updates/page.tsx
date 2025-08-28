"use client";

import { useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useToast } from "@/components/ui/use-toast";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useFeatureFlag } from "@/hooks/useFeatureFlag";
import { FEATURE_FLAGS } from "@/lib/feature-flags";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { MessageSquare } from "lucide-react";

export default function ProjectUpdatesPage() {
  const { data: session } = useSession();
  const { toast } = useToast();
  const { workspace, slug } = useWorkspace();
  const router = useRouter();
  const canAccessPRD = useFeatureFlag(FEATURE_FLAGS.PROJECT_UPDATES);
  
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);



  const handleSubmit = useCallback(async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading || !session?.user?.id || !workspace?.id) return;

    setIsLoading(true);
    
    try {
      const response = await fetch(`/api/project-updates/message`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: input.trim(),
          workspaceId: workspace.id,
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error || "Failed to create project update");
      }

      if (result.success && result.taskId) {
        router.push(`/w/${slug}/task/${result.taskId}`);
        return;
      }
    } catch (error: any) {
      toast({
        title: "Error",
        description: error.message || "Failed to send project update request",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  }, [input, isLoading, session?.user?.id, workspace?.id, toast, router, slug]);


  // Redirect if feature not enabled
  if (!canAccessPRD) {
    return (
      <div className="space-y-6">
        <PageHeader 
          title="Project Updates"
          description="Feature not available"
        />
        <Card>
          <CardContent className="pt-6">
            <p>The Project Updates feature is not currently enabled.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader 
        title="Project Updates"
        description="Get real-time updates based on your recent calls and messages."
      />
      
      <Card className="max-w-2xl mx-auto mt-8">
        <CardContent className="pt-6">
          <div className="flex flex-col items-center text-center space-y-4">
            <div className="p-3 bg-primary/10 rounded-full">
              <MessageSquare className="h-8 w-8 text-primary" />
            </div>
            
            <div className="space-y-2">
              <h2 className="text-2xl font-semibold">Check project status</h2>
              <p className="text-muted-foreground">
              Ask about the current state of any of your projects.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="w-full mt-6 space-y-4">
              <Input
                placeholder='e.g. "Status of the logging project"'
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="w-full"
                disabled={isLoading}
                autoFocus
              />
              <Button 
                type="submit" 
                className="w-full" 
                disabled={!input.trim() || isLoading}
              >
                {isLoading ? "Creating update request..." : "Get Update"}
              </Button>
            </form>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}