"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useWorkspace } from "@/hooks/useWorkspace";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Circle,
  CheckCircle,
  Loader2,
  AlertCircle,
  XCircle,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { FeatureStatus } from "@prisma/client";

interface Feature {
  id: string;
  title: string;
  status: FeatureStatus;
  brief?: string | null;
}

interface FeatureSearchProps {
  currentFeatureId?: string;
  trigger?: "button" | "auto";
}

const getStatusIconAndColor = (status: FeatureStatus | undefined) => {
  if (!status) return { icon: Circle, color: "text-gray-400" };

  const statusStr = String(status);
  if (statusStr === "COMPLETED") {
    return { icon: CheckCircle, color: "text-green-500" };
  }
  if (statusStr === "IN_PROGRESS") {
    return { icon: Loader2, color: "text-blue-500" };
  }
  if (statusStr === "BLOCKED") {
    return { icon: AlertCircle, color: "text-red-500" };
  }
  if (statusStr === "CANCELLED") {
    return { icon: XCircle, color: "text-gray-500" };
  }
  if (statusStr === "NOT_STARTED" || statusStr === "PLANNED" || statusStr === "BACKLOG") {
    return { icon: Circle, color: "text-gray-400" };
  }

  return { icon: Circle, color: "text-gray-400" };
};

export function FeatureSearch({ currentFeatureId, trigger = "button" }: FeatureSearchProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [features, setFeatures] = useState<Feature[]>([]);
  const [filteredFeatures, setFilteredFeatures] = useState<Feature[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { workspace } = useWorkspace();
  const router = useRouter();

  useEffect(() => {
    const fetchFeatures = async () => {
      if (!workspace?.slug || !open) return;

      setLoading(true);
      setError(null);
      try {
        const response = await fetch(`/api/workspaces/${workspace.slug}/features`);
        
        if (!response.ok) {
          throw new Error("Failed to fetch features");
        }

        const result = await response.json();
        const featuresData = result.data || [];
        setFeatures(featuresData);
        setFilteredFeatures(featuresData);
      } catch (err) {
        console.error("Error fetching features:", err);
        setError(err instanceof Error ? err.message : "Failed to load features");
        setFeatures([]);
        setFilteredFeatures([]);
      } finally {
        setLoading(false);
      }
    };

    if (open) {
      fetchFeatures();
    }
  }, [workspace?.slug, open]);

  useEffect(() => {
    if (!query || query.length < 2) {
      setFilteredFeatures(features);
      return;
    }

    const timeoutId = setTimeout(() => {
      const searchLower = query.toLowerCase();
      const filtered = features.filter((feature) =>
        feature.title.toLowerCase().includes(searchLower)
      );
      setFilteredFeatures(filtered);
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [query, features]);

  const handleSelect = useCallback(
    (featureId: string) => {
      setOpen(false);
      setQuery("");
      if (workspace?.slug) {
        router.push(`/w/${workspace.slug}/roadmap/${featureId}`);
      }
    },
    [router, workspace?.slug]
  );

  const handleOpenChange = useCallback((open: boolean) => {
    setOpen(open);
    if (!open) {
      setQuery("");
      setError(null);
    }
  }, []);

  const renderFeatureItem = (feature: Feature) => {
    const { icon: StatusIcon, color } = getStatusIconAndColor(feature.status);
    const isCurrentFeature = currentFeatureId === feature.id;

    return (
      <CommandItem
        key={feature.id}
        value={`${feature.id}-${feature.title}`}
        onSelect={() => handleSelect(feature.id)}
        className="flex items-start gap-3 px-3 py-2 cursor-pointer"
        disabled={isCurrentFeature}
      >
        <StatusIcon className={`h-4 w-4 mt-0.5 shrink-0 ${color}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium truncate">{feature.title}</span>
            {isCurrentFeature && (
              <span className="text-xs text-muted-foreground">(current)</span>
            )}
          </div>
          {feature.brief && (
            <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
              {feature.brief}
            </p>
          )}
        </div>
      </CommandItem>
    );
  };

  if (!workspace) return null;

  const showEmpty = query.length >= 2 && !loading && filteredFeatures.length === 0;
  const showResults = !loading && filteredFeatures.length > 0;

  return (
    <>
      {trigger === "button" && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          className="gap-2"
        >
          <Search className="h-4 w-4" />
          Search Features
        </Button>
      )}

      <CommandDialog open={open} onOpenChange={handleOpenChange}>
        <CommandInput
          placeholder="Search features by title..."
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          {loading && (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {error && (
            <div className="py-6 text-center text-sm text-red-600">
              {error}
            </div>
          )}

          {showEmpty && (
            <CommandEmpty>
              No features found matching &quot;{query}&quot;
            </CommandEmpty>
          )}

          {showResults && (
            <CommandGroup heading="Features">
              {filteredFeatures.map(renderFeatureItem)}
            </CommandGroup>
          )}

          {query.length < 2 && !loading && !error && (
            <div className="py-6 text-center text-sm text-muted-foreground">
              Type at least 2 characters to search
            </div>
          )}
        </CommandList>
      </CommandDialog>
    </>
  );
}