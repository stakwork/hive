"use client";

import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Monitor, RefreshCw, ExternalLink, Bug } from "lucide-react";
import { Artifact, BrowserContent } from "@/lib/chat";

export function BrowserArtifactPanel({ artifacts }: { artifacts: Artifact[] }) {
  const [activeTab, setActiveTab] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const [debugMode, setDebugMode] = useState(false);

  const handleRefresh = () => {
    setRefreshKey((prev) => prev + 1);
  };

  const handleTabOut = (url: string) => {
    window.open(url, "_blank");
  };

  const handleDebugElement = () => {
    setDebugMode(!debugMode);
    // TODO: Implement debug mode activation
    console.log('Debug mode toggled:', !debugMode);
  };

  if (artifacts.length === 0) return null;

  return (
    <div className="h-full flex flex-col">
      {artifacts.length > 1 && (
        <div className="border-b bg-muted/20">
          <div className="flex overflow-x-auto">
            {artifacts.map((artifact, index) => (
              <button
                key={artifact.id}
                onClick={() => setActiveTab(index)}
                className={`px-3 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                  activeTab === index
                    ? "border-primary text-primary bg-background"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                Preview {index + 1}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex-1 overflow-hidden">
        {artifacts.map((artifact, index) => {
          const content = artifact.content as BrowserContent;
          return (
            <div
              key={artifact.id}
              className={`h-full flex flex-col ${activeTab === index ? "block" : "hidden"}`}
            >
              <div className="flex items-center justify-between px-4 py-2 bg-muted/50 border-b">
                <div className="flex items-center gap-2 min-w-0">
                  <Monitor className="w-4 h-4 flex-shrink-0" />
                  <span className="text-sm font-medium truncate">
                    {content.url}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleTabOut(content.url)}
                    className="h-8 w-8 p-0"
                    title="Open in new tab"
                  >
                    <ExternalLink className="w-4 h-4" />
                  </Button>
                  <Button
                    variant={debugMode ? "default" : "ghost"}
                    size="sm"
                    onClick={handleDebugElement}
                    className="h-8 w-8 p-0"
                    title="Debug Element"
                  >
                    <Bug className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRefresh}
                    className="h-8 w-8 p-0"
                    title="Refresh"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <div className="flex-1 overflow-hidden">
                <iframe
                  key={`${artifact.id}-${refreshKey}`}
                  src={content.url}
                  className="w-full h-full border-0"
                  title={`Live Preview ${index + 1}`}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
