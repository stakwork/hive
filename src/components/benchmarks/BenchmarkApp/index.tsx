"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { StrutAppFrame, type StrutAppSource } from "@/components/strut-app-frame";
import { workspaceStrutViewPath } from "@/lib/utils/strut-links";

type Located = { status: "loading" } | { status: "ready"; source: StrutAppSource } | { status: "error"; error: string };

/**
 * A benchmark whose registry entry names a strut app (`Benchmark.app`),
 * rendered in the app frame from the workspace's own swarm: where the app is
 * comes from `…/benchmarks/:benchmarkSlug/app`. The page holds no
 * conversation, so a `ui/message` from the app is shown as unavailable; a
 * strut deep link opens in the workspace's strut view.
 */
export function BenchmarkApp({
  workspaceSlug,
  benchmarkSlug,
  title,
  toolInput,
  className,
}: {
  workspaceSlug: string;
  benchmarkSlug: string;
  title: string;
  /** What the app is opened with, e.g. a run's `{ runId }`. */
  toolInput?: Record<string, unknown>;
  className?: string;
}) {
  const [located, setLocated] = useState<Located>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    setLocated({ status: "loading" });
    fetch(`/api/workspaces/${encodeURIComponent(workspaceSlug)}/benchmarks/${encodeURIComponent(benchmarkSlug)}/app`, { cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as { githubLogin?: string; swarmId?: string; app?: { name: string; version?: string }; error?: string };
        if (!res.ok || !body.githubLogin || !body.swarmId || !body.app) throw new Error(body.error ?? "Could not find this benchmark's app");
        return { githubLogin: body.githubLogin, swarmId: body.swarmId, app: body.app.name, ...(body.app.version ? { version: body.app.version } : {}) };
      })
      .then((source) => !cancelled && setLocated({ status: "ready", source }))
      .catch((e: unknown) => !cancelled && setLocated({ status: "error", error: e instanceof Error ? e.message : "Could not find this benchmark's app" }));
    return () => {
      cancelled = true;
    };
  }, [workspaceSlug, benchmarkSlug]);

  const strutLinkHref = useCallback((deepLink: string) => workspaceStrutViewPath(workspaceSlug, deepLink), [workspaceSlug]);

  if (located.status === "loading") {
    return (
      <div className={cn("flex items-center justify-center text-muted-foreground", className)}>
        <Loader2 className="h-4 w-4 animate-spin" aria-label="Loading app" />
      </div>
    );
  }
  if (located.status === "error") {
    return <p className={cn("text-sm text-destructive", className)}>{located.error}</p>;
  }
  return (
    <div className={cn("overflow-hidden rounded-md border", className)}>
      <StrutAppFrame source={located.source} title={title} toolInput={toolInput} strutLinkHref={strutLinkHref} />
    </div>
  );
}
