"use client";

import React, { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

interface AdvisorViewProps {
  /**
   * The server-side embed-url route to POST to, e.g.
   * `/api/orgs/${encodeURIComponent(login)}/advisor/embed-url`.
   * Must start with `/api/` and must NOT start with `//` (protocol-relative).
   */
  embedUrlEndpoint: string;
}

type AdvisorReason = "no_access" | "not_configured" | null;

interface EmbedUrlResponse {
  url?: string;
  error?: string;
  reason?: AdvisorReason;
}

/** Rejects anything that isn't a same-origin, absolute-path API route. */
function isValidEmbedUrlEndpoint(endpoint: string): boolean {
  return endpoint.startsWith("/api/") && !endpoint.startsWith("//");
}

async function fetchAdvisorEmbedUrl(endpoint: string): Promise<EmbedUrlResponse> {
  if (!isValidEmbedUrlEndpoint(endpoint)) {
    throw new Error("Invalid advisor embed endpoint");
  }
  const resp = await fetch(endpoint, { method: "POST" });
  const body = (await resp.json().catch(() => null)) as EmbedUrlResponse | null;
  if (!resp.ok) {
    return { error: body?.error || `HTTP ${resp.status}`, reason: body?.reason ?? null };
  }
  if (!body?.url) throw new Error("No Advisor URL returned");
  return body;
}

const VPN_NOTICE =
  "The Advisor is only reachable on the VPN. Sign in with this swarm's advisor token (ask your infra admin). If the page stays blank, check your VPN or ask whether the advisor is deployed for this swarm.";

/**
 * Full-page iframe host for a swarm's AWS Advisor. Hive never stores,
 * signs or passes any advisor credential — the user signs in inside the
 * advisor itself with its own token.
 */
export function AdvisorView({ embedUrlEndpoint }: AdvisorViewProps) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState<AdvisorReason>(null);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setError(null);
    setReason(null);

    fetchAdvisorEmbedUrl(embedUrlEndpoint)
      .then((body) => {
        if (cancelled) return;
        if (body.url) {
          setUrl(body.url);
        } else {
          setError(body.error || "Advisor unavailable");
          setReason(body.reason ?? null);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });

    return () => {
      cancelled = true;
    };
  }, [embedUrlEndpoint]);

  let body: React.ReactNode;
  if (error) {
    let heading = "Advisor unavailable";
    let detail: string = error;
    if (reason === "no_access") {
      heading = "You don't have access to the Advisor";
      detail = "Only Owners and Admins of this org's default workspace can open it.";
    } else if (reason === "not_configured") {
      heading = "The Advisor isn't configured for this org.";
      detail = "";
    }
    body = (
      <div className="flex-1 min-h-0 w-full flex items-center justify-center p-6">
        <div className="text-center max-w-md space-y-1">
          <p className="font-medium">{heading}</p>
          {detail && <p className="text-sm text-muted-foreground">{detail}</p>}
        </div>
      </div>
    );
  } else if (!url) {
    body = (
      <div className="flex-1 min-h-0 w-full flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  } else {
    body = (
      <iframe
        src={url}
        title="AWS Advisor"
        className="flex-1 min-h-0 w-full border-0"
        allow="clipboard-write"
        referrerPolicy="no-referrer"
        sandbox="allow-same-origin allow-scripts allow-forms allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads"
      />
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="shrink-0 px-3 py-2 text-xs text-muted-foreground border-b bg-muted/40">
        {VPN_NOTICE}
      </div>
      {body}
    </div>
  );
}
