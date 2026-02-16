"use client";

import { Badge } from "@/components/ui/badge";
import { X } from "lucide-react";
import { useWorkspace } from "@/hooks/useWorkspace";

interface WorkspacePillsProps {
  slugs: string[];
  onRemove: (slug: string) => void;
}

export function WorkspacePills({ slugs, onRemove }: WorkspacePillsProps) {
  const { workspaces } = useWorkspace();

  if (slugs.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5 w-full justify-center">
      {slugs.map((slug) => {
        const ws = workspaces.find((w) => w.slug === slug);
        const label = ws?.name ?? slug;
        return (
          <Badge
            key={slug}
            variant="secondary"
            className="gap-1 pr-1 text-xs font-normal"
          >
            {label}
            <button
              type="button"
              onClick={() => onRemove(slug)}
              className="ml-0.5 rounded-full p-0.5 hover:bg-muted-foreground/20 transition-colors"
            >
              <X className="w-3 h-3" />
            </button>
          </Badge>
        );
      })}
    </div>
  );
}
