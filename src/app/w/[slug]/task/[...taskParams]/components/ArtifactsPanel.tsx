"use client";

import { useMemo, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Artifact, ArtifactType } from "@/lib/chat";
import { CodeArtifactPanel, BrowserArtifactPanel, GraphArtifactPanel } from "../artifacts";

interface ArtifactsPanelProps {
  artifacts: Artifact[];
  onDebugMessage?: (message: string, debugArtifact?: Artifact) => Promise<void>;
}

export function ArtifactsPanel({ artifacts, onDebugMessage }: ArtifactsPanelProps) {
  const [activeTab, setActiveTab] = useState<ArtifactType | null>(null);

  // Separate artifacts by type
  const codeArtifacts = artifacts.filter((a) => a.type === "CODE");
  const browserArtifacts = artifacts.filter((a) => a.type === "BROWSER");
  const ideArtifacts = artifacts.filter((a) => a.type === "IDE");
  const graphArtifacts = artifacts.filter((a) => a.type === "GRAPH");

  const availableTabs: ArtifactType[] = useMemo(() => {
    const tabs: ArtifactType[] = [];
    if (codeArtifacts.length > 0) tabs.push("CODE");
    if (browserArtifacts.length > 0) tabs.push("BROWSER");
    if (ideArtifacts.length > 0) tabs.push("IDE");
    if (graphArtifacts.length > 0) tabs.push("GRAPH");
    return tabs;
  }, [codeArtifacts.length, browserArtifacts.length, ideArtifacts.length, graphArtifacts.length]);

  // Auto-select first tab when artifacts become available
  useEffect(() => {
    if (availableTabs.length > 0 && !activeTab) {
      setActiveTab(availableTabs[0]);
    }
  }, [availableTabs, activeTab]);

  if (availableTabs.length === 0) {
    return null;
  }

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 20 }}
      transition={{ duration: 0.3, ease: [0.4, 0.0, 0.2, 1] }}
      className="h-full flex-1 min-w-0 min-h-0 bg-background rounded-xl border shadow-sm overflow-hidden flex flex-col"
    >
      <Tabs
        value={activeTab as string}
        className="flex-1 flex flex-col min-h-0"
        onValueChange={(value) => {
          setActiveTab(value as ArtifactType);
        }}
      >
        <motion.div
          className="border-b bg-background/80 backdrop-blur"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
        >
          <TabsList className="w-full flex">
            {codeArtifacts.length > 0 && (
              <TabsTrigger className="cursor-pointer" value="CODE">
                Code / Files
              </TabsTrigger>
            )}
            {browserArtifacts.length > 0 && (
              <TabsTrigger className="cursor-pointer" value="BROWSER">
                Live Preview
              </TabsTrigger>
            )}
            {ideArtifacts.length > 0 && (
              <TabsTrigger className="cursor-pointer" value="IDE">
                IDE
              </TabsTrigger>
            )}
            {graphArtifacts.length > 0 && (
              <TabsTrigger className="cursor-pointer" value="GRAPH">
                Graph
              </TabsTrigger>
            )}
          </TabsList>
        </motion.div>

        <motion.div
          className="flex-1 overflow-hidden min-h-0"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
        >
          {codeArtifacts.length > 0 && (
            <TabsContent
              value="CODE"
              className="h-full mt-0"
              forceMount
              hidden={activeTab !== "CODE"}
            >
              <CodeArtifactPanel artifacts={codeArtifacts} />
            </TabsContent>
          )}
          {browserArtifacts.length > 0 && (
            <TabsContent
              value="BROWSER"
              className="h-full mt-0"
              forceMount
              hidden={activeTab !== "BROWSER"}
            >
              <BrowserArtifactPanel artifacts={browserArtifacts} onDebugMessage={onDebugMessage} />
            </TabsContent>
          )}
          {ideArtifacts.length > 0 && (
            <TabsContent
              value="IDE"
              className="h-full mt-0"
              forceMount
              hidden={activeTab !== "IDE"}
            >
              <BrowserArtifactPanel artifacts={ideArtifacts} ide={true} onDebugMessage={onDebugMessage} />
            </TabsContent>
          )}
          {graphArtifacts.length > 0 && (
            <TabsContent
              value="GRAPH"
              className="h-full mt-0"
              forceMount
              hidden={activeTab !== "GRAPH"}
            >
              <GraphArtifactPanel artifacts={graphArtifacts} />
            </TabsContent>
          )}
        </motion.div>
      </Tabs>
    </motion.div>
  );
}
