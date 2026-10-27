"use client";

import React, { use, useCallback, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { AppWindow, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/ui/page-header";
import { StrutAppFrame } from "@/components/strut-app-frame";
import { useWorkspace } from "@/hooks/useWorkspace";
import { useWorkspaceStrutApps } from "@/hooks/useWorkspaceStrutApps";
import { isStrutAppName, strutAppInputOf, workspaceAppPath } from "@/lib/strut-apps";
import { workspaceStrutViewPath } from "@/lib/utils/strut-links";

/** The app's name from the route's segments (`acme/invoices` is two), or null when it is no app name. */
function appNameOf(segments: string[]): string | null {
  try {
    const name = segments.map((s) => decodeURIComponent(s)).join("/");
    return isStrutAppName(name) ? name : null;
  } catch {
    return null;
  }
}

/**
 * A strut app the workspace's swarm has pinned as a tab (the sidebar's
 * link), framed at its active version from that swarm. `?input=` is what it
 * is opened with — a deep link's, the app's own query (strut plans/apps.md
 * §7.1) — handed to the page as its tool input. The page holds no
 * conversation, so a `ui/message` from the app is shown as unavailable; a
 * link to a pinned app (this one too) opens its page here, and any other
 * strut deep link the workspace's strut view.
 */
export default function WorkspaceAppPage({ params }: { params: Promise<{ name: string[] }> }) {
  const { name: segments } = use(params);
  const name = appNameOf(segments);
  const { workspace } = useWorkspace();
  const slug = workspace?.slug;
  const { data, loading, error } = useWorkspaceStrutApps(slug);
  const input = useSearchParams().get("input");
  const toolInput = useMemo(() => strutAppInputOf(input), [input]);
  const strutLinkHref = useCallback((deepLink: string) => (slug ? workspaceStrutViewPath(slug, deepLink) : null), [slug]);
  const appLinkHref = useCallback(
    (target: string, targetInput?: string) => (slug && data?.apps.some((a) => a.name === target) ? workspaceAppPath(slug, target, targetInput) : null),
    [slug, data],
  );

  const app = name ? data?.apps.find((a) => a.name === name) : undefined;
  let body: React.ReactNode;
  if (loading || !workspace) {
    body = (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-label="Loading app" />
      </div>
    );
  } else if (error) {
    body = <p className="m-4 text-sm text-destructive">{error}</p>;
  } else if (!app || !data?.githubLogin || !data.swarmId) {
    body = <p className="m-4 text-sm text-muted-foreground">No app {name ? `"${name}" ` : ""}is pinned in this workspace.</p>;
  } else {
    body = (
      <div className="flex-1 min-h-0 m-4 overflow-hidden rounded-md border">
        <StrutAppFrame
          source={{ githubLogin: data.githubLogin, swarmId: data.swarmId, app: app.name }}
          title={app.title}
          strutLinkHref={strutLinkHref}
          appLinkHref={appLinkHref}
          {...(toolInput ? { toolInput } : {})}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <PageHeader icon={AppWindow} title={app?.title ?? name ?? "App"} />
      {body}
    </div>
  );
}
