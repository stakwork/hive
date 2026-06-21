"use client";

import React from "react";
import type { JargonNode } from "@/app/api/mock/lingo/nodes";

interface JargonCardProps {
  node: JargonNode;
  onClick: () => void;
}

export function JargonCard({ node, onClick }: JargonCardProps) {
  return (
    <button
      onClick={onClick}
      className="w-full text-left rounded-xl border bg-card p-4 shadow-sm hover:border-primary/50 hover:shadow-md transition-all cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      data-testid={`jargon-card-${node.ref_id}`}
    >
      <h3 className="font-semibold text-base text-foreground mb-1 truncate">
        {node.name}
      </h3>
      <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
        {node.jargon_context}
      </p>
      {node.jargon_candidates.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {node.jargon_candidates.map((candidate) => (
            <span
              key={candidate}
              className="inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium text-muted-foreground bg-muted"
            >
              {candidate}
            </span>
          ))}
        </div>
      )}
    </button>
  );
}

export function JargonCardSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm animate-pulse" data-testid="jargon-card-skeleton">
      <div className="h-4 w-2/3 bg-primary/10 rounded mb-2" />
      <div className="h-3 w-full bg-primary/10 rounded mb-1" />
      <div className="h-3 w-4/5 bg-primary/10 rounded mb-3" />
      <div className="flex gap-1.5">
        <div className="h-5 w-16 bg-primary/10 rounded-full" />
        <div className="h-5 w-20 bg-primary/10 rounded-full" />
      </div>
    </div>
  );
}
