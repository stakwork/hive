"use client";

import React, { useEffect } from "react";
import { useTutorial } from "@/contexts/TutorialContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Sparkles, Database, ListChecks, Lightbulb, CheckCircle } from "lucide-react";
import { usePathname } from "next/navigation";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useIngestStatus } from "@/hooks/useIngestStatus";

export function TutorialModal() {
  const { isActive, currentStep, nextStep, skipTutorial } = useTutorial();
  const pathname = usePathname();
  const { workspace } = useWorkspace();
  const { status: ingestStatus } = useIngestStatus();

  // Handle automatic progression based on user navigation
  useEffect(() => {
    if (!isActive) return;

    if (currentStep === "navigate-to-tasks" && pathname.includes("/tasks")) {
      nextStep();
    }

    if (currentStep === "navigate-to-insights" && pathname.includes("/insights")) {
      nextStep();
    }
  }, [pathname, currentStep, isActive, nextStep]);

  if (!isActive || currentStep === "complete") {
    return null;
  }

  // Get position based on current step
  const getPositionClass = () => {
    switch (currentStep) {
      case "welcome":
      case "ingestion":
        return "top-20 left-1/2 -translate-x-1/2"; // Center top
      case "navigate-to-tasks":
      case "navigate-to-insights":
        return "top-20 left-64"; // Right of sidebar (sidebar is typically ~16rem = 64 in Tailwind)
      case "create-task":
        return "top-20 right-4"; // Right side near New Task button
      case "insights-explanation":
        return "top-20 left-1/2 -translate-x-1/2"; // Center top
      default:
        return "top-20 left-1/2 -translate-x-1/2";
    }
  };

  const renderStepContent = () => {
    switch (currentStep) {
      case "welcome":
        return (
          <Card className="w-full max-w-md shadow-2xl border-2 border-blue-500/20">
            <CardHeader>
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="h-6 w-6 text-blue-500" />
                <CardTitle>Welcome to Your Workspace! 🎉</CardTitle>
              </div>
              <CardDescription>
                Let's take a quick tour of Hive to help you get started.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                You've just created a workspace! This is your command center for managing your codebase,
                creating tasks, and getting AI-powered insights.
              </p>
              <div className="bg-blue-50 dark:bg-blue-950/30 p-3 rounded-lg">
                <p className="text-sm font-medium">What you'll learn:</p>
                <ul className="text-sm text-muted-foreground mt-2 space-y-1">
                  <li>• Understanding ingestion status</li>
                  <li>• How to create and manage tasks</li>
                  <li>• Viewing codebase insights</li>
                </ul>
              </div>
            </CardContent>
            <CardFooter className="flex justify-between">
              <Button variant="ghost" onClick={skipTutorial}>
                Skip Tutorial
              </Button>
              <Button onClick={nextStep}>
                Get Started
              </Button>
            </CardFooter>
          </Card>
        );

      case "ingestion":
        const isIngesting = ingestStatus === "PROCESSING" || workspace?.swarm?.ingestRefId;
        return (
          <Card className="w-full max-w-md shadow-2xl border-2 border-blue-500/20">
            <CardHeader>
              <div className="flex items-center gap-2 mb-2">
                <Database className="h-6 w-6 text-blue-500" />
                <CardTitle>Codebase Ingestion</CardTitle>
              </div>
              <CardDescription>
                Your codebase is being processed
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Hive is currently analyzing your repository and building a knowledge graph.
                This process typically takes a few minutes depending on the size of your codebase.
              </p>
              <div className="bg-yellow-50 dark:bg-yellow-950/30 p-3 rounded-lg space-y-2">
                <div className="flex items-center gap-2">
                  {isIngesting ? (
                    <>
                      <div className="h-2 w-2 bg-yellow-500 rounded-full animate-pulse"></div>
                      <p className="text-sm font-medium">Setup in progress...</p>
                    </>
                  ) : (
                    <>
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      <p className="text-sm font-medium">Setup complete!</p>
                    </>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {isIngesting 
                    ? "You can continue using Hive while this completes in the background."
                    : "Your codebase has been successfully processed and is ready to use!"
                  }
                </p>
              </div>
            </CardContent>
            <CardFooter className="flex justify-between">
              <Button variant="ghost" onClick={skipTutorial}>
                Skip Tutorial
              </Button>
              <Button onClick={nextStep}>
                Next
              </Button>
            </CardFooter>
          </Card>
        );

      case "navigate-to-tasks":
        return (
          <Card className="w-full max-w-md shadow-2xl border-2 border-blue-500/20">
            <CardHeader>
              <div className="flex items-center gap-2 mb-2">
                <ListChecks className="h-6 w-6 text-blue-500" />
                <CardTitle>Let's Create a Task</CardTitle>
              </div>
              <CardDescription>
                Navigate to the Tasks page
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Tasks are the heart of Hive. They're where you collaborate with AI to write code,
                fix bugs, and build features.
              </p>
              <div className="bg-blue-50 dark:bg-blue-950/30 p-3 rounded-lg">
                <p className="text-sm font-medium mb-2">📝 What you can do with tasks:</p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• Get AI assistance for coding</li>
                  <li>• Manage your development workflow</li>
                  <li>• Track progress and collaborate</li>
                </ul>
              </div>
              <div className="bg-blue-100 dark:bg-blue-900/50 p-4 rounded-lg border-2 border-blue-500 animate-pulse">
                <p className="text-sm font-bold text-center">
                  👈 Click "Tasks" in the sidebar to continue
                </p>
              </div>
            </CardContent>
            <CardFooter>
              <Button variant="ghost" onClick={skipTutorial} className="w-full">
                Skip Tutorial
              </Button>
            </CardFooter>
          </Card>
        );

      case "create-task":
        return (
          <Card className="w-full max-w-md shadow-2xl border-2 border-blue-500/20">
            <CardHeader>
              <div className="flex items-center gap-2 mb-2">
                <ListChecks className="h-6 w-6 text-green-500" />
                <CardTitle>Create Your First Task</CardTitle>
              </div>
              <CardDescription>
                Click "New Task" to get started
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                You're now on the Tasks page! Here you can see all your tasks and create new ones.
              </p>
              <div className="bg-green-50 dark:bg-green-950/30 p-3 rounded-lg space-y-2">
                <p className="text-sm font-medium">💡 Pro tip:</p>
                <p className="text-xs text-muted-foreground">
                  When creating a task, be specific about what you want to build or fix.
                  The AI works best with clear instructions!
                </p>
              </div>
              <p className="text-sm text-muted-foreground font-medium">
                Try clicking the "New Task" button to see how it works!
              </p>
            </CardContent>
            <CardFooter className="flex justify-between">
              <Button variant="ghost" onClick={skipTutorial}>
                Skip Tutorial
              </Button>
              <Button onClick={nextStep}>
                Next
              </Button>
            </CardFooter>
          </Card>
        );

      case "navigate-to-insights":
        return (
          <Card className="w-full max-w-md shadow-2xl border-2 border-blue-500/20">
            <CardHeader>
              <div className="flex items-center gap-2 mb-2">
                <Lightbulb className="h-6 w-6 text-yellow-500" />
                <CardTitle>Discover Insights</CardTitle>
              </div>
              <CardDescription>
                Let's check out the Insights page
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                The Insights page is where Hive's AI analyzes your codebase and provides
                recommendations for improvements.
              </p>
              <div className="bg-purple-50 dark:bg-purple-950/30 p-3 rounded-lg">
                <p className="text-sm font-medium mb-2">🔍 What you'll find:</p>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• Test coverage analysis</li>
                  <li>• Security recommendations</li>
                  <li>• Code quality insights</li>
                  <li>• Automated suggestions</li>
                </ul>
              </div>
              <div className="bg-purple-100 dark:bg-purple-900/50 p-4 rounded-lg border-2 border-purple-500 animate-pulse">
                <p className="text-sm font-bold text-center">
                  👈 Click "Insights" in the sidebar to continue
                </p>
              </div>
            </CardContent>
            <CardFooter>
              <Button variant="ghost" onClick={skipTutorial} className="w-full">
                Skip Tutorial
              </Button>
            </CardFooter>
          </Card>
        );

      case "insights-explanation":
        return (
          <Card className="w-full max-w-md shadow-2xl border-2 border-blue-500/20">
            <CardHeader>
              <div className="flex items-center gap-2 mb-2">
                <Lightbulb className="h-6 w-6 text-yellow-500" />
                <CardTitle>Insights Overview</CardTitle>
              </div>
              <CardDescription>
                Understanding your codebase health
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Great! You're now viewing the Insights page. This is your dashboard for
                understanding code quality and getting AI-powered recommendations.
              </p>
              <div className="space-y-3">
                <div className="bg-blue-50 dark:bg-blue-950/30 p-3 rounded-lg">
                  <p className="text-sm font-medium">🧪 Test Coverage</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    See how much of your code is covered by tests
                  </p>
                </div>
                <div className="bg-green-50 dark:bg-green-950/30 p-3 rounded-lg">
                  <p className="text-sm font-medium">🤖 Janitors</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Enable automated testing and security scans
                  </p>
                </div>
                <div className="bg-yellow-50 dark:bg-yellow-950/30 p-3 rounded-lg">
                  <p className="text-sm font-medium">✨ Recommendations</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Get AI suggestions for code improvements
                  </p>
                </div>
              </div>
            </CardContent>
            <CardFooter className="flex justify-between">
              <Button variant="ghost" onClick={skipTutorial}>
                Skip Tutorial
              </Button>
              <Button onClick={nextStep}>
                Finish Tutorial
              </Button>
            </CardFooter>
          </Card>
        );

      default:
        return null;
    }
  };

  return (
    <div className={`fixed z-50 p-4 animate-in fade-in slide-in-from-top-4 duration-300 ${getPositionClass()}`}>
      {renderStepContent()}
    </div>
  );
}
