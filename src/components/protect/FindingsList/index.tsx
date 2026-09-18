"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SafeMarkdown } from "@/components/run-report/SafeMarkdown";
import { toast } from "sonner";
import { Loader2, MessageSquare } from "lucide-react";
import type { ProtectFinding, ProtectFindingVerification } from "@/types/protect";

interface FindingsListProps {
  slug: string;
  findings: ProtectFinding[];
  canWrite: boolean;
}

const SEVERITY_CLASS: Record<ProtectFinding["severity"], string> = {
  critical: "bg-red-100 text-red-800 border-red-200",
  high: "bg-orange-100 text-orange-800 border-orange-200",
  medium: "bg-amber-100 text-amber-800 border-amber-200",
  low: "bg-slate-100 text-slate-700 border-slate-200",
};

export function FindingsList({ slug, findings, canWrite }: FindingsListProps) {
  if (findings.length === 0) {
    return (
      <Card data-testid="protect-ready-empty">
        <CardContent className="py-10 text-sm text-muted-foreground">
          Review found nothing.
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-3" data-testid="protect-findings-list">
      {findings.map((finding) => (
        <FindingCard
          key={finding.ref_id}
          slug={slug}
          finding={finding}
          canWrite={canWrite}
        />
      ))}
    </div>
  );
}

function FindingCard({
  slug,
  finding,
  canWrite,
}: {
  slug: string;
  finding: ProtectFinding;
  canWrite: boolean;
}) {
  const [verification, setVerification] = useState<ProtectFindingVerification | "">(
    finding.verification ?? "",
  );
  const [saving, setSaving] = useState(false);
  const [launching, setLaunching] = useState(false);

  const handleVerification = async (value: ProtectFindingVerification) => {
    const previous = verification;
    setVerification(value);
    setSaving(true);
    try {
      const response = await fetch(
        `/api/workspaces/${slug}/protect/findings/${encodeURIComponent(finding.ref_id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ verification: value }),
        },
      );
      if (!response.ok) {
        throw new Error("Failed to update verification");
      }
    } catch (error) {
      setVerification(previous);
      toast.error("Could not update verification", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleJamie = async () => {
    setLaunching(true);
    try {
      const response = await fetch(
        `/api/workspaces/${slug}/protect/findings/${encodeURIComponent(finding.ref_id)}/chat`,
        { method: "POST" },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(typeof data.error === "string" ? data.error : "Failed to start chat");
      }
      const data = (await response.json()) as { path?: string };
      if (data.path) {
        window.open(data.path, "_blank", "noopener,noreferrer");
      }
    } catch (error) {
      toast.error("Could not open Jamie chat", {
        description: error instanceof Error ? error.message : "Please try again.",
      });
    } finally {
      setLaunching(false);
    }
  };

  return (
    <Card data-testid="protect-finding-card">
      <CardContent className="space-y-3 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h3 className="text-sm font-medium" data-testid="protect-finding-title">
              {finding.title}
            </h3>
            <p className="text-xs text-muted-foreground font-mono">
              {finding.file}
              {finding.line != null ? `:${finding.line}` : ""}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge
              variant="outline"
              className={`text-xs ${SEVERITY_CLASS[finding.severity]}`}
              data-testid="protect-finding-severity"
            >
              {finding.severity}
            </Badge>
            <Badge variant="outline" className="text-xs" data-testid="protect-finding-category">
              {finding.category}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {finding.status}
            </Badge>
          </div>
        </div>

        {finding.area && (
          <p className="text-xs text-muted-foreground">Area: {finding.area}</p>
        )}

        {finding.description && (
          <div className="text-sm" data-testid="protect-finding-description">
            <SafeMarkdown text={finding.description} />
          </div>
        )}

        {finding.evidence && (
          <div className="text-xs text-muted-foreground" data-testid="protect-finding-evidence">
            <p className="mb-1 font-medium text-foreground">Evidence</p>
            <SafeMarkdown text={finding.evidence} />
          </div>
        )}

        {finding.recommendation && (
          <div className="text-sm" data-testid="protect-finding-recommendation">
            <p className="mb-1 text-xs font-medium">Recommendation</p>
            <SafeMarkdown text={finding.recommendation} />
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
          <Select
            value={verification || undefined}
            onValueChange={(value) => handleVerification(value as ProtectFindingVerification)}
            disabled={!canWrite || saving}
          >
            <SelectTrigger className="h-8 w-40 text-xs" data-testid="protect-verification-select">
              <SelectValue placeholder="Verification" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="reported">Reported</SelectItem>
              <SelectItem value="confirmed">Confirmed</SelectItem>
            </SelectContent>
          </Select>

          {canWrite && (
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs"
              onClick={handleJamie}
              disabled={launching}
              data-testid="protect-jamie-button"
            >
              {launching ? (
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
              ) : (
                <MessageSquare className="mr-1.5 h-3.5 w-3.5" />
              )}
              Ask Jamie
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
