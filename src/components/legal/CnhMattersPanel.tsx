"use client";

import React, { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { useWorkspace } from "@/hooks/useWorkspace";
import { MatterDetailModal } from "@/components/legal/MatterDetailModal";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Matter {
  matterId: string;
  path: string;
}

interface ClientGroup {
  clientCode: string;
  matters: Matter[];
}

interface MattersResponse {
  groups: ClientGroup[];
  total: number;
}

// ─── Skeleton ─────────────────────────────────────────────────────────────────

function SidebarSkeleton() {
  return (
    <div className="space-y-2 p-2">
      {Array.from({ length: 8 }).map((_, i) => (
        <Skeleton key={i} className="h-9 w-full rounded-md" />
      ))}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function CnhMattersPanel() {
  const { slug, isSuperAdmin } = useWorkspace();
  const [groups, setGroups] = useState<ClientGroup[]>([]);
  const [selectedClientCode, setSelectedClientCode] = useState<string | null>(
    null,
  );
  const [selectedMatter, setSelectedMatter] = useState<Matter | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!slug) return;

    let cancelled = false;
    setIsLoading(true);
    setError(null);

    (async () => {
      try {
        const res = await fetch(
          `/api/workspaces/${slug}/legal/benchmarks/cnh/matters`,
        );
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            body?.error ?? `Request failed with status ${res.status}`,
          );
        }
        const data: MattersResponse = await res.json();
        if (!cancelled) {
          setGroups(data.groups);
          if (data.groups.length > 0) {
            setSelectedClientCode(data.groups[0].clientCode);
          }
        }
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "Failed to load matters",
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [slug]);

  const selectedGroup = groups.find(
    (g) => g.clientCode === selectedClientCode,
  );

  return (
    <div className="flex h-full">
      {/* ── Left sidebar: Client Groups ── */}
      <div className="w-60 shrink-0 border-r flex flex-col">
        <div className="px-3 pt-3 pb-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Client Groups
          </p>
        </div>
        <ScrollArea className="flex-1">
          {isLoading ? (
            <SidebarSkeleton />
          ) : error ? (
            <p className="p-3 text-sm text-destructive">{error}</p>
          ) : (
            <div className="space-y-0.5 p-2">
              {groups.map((group) => (
                <button
                  key={group.clientCode}
                  onClick={() => setSelectedClientCode(group.clientCode)}
                  className={`w-full flex items-center justify-between px-2 py-2 rounded-md text-sm transition-colors ${
                    selectedClientCode === group.clientCode
                      ? "bg-accent text-accent-foreground font-medium"
                      : "hover:bg-accent/50 text-foreground"
                  }`}
                >
                  <span>{group.clientCode}</span>
                  <Badge variant="secondary" className="text-xs">
                    {group.matters.length}
                  </Badge>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>
      </div>

      {/* ── Right pane: Matters for selected group ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {selectedGroup ? (
          <>
            <div className="px-4 pt-3 pb-2 border-b shrink-0">
              <p className="text-sm font-semibold">
                Client {selectedGroup.clientCode}
                <span className="ml-2 text-muted-foreground font-normal">
                  ({selectedGroup.matters.length} matters)
                </span>
              </p>
            </div>
            <ScrollArea className="flex-1">
              <div className="p-4 space-y-2">
                {selectedGroup.matters.map((matter) => (
                  <div
                    key={matter.matterId}
                    className="flex items-center justify-between gap-3 rounded-md border p-3"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-sm font-mono font-medium shrink-0">
                        {matter.matterId}
                      </span>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedMatter(matter)}
                    >
                      View Details
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </>
        ) : !isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <p className="text-sm text-muted-foreground">
              Select a client group to view matters
            </p>
          </div>
        ) : null}
      </div>

      {/* ── Matter Detail Modal ── */}
      {selectedMatter && slug && (
        <MatterDetailModal
          open={!!selectedMatter}
          onOpenChange={(open) => {
            if (!open) setSelectedMatter(null);
          }}
          matterId={selectedMatter.matterId}
          slug={slug}
          isSuperAdmin={isSuperAdmin}
        />
      )}
    </div>
  );
}
