"use client";

import { useState, useEffect, useCallback } from "react";
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
import { Kbd } from "@/components/ui/kbd";
import { Circle, CheckCircle, Loader2, AlertCircle, XCircle } from "lucide-react";
import type { SearchResponse, SearchResult } from "@/types/search";
import type { TaskStatus, FeatureStatus, PhaseStatus } from "@prisma/client";

const ENTITY_CONFIG = {
  task: {
    label: "Task",
  },
  feature: {
    label: "Feature",
  },
  ticket: {
    label: "Ticket",
  },
  phase: {
    label: "Phase",
  },
};

// Status icon and color mapping
const getStatusIconAndColor = (status: TaskStatus | FeatureStatus | PhaseStatus | undefined) => {
  if (!status) return { icon: Circle, color: "text-gray-400" };

  const statusStr = String(status);
  if (statusStr === "DONE" || statusStr === "COMPLETED") {
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
  if (statusStr === "TODO" || statusStr === "BACKLOG" || statusStr === "NOT_STARTED" || statusStr === "PLANNED") {
    return { icon: Circle, color: "text-gray-400" };
  }

  return { icon: Circle, color: "text-gray-400" };
};

export function GlobalSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResponse["data"] | null>(null);
  const [loading, setLoading] = useState(false);
  const { workspace } = useWorkspace();
  const router = useRouter();

  // Keyboard shortcut handler
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((open) => !open);
      }
    };

    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  // Debounced search
  useEffect(() => {
    if (!query || query.length < 2) {
      setResults(null);
      return;
    }

    const timeoutId = setTimeout(async () => {
      if (!workspace?.slug) return;

      setLoading(true);
      try {
        const response = await fetch(`/api/workspaces/${workspace.slug}/search?q=${encodeURIComponent(query)}`);

        if (response.ok) {
          const data: SearchResponse = await response.json();
          setResults(data.data);
        } else {
          console.error("Search failed:", response.statusText);
          setResults(null);
        }
      } catch (error) {
        console.error("Search error:", error);
        setResults(null);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => clearTimeout(timeoutId);
  }, [query, workspace?.slug]);

  const handleSelect = useCallback(
    (url: string) => {
      setOpen(false);
      setQuery("");
      setResults(null);
      router.push(url);
    },
    [router],
  );

  const handleOpenChange = useCallback((open: boolean) => {
    setOpen(open);
    if (!open) {
      setQuery("");
      setResults(null);
    }
  }, []);

  const renderResultItem = (result: SearchResult) => {
    const config = ENTITY_CONFIG[result.type];
    const { icon: StatusIcon, color } = getStatusIconAndColor(result.metadata.status);

    return (
      <CommandItem
        key={`${result.type}-${result.id}`}
        value={`${result.type}-${result.id}-${result.title}`}
        onSelect={() => handleSelect(result.url)}
        className="flex items-start gap-3 px-3 py-2 cursor-pointer"
      >
        <StatusIcon className={`h-4 w-4 mt-0.5 shrink-0 ${color}`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">{config.label}</span>
            <span className="text-muted-foreground">›</span>
            <span className="font-medium truncate">{result.title}</span>
          </div>
          {result.metadata.featureTitle && (
            <p className="text-xs text-muted-foreground mt-0.5">in {result.metadata.featureTitle}</p>
          )}
        </div>
      </CommandItem>
    );
  };

  if (!workspace) return null;

  const hasResults = results && (results.tasks.length > 0 || results.features.length > 0 || results.phases.length > 0);

  const showEmpty = query.length >= 2 && !loading && !hasResults;

  const isMac = typeof window !== "undefined" && navigator.platform.toUpperCase().indexOf("MAC") >= 0;

  return (
    <CommandDialog open={open} onOpenChange={handleOpenChange}>
      <CommandInput placeholder="Search..." value={query} onValueChange={setQuery} />
      <CommandList>
        {loading && (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        )}

        {showEmpty && <CommandEmpty>No results found for "{query}"</CommandEmpty>}

        {!loading && hasResults && (
          <>
            {results.tasks.length > 0 && (
              <CommandGroup heading="Tasks">{results.tasks.map(renderResultItem)}</CommandGroup>
            )}

            {results.features.length > 0 && (
              <CommandGroup heading="Features">{results.features.map(renderResultItem)}</CommandGroup>
            )}

            {results.phases.length > 0 && (
              <CommandGroup heading="Phases">{results.phases.map(renderResultItem)}</CommandGroup>
            )}
          </>
        )}

        {query.length < 2 && !loading && (
          <div className="py-6 text-center text-sm text-muted-foreground">Type at least 2 characters to search</div>
        )}
      </CommandList>
    </CommandDialog>
  );
}
