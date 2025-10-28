"use client";

import { Github, Server, Loader2, ExternalLink, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export default function WidgetTestPage() {
  return (
    <div className="min-h-screen bg-background p-8">
      <div className="max-w-6xl mx-auto space-y-12">
        <div>
          <h1 className="text-3xl font-bold mb-2">Widget Test Page</h1>
          <p className="text-muted-foreground">
            Testing all states for GitHub Status and Pool Status widgets
          </p>
        </div>

        {/* GitHub Status Widget Tests */}
        <section className="space-y-6">
          <h2 className="text-2xl font-semibold">GitHub Status Widget</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {/* Loading State */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground">Loading</h3>
              <div className="flex items-center justify-center w-10 h-10 rounded-lg border border-border bg-card">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            </div>

            {/* Not Connected - Link GitHub Button */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground">Not Connected</h3>
              <Button
                size="sm"
                variant="outline"
                className="h-10 px-3 gap-2 bg-card border-border hover:bg-accent"
              >
                <Github className="w-4 h-4" />
                Link GitHub
                <ExternalLink className="w-3 h-3" />
              </Button>
            </div>

            {/* Connected - SYNCED (Green) */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground">
                Connected - Synced (Green)
              </h3>
              <TooltipProvider>
                <Tooltip delayDuration={200}>
                  <TooltipTrigger asChild>
                    <div className="relative flex items-center justify-center w-10 h-10 rounded-lg border border-border bg-card hover:bg-accent transition-colors cursor-default">
                      <Github className="w-5 h-5 text-foreground" />
                      <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-green-500" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs">
                    <div className="space-y-1.5 text-xs">
                      <div className="font-medium text-green-600">SYNCED</div>
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>2 minutes ago</span>
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            {/* Connected - PENDING (Orange) */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground">
                Connected - Pending (Orange)
              </h3>
              <TooltipProvider>
                <Tooltip delayDuration={200}>
                  <TooltipTrigger asChild>
                    <div className="relative flex items-center justify-center w-10 h-10 rounded-lg border border-border bg-card hover:bg-accent transition-colors cursor-default">
                      <Github className="w-5 h-5 text-foreground" />
                      <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-orange-500" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs">
                    <div className="space-y-1.5 text-xs">
                      <div className="font-medium text-orange-600">PENDING</div>
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>5 minutes ago</span>
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            {/* Connected - FAILED (Red) */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground">
                Connected - Failed (Red)
              </h3>
              <TooltipProvider>
                <Tooltip delayDuration={200}>
                  <TooltipTrigger asChild>
                    <div className="relative flex items-center justify-center w-10 h-10 rounded-lg border border-border bg-card hover:bg-accent transition-colors cursor-default">
                      <Github className="w-5 h-5 text-foreground" />
                      <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-red-500" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs">
                    <div className="space-y-1.5 text-xs">
                      <div className="font-medium text-red-600">FAILED</div>
                      <div className="flex items-center gap-1.5 text-muted-foreground">
                        <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span>10 minutes ago</span>
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        </section>

        {/* Pool Status Widget Tests */}
        <section className="space-y-6">
          <h2 className="text-2xl font-semibold">Pool Status Widget</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {/* Loading State */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground">Loading</h3>
              <div className="flex items-center justify-center w-10 h-10 rounded-lg border border-border bg-card">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
              </div>
            </div>

            {/* Services Being Set Up */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground">
                Services Setting Up
              </h3>
              <div className="flex items-center gap-3 px-4 py-2 rounded-lg border border-border bg-card">
                <div className="relative flex items-center justify-center w-8 h-8 rounded-full bg-orange-100 text-orange-700">
                  <Server className="w-4 h-4" />
                  <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-orange-500 rounded-full animate-pulse" />
                </div>
                <div className="flex flex-col">
                  <span className="text-sm font-medium">Setting up services</span>
                  <span className="text-xs text-muted-foreground">In progress...</span>
                </div>
              </div>
            </div>

            {/* Ready to Launch Pods */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground">
                Ready to Launch
              </h3>
              <Button size="sm" className="h-10 gap-2">
                <Zap className="w-4 h-4" />
                Launch Pods
              </Button>
            </div>

            {/* Active - Low Usage */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground">
                Active - Low Usage
              </h3>
              <TooltipProvider>
                <Tooltip delayDuration={200}>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-2 px-3 h-10 rounded-lg border border-border bg-card/95 backdrop-blur-sm hover:bg-accent/95 transition-colors cursor-default">
                      <Server className="w-4 h-4 text-foreground" />
                      <div className="flex items-center gap-1.5 text-xs font-medium">
                        <span className="text-green-600">3</span>
                        <span className="text-muted-foreground">/</span>
                        <span className="text-muted-foreground">10</span>
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs">
                    <div className="space-y-1 text-xs">
                      <div className="font-medium">Pool Status</div>
                      <div className="flex items-center gap-2">
                        <span className="text-green-600">3 in use</span>
                        <span className="text-muted-foreground">•</span>
                        <span className="text-muted-foreground">7 available</span>
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            {/* Active - High Usage */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground">
                Active - High Usage
              </h3>
              <TooltipProvider>
                <Tooltip delayDuration={200}>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-2 px-3 h-10 rounded-lg border border-border bg-card/95 backdrop-blur-sm hover:bg-accent/95 transition-colors cursor-default">
                      <Server className="w-4 h-4 text-foreground" />
                      <div className="flex items-center gap-1.5 text-xs font-medium">
                        <span className="text-green-600">8</span>
                        <span className="text-muted-foreground">/</span>
                        <span className="text-muted-foreground">10</span>
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs">
                    <div className="space-y-1 text-xs">
                      <div className="font-medium">Pool Status</div>
                      <div className="flex items-center gap-2">
                        <span className="text-green-600">8 in use</span>
                        <span className="text-muted-foreground">•</span>
                        <span className="text-muted-foreground">2 available</span>
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            {/* Active - Full Capacity */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground">
                Active - Full Capacity
              </h3>
              <TooltipProvider>
                <Tooltip delayDuration={200}>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-2 px-3 h-10 rounded-lg border border-border bg-card/95 backdrop-blur-sm hover:bg-accent/95 transition-colors cursor-default">
                      <Server className="w-4 h-4 text-foreground" />
                      <div className="flex items-center gap-1.5 text-xs font-medium">
                        <span className="text-green-600">10</span>
                        <span className="text-muted-foreground">/</span>
                        <span className="text-muted-foreground">10</span>
                      </div>
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs">
                    <div className="space-y-1 text-xs">
                      <div className="font-medium">Pool Status</div>
                      <div className="flex items-center gap-2">
                        <span className="text-green-600">10 in use</span>
                        <span className="text-muted-foreground">•</span>
                        <span className="text-muted-foreground">0 available</span>
                      </div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            {/* Active - With Pending Issues */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground">
                Active - With Pending
              </h3>
              <TooltipProvider>
                <Tooltip delayDuration={200}>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-2 px-3 h-10 rounded-lg border border-border bg-card/95 backdrop-blur-sm hover:bg-accent/95 transition-colors cursor-default">
                      <Server className="w-4 h-4 text-foreground" />
                      <div className="flex items-center gap-1.5 text-xs font-medium">
                        <span className="text-green-600">5</span>
                        <span className="text-muted-foreground">/</span>
                        <span className="text-muted-foreground">10</span>
                      </div>
                      <div className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs">
                    <div className="space-y-1 text-xs">
                      <div className="font-medium">Pool Status</div>
                      <div className="flex items-center gap-2">
                        <span className="text-green-600">5 in use</span>
                        <span className="text-muted-foreground">•</span>
                        <span className="text-muted-foreground">5 available</span>
                      </div>
                      <div className="text-orange-600">2 pending</div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            {/* Active - With Failed */}
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground">
                Active - With Failed
              </h3>
              <TooltipProvider>
                <Tooltip delayDuration={200}>
                  <TooltipTrigger asChild>
                    <div className="flex items-center gap-2 px-3 h-10 rounded-lg border border-border bg-card/95 backdrop-blur-sm hover:bg-accent/95 transition-colors cursor-default">
                      <Server className="w-4 h-4 text-foreground" />
                      <div className="flex items-center gap-1.5 text-xs font-medium">
                        <span className="text-green-600">6</span>
                        <span className="text-muted-foreground">/</span>
                        <span className="text-muted-foreground">10</span>
                      </div>
                      <div className="w-1.5 h-1.5 rounded-full bg-orange-500" />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent side="bottom" className="max-w-xs">
                    <div className="space-y-1 text-xs">
                      <div className="font-medium">Pool Status</div>
                      <div className="flex items-center gap-2">
                        <span className="text-green-600">6 in use</span>
                        <span className="text-muted-foreground">•</span>
                        <span className="text-muted-foreground">4 available</span>
                      </div>
                      <div className="text-red-600">1 failed</div>
                    </div>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          </div>
        </section>

        {/* Combined Widget Display (as they appear in Dashboard) */}
        <section className="space-y-6">
          <h2 className="text-2xl font-semibold">Combined Display (Overlaid)</h2>

          <div className="space-y-4">
            <h3 className="text-sm font-medium text-muted-foreground">
              As they appear overlaid on the graph in Dashboard
            </h3>

            <div className="dark border rounded-lg relative bg-card h-96">
              {/* Widgets overlaid in top-right corner */}
              <div className="absolute top-4 right-4 z-10 flex items-center gap-2">
                {/* GitHub - Synced */}
                <TooltipProvider>
                  <Tooltip delayDuration={200}>
                    <TooltipTrigger asChild>
                      <div className="relative flex items-center justify-center w-10 h-10 rounded-lg border border-border bg-card/95 backdrop-blur-sm hover:bg-accent/95 transition-colors cursor-default">
                        <Github className="w-5 h-5 text-white" />
                        <div className="absolute top-2 right-2 w-2 h-2 rounded-full bg-green-500" />
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs">
                      <div className="space-y-1.5 text-xs">
                        <div className="font-medium text-green-600">SYNCED</div>
                        <div className="flex items-center gap-1.5 text-muted-foreground">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span>2 minutes ago</span>
                        </div>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                {/* Pool - Active */}
                <TooltipProvider>
                  <Tooltip delayDuration={200}>
                    <TooltipTrigger asChild>
                      <div className="flex items-center gap-2 px-3 h-10 rounded-lg border border-border bg-card/95 backdrop-blur-sm hover:bg-accent/95 transition-colors cursor-default">
                        <Server className="w-4 h-4 text-white" />
                        <div className="flex items-center gap-1.5 text-xs font-medium">
                          <span className="text-green-600">3</span>
                          <span className="text-muted-foreground">/</span>
                          <span className="text-muted-foreground">10</span>
                        </div>
                      </div>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs">
                      <div className="space-y-1 text-xs">
                        <div className="font-medium">Pool Status</div>
                        <div className="flex items-center gap-2">
                          <span className="text-green-600">3 in use</span>
                          <span className="text-muted-foreground">•</span>
                          <span className="text-muted-foreground">7 available</span>
                        </div>
                      </div>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>
              </div>

              {/* Graph Component Area */}
              <div className="h-full border rounded flex items-center justify-center text-gray-400">
                Graph Component Area (widgets overlay on top-right)
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
