import { getServerSession } from "next-auth/next";
import { notFound, redirect } from "next/navigation";
import { authOptions } from "@/lib/auth/nextauth";
import { isStrutAppName, isStrutAppVersion } from "@/lib/strut-apps";
import { validateUserBelongsToOrg } from "@/services/workspace";
import { StandaloneApp } from "./StandaloneApp";

/**
 * A strut app on its own full-viewport page — no org rail, no conversation —
 * opened from the app panel's "Open in new window". Sits outside `/org/…`
 * (whose layout wraps every page in the rail) and checks the same things:
 * a session, and membership of the org. The document and relay routes check
 * the swarm again on every request.
 */
export default async function StandaloneAppPage({
  params,
  searchParams,
}: {
  params: Promise<{ githubLogin: string }>;
  searchParams: Promise<{ swarmId?: string; app?: string; version?: string; input?: string }>;
}) {
  const session = await getServerSession(authOptions);
  if (!session?.user) redirect("/auth/signin");

  const { githubLogin } = await params;
  const { swarmId, app, version, input } = await searchParams;
  if (!swarmId || !isStrutAppName(app) || (version && !isStrutAppVersion(version))) notFound();
  if (!(await validateUserBelongsToOrg(githubLogin, session.user.id))) notFound();

  return <StandaloneApp githubLogin={githubLogin} swarmId={swarmId} app={app} version={version} input={input} />;
}
