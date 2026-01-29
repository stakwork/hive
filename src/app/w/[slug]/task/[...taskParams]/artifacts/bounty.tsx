"use client";

import { Button } from "@/components/ui/button";
import { Artifact, BountyContent } from "@/lib/chat";
import { Trophy, ExternalLink, Github, Loader2, Coins, Clock, Shield, Layers } from "lucide-react";

function buildPrefillUrl(content: BountyContent): string {
  const prefillData = {
    title: content.bountyTitle,
    description: content.bountyDescription,
    estimatedHours: content.estimatedHours,
    repositoryUrl: content.repoUrl,
    source: "hive" as const,
    hiveTaskId: content.sourceTaskId,
    bountyCode: content.bountyCode,
    priceUsd: content.priceUsd,
    priceSats: content.priceSats,
    dueDate: content.dueDate,
    staking: content.staking,
    sourceTaskId: content.sourceTaskId,
    sourceWorkspaceId: content.sourceWorkspaceId,
    sourceWorkspaceSlug: content.sourceWorkspaceSlug,
    sourceUserId: content.sourceUserId,
    targetWorkspaceId: content.targetWorkspaceId,
  };

  const encoded = btoa(JSON.stringify(prefillData));
  const sphinxUrl = process.env.NEXT_PUBLIC_SPHINX_TRIBES_URL || "https://bounties.sphinx.chat";
  return `${sphinxUrl}/bounties?action=create&prefill=${encoded}`;
}

export function BountyArtifact({ artifact }: { artifact: Artifact }) {
  const content = artifact.content as BountyContent;
  const isPending = content.status === "PENDING";

  const handleCompleteBounty = () => {
    window.open(buildPrefillUrl(content), "_blank");
  };

  return (
    <div className="rounded-xl overflow-hidden border border-border/40 max-w-md">
      {/* Header strip */}
      <div
        className={`
          flex items-center px-4 py-2
          ${isPending ? "bg-amber-500/10" : "bg-emerald-500/8"}
        `}
      >
        <div className="flex items-center gap-2">
          {isPending ? (
            <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin" />
          ) : (
            <Trophy className="w-3.5 h-3.5 text-emerald-400" />
          )}
          <span
            className={`text-[11px] font-bold uppercase tracking-wider ${isPending ? "text-amber-500" : "text-emerald-400"}`}
          >
            {isPending ? "Generating workspace" : "Ready"}
          </span>
        </div>
      </div>

      {/* Body */}
      <div className="bg-card px-4 py-3">
        {isPending && (
          <>
            <div className="text-sm font-medium text-foreground truncate">{content.bountyTitle}</div>
            <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground/60">
              {content.priceSats && (
                <span className="flex items-center gap-1">
                  <Coins className="w-3 h-3" />
                  {new Intl.NumberFormat().format(content.priceSats)} sats
                </span>
              )}
              {content.estimatedHours && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {content.estimatedHours}h est
                </span>
              )}
              {content.staking && (
                <span className="flex items-center gap-1">
                  <Shield className="w-3 h-3" />
                  Staking
                </span>
              )}
            </div>
          </>
        )}

        {!isPending && (
          <>
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium text-foreground truncate">{content.bountyTitle}</div>
              <Button
                size="sm"
                className="h-7 gap-1.5 text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white flex-shrink-0"
                onClick={handleCompleteBounty}
              >
                Create
                <ExternalLink className="w-3 h-3" />
              </Button>
            </div>
            <div className="mt-2 pt-2 border-t border-border/30 flex items-center gap-3 text-xs text-muted-foreground">
              {content.workspaceSlug && (
                <a
                  href={`/w/${content.workspaceSlug}`}
                  className="flex items-center gap-1 hover:text-foreground transition-colors"
                >
                  <Layers className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate">{content.workspaceSlug}</span>
                </a>
              )}
              {content.repoUrl && (
                <a
                  href={content.repoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 hover:text-foreground transition-colors"
                >
                  <Github className="w-3 h-3 flex-shrink-0" />
                  <span className="truncate">{content.repoUrl.replace("https://github.com/", "")}</span>
                </a>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
