"use client";
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

export function PRStatusBadge({ url, status, ciStatus, ciSummary }: PRStatusBadgeProps) {
  const showCI = status === "IN_PROGRESS" && ciStatus;

  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center cursor-pointer gap-0"
      onClick={(e) => e.stopPropagation()}
    >
      {/* PR status pill */}
      <Badge
        variant="secondary"
        className={`gap-1 h-5 ${showCI ? "rounded-r-none border-r-0" : ""} ${
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

      {/* CI status pill — adjacent, connected via shared border */}
      {showCI && (
        <span
          title={ciSummary}
          className={`inline-flex items-center gap-1 h-5 px-1.5 text-[10px] font-medium rounded-r-md border ${
            ciStatus === "success"
              ? "bg-emerald-950 border-emerald-700/50 text-emerald-300"
              : ciStatus === "failure"
                ? "bg-red-950 border-red-700/50 text-red-300"
                : "bg-neutral-800 border-neutral-600/50 text-neutral-400"
          }`}
        >
          {ciStatus === "pending" && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
          {ciStatus === "success" && <CheckCircle2 className="w-2.5 h-2.5" />}
          {ciStatus === "failure" && <XCircle className="w-2.5 h-2.5" />}
          {ciStatus === "pending" ? "CI" : ciStatus === "success" ? "CI" : "CI"}
        </span>
      )}
    </a>
  );
}
