import React from "react";
import { Badge } from "@/components/ui/badge";
import {
  GitPullRequest,
  GitMerge,
  GitPullRequestClosed,
  ExternalLink,
  Loader2,
  CheckCircle2,
  XCircle,
} from "lucide-react";

interface PRStatusBadgeProps {
  url: string;
  status: "IN_PROGRESS" | "DONE" | "CANCELLED";
  ciStatus?: "pending" | "success" | "failure";
  ciSummary?: string;
}

const ciTooltip = (ciStatus: "pending" | "success" | "failure", ciSummary?: string) => {
  if (ciSummary) return ciSummary;
  if (ciStatus === "success") return "All checks passed";
  if (ciStatus === "failure") return "Checks failed";
  return "Checks running";
};

export function PRStatusBadge({ url, status, ciStatus, ciSummary }: PRStatusBadgeProps) {
  const showCI = status === "IN_PROGRESS" && ciStatus;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1.5 cursor-pointer"
      onClick={(e) => e.stopPropagation()}
    >
      <Badge
        variant="secondary"
        className={`gap-1 h-5 ${
          status === "IN_PROGRESS"
            ? "border-[#238636]/30"
            : status === "CANCELLED"
              ? "border-[#6e7681]/30"
              : "border-[#8957e5]/30"
        }`}
        style={
          status === "IN_PROGRESS"
            ? { backgroundColor: "#238636", color: "white" }
            : status === "CANCELLED"
              ? { backgroundColor: "#6e7681", color: "white" }
              : { backgroundColor: "#8957e5", color: "white" }
        }
      >
        {status === "DONE" ? (
          <GitMerge className="w-3 h-3" />
        ) : status === "CANCELLED" ? (
          <GitPullRequestClosed className="w-3 h-3" />
        ) : (
          <GitPullRequest className="w-3 h-3" />
        )}
        {status === "IN_PROGRESS" ? "Open" : status === "CANCELLED" ? "Closed" : "Merged"}
        <ExternalLink className="w-3 h-3 ml-0.5 opacity-70" />
      </Badge>

      {showCI && (
        <span title={ciTooltip(ciStatus!, ciSummary)}>
          {ciStatus === "pending" && <Loader2 className="w-3.5 h-3.5 text-muted-foreground animate-spin" />}
          {ciStatus === "success" && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />}
          {ciStatus === "failure" && <XCircle className="w-3.5 h-3.5 text-red-400" />}
        </span>
      )}
    </a>
  );
}
