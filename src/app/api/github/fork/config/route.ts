import { optionalEnvVars } from "@/config/env";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

/**
 * Public endpoint that exposes the first configured fork repo URL to the client.
 * Keeps the env var server-side; never leaks other config values.
 */
export async function GET() {
  const repos = optionalEnvVars.ONBOARDING_FORK_REPOS;
  const first = repos
    ? repos
        .split(",")
        .map((r) => r.trim())
        .filter(Boolean)[0] ?? null
    : null;

  return NextResponse.json({ repoUrl: first });
}
