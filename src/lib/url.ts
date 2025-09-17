import type { NextRequest } from "next/server";

export function getPublicBaseUrl(req?: NextRequest): string {
  const explicitBase = process.env.NEXT_PUBLIC_APP_URL;
  if (explicitBase) return explicitBase.replace(/\/$/, "");

  const vercel = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null;
  if (vercel) return vercel.replace(/\/$/, "");

  const host = req?.headers.get("x-forwarded-host") || req?.headers.get("host") || "localhost:3000";
  const proto = req?.headers.get("x-forwarded-proto") || (host.includes("localhost") ? "http" : "https");
  return `${proto}://${host}`.replace(/\/$/, "");
}

export function getGithubWebhookCallbackUrl(req?: NextRequest): string {
  const full = process.env.GITHUB_WEBHOOK_URL;
  if (full) return full;
  const base = getPublicBaseUrl(req);
  const path = "/api/github/webhook";
  return `${base}${path}`;
}

export function getStakgraphWebhookCallbackUrl(req?: NextRequest): string {
  const full = process.env.STAKGRAPH_WEBHOOK_URL;
  if (full) return full;
  const base = getPublicBaseUrl(req);
  const path = "/api/swarm/stakgraph/webhook";
  return `${base}${path}`;
}
