"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { RefreshCw, Sprout, Box, ChevronDown, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CreateFeatureModal } from "./CreateFeatureModal";
import { formatRelativeOrDate } from "@/lib/date-utils";

interface Feature {
  id: string;
  name: string;
  documentation?: string;
}

interface LearnSidebarProps {
  workspaceSlug: string;
  onFeatureClick?: (featureId: string, featureName: string) => void;
}

export function LearnSidebar({ workspaceSlug, onFeatureClick }: LearnSidebarProps) {
  const [features, setFeatures] = useState<Feature[]>([]);
  const [isFeaturesLoading, setIsFeaturesLoading] = useState(true);
  const [isSeeding, setIsSeeding] = useState(false);
  const [isFeaturesCollapsed, setIsFeaturesCollapsed] = useState(false);
  const [lastProcessed, setLastProcessed] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  useEffect(() => {
    const fetchFeatures = async () => {
      setIsFeaturesLoading(true);
      try {
        const url = `/api/learnings/features?workspace=${encodeURIComponent(workspaceSlug)}`;
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(`Failed to fetch features: ${response.status}`);
        }

        const data = await response.json();
        setFeatures(data.features || []);
        setLastProcessed(data.lastProcessedTimestamp || null);
        setIsProcessing(data.processing || false);
      } catch (error) {
        console.error("Error fetching features:", error);
      } finally {
        setIsFeaturesLoading(false);
      }
    };

    fetchFeatures();
  }, [workspaceSlug]);

  const handleFeatureClickInternal = (featureId: string, featureName: string) => {
    if (onFeatureClick) {
      onFeatureClick(featureId, featureName);
    }
  };

  const handleSeedKnowledge = async () => {
    if (isSeeding) return;

    setIsSeeding(true);

    try {
      const response = await fetch(`/api/learnings?workspace=${encodeURIComponent(workspaceSlug)}`, {
        method: "POST",
      });

      if (!response.ok) {
        console.error(`Failed to process repository: ${response.status}`);
      } else {
        // Re-fetch features to get updated last_processed_timestamp
        const featuresResponse = await fetch(`/api/learnings/features?workspace=${encodeURIComponent(workspaceSlug)}`);
        if (featuresResponse.ok) {
          const data = await featuresResponse.json();
          setFeatures(data.features || []);
          setLastProcessed(data.lastProcessedTimestamp || null);
          setIsProcessing(data.processing || false);
        }
      }
    } catch (error) {
      console.error("Error processing repository:", error);
    } finally {
      setIsSeeding(false);
    }
  };

  const handleFeatureCreated = async () => {
    // Re-fetch features to show the newly created one
    try {
      const url = `/api/learnings/features?workspace=${encodeURIComponent(workspaceSlug)}`;
      const response = await fetch(url);

      if (response.ok) {
        const data = await response.json();
        setFeatures(data.features || []);
      }
    } catch (error) {
      console.error("Error fetching features after creation:", error);
    }
  };

  return (
    <div className="w-80 bg-background border-l border-border flex flex-col fixed top-0 right-0 h-full">
      <div className="p-2"></div>

      <div className="flex-1 overflow-y-auto p-4 space-y-6">
        {/* Features Section */}
        {!isFeaturesLoading && features && features.length > 0 && (
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
            <button
              onClick={() => setIsFeaturesCollapsed(!isFeaturesCollapsed)}
              className="flex flex-col items-start gap-2 mb-3 w-full hover:opacity-70 transition-opacity"
            >
              <div className="flex items-center gap-2 w-full">
                <Box className="w-4 h-4 text-muted-foreground" />
                <h3 className="font-medium text-muted-foreground">Concepts</h3>
                <span className="text-xs text-muted-foreground/60">({features.length})</span>
                <ChevronDown
                  className={`w-4 h-4 text-muted-foreground ml-auto transition-transform ${isFeaturesCollapsed ? "-rotate-90" : ""}`}
                />
              </div>
              <p className="text-xs text-muted-foreground/70">Browse features from your codebase</p>
            </button>
            <AnimatePresence>
              {!isFeaturesCollapsed && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="space-y-2 overflow-hidden"
                >
                  {features.map((feature, index) => (
                    <motion.button
                      key={index}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.2, delay: index * 0.05 }}
                      onClick={() => handleFeatureClickInternal(feature.id, feature.name)}
                      className="w-full text-left p-3 text-sm bg-muted/30 hover:bg-muted/50 rounded-lg transition-colors cursor-pointer group"
                    >
                      <div className="text-muted-foreground group-hover:text-foreground transition-colors">
                        {feature.name}
                      </div>
                    </motion.button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        )}

        {/* Empty State */}
        {(!features || features.length === 0) && !isFeaturesLoading && (
          <div className="text-center py-12">
            <div className="text-muted-foreground text-sm">
              No features available yet.
              <br />
              Process your repository to discover features!
            </div>
          </div>
        )}
      </div>

      {/* Process Repository Section */}
      <div className="p-4 border-t border-border bg-background">
        <div className="flex items-center gap-2 mb-2">
          <Sprout className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-medium text-muted-foreground">Process Repository</h3>
        </div>
        <div className="mb-3">
          <p className="text-xs text-muted-foreground">
            {lastProcessed ? `Last processed: ${formatRelativeOrDate(lastProcessed)}` : "Never processed"}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" onClick={handleSeedKnowledge} disabled={isSeeding || isProcessing} className="flex-1">
            {isSeeding || isProcessing ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin mr-2" />
                Processing...
              </>
            ) : (
              "Process"
            )}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={() => setIsCreateModalOpen(true)}
            disabled={isSeeding || isProcessing}
            className="px-3"
          >
            <Plus className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <CreateFeatureModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
        workspaceSlug={workspaceSlug}
        onFeatureCreated={handleFeatureCreated}
      />
    </div>
  );
}
