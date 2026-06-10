import React from "react";
import { Badge } from "@/components/ui/badge";
import { GitPullRequest, GitMerge, GitPullRequestClosed, ExternalLink, Loader2, CheckCircle2, XCircle } from "lucide-react";

interface PRStatusBadgeProps {
  url: string;
  status: "IN_PROGRESS" | "DONE" | "CANCELLED";
  ciStatus?: "pending" | "success" | "failure";
  ciSummary?: string;
}

export function PRStatusBadge({ url, status, ciStatus, ciSummary }: PRStatusBadgeProps) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex cursor-pointer"
      onClick={(e) => e.stopPropagation()}
    >
      <Badge
        variant="secondary"
        className={`gap-1 h-5 ${
          status === "IN_PROGRESS"
            ? "border-[#238636]/30"
            : status === "CANCELLED"
              ? "border-[#6e7681]/30"
              : status === "DONE"
                ? "border-[#8957e5]/30"
                : "bg-gray-100 text-gray-800 border-gray-200"
        }`}
        style={
          status === "IN_PROGRESS"
            ? { backgroundColor: "#238636", color: "white" }
            : status === "CANCELLED"
              ? { backgroundColor: "#6e7681", color: "white" }
              : status === "DONE"
                ? { backgroundColor: "#8957e5", color: "white" }
                : undefined
        }
      >
        {status === "DONE" ? (
          <GitMerge className="w-3 h-3" />
        ) : status === "CANCELLED" ? (
          <GitPullRequestClosed className="w-3 h-3" />
        ) : (
          <GitPullRequest className="w-3 h-3" />
        )}
        {status === "IN_PROGRESS"
          ? "Open"
          : status === "CANCELLED"
            ? "Closed"
            : "Merged"}
        {status === "IN_PROGRESS" && ciStatus && (
          <>
            <span className="w-px h-3 bg-white opacity-25 mx-0.5" />
            {ciStatus === "pending" && (
              <span title={ciSummary}><Loader2 className="w-3 h-3 animate-spin opacity-60" /></span>
            )}
            {ciStatus === "success" && (
              <span title={ciSummary}><CheckCircle2 className="w-3 h-3 text-emerald-300" /></span>
            )}
            {ciStatus === "failure" && (
              <span title={ciSummary}><XCircle className="w-3 h-3 text-red-300" /></span>
            )}
          </>
        )}
        <ExternalLink className="w-3 h-3 ml-0.5" />
      </Badge>
    </a>
  );
}
