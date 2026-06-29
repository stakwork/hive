"use client";

import React from "react";
import type { LingoNode } from "@/app/api/mock/lingo/nodes";

interface LingoCardProps {
  node: LingoNode;
  onClick: () => void;
}

export function LingoCard({ node, onClick }: LingoCardProps) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl border bg-card p-4 shadow-sm hover:border-primary/50 hover:shadow-md transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid={`lingo-card-${node.ref_id}`}
    >
      <h3 className="font-semibold text-base text-foreground mb-1 truncate">
        {node.name}
      </h3>
      {node.lingo_type && (
        <span
          className="mt-1 inline-block rounded px-1.5 py-0.5 text-xs bg-muted text-muted-foreground font-mono"
          data-testid="lingo-type-badge"
        >
          {node.lingo_type}
        </span>
      )}
      {node.definition && (
        <p className="text-sm text-muted-foreground line-clamp-2">
          {node.definition}
        </p>
      )}
    </button>
  );
}

export function LingoCardSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm animate-pulse" data-testid="lingo-card-skeleton">
      <div className="h-4 w-2/3 bg-primary/10 rounded mb-2" />
      <div className="h-3 w-full bg-primary/10 rounded mb-1" />
      <div className="h-3 w-4/5 bg-primary/10 rounded" />
    </div>
  );
}
