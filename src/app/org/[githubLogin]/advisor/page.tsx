import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { resolveAdvisorUrl } from "@/lib/helpers/advisor-url";

export const dynamic = "force-dynamic";

interface AdvisorPageProps {
  params: Promise<{ githubLogin: string }>;
}

/** Hands off to the org's Advisor (top-level, no iframe). */
export default async function AdvisorPage({ params }: AdvisorPageProps) {
  const { githubLogin } = await params;
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;

  const result = userId
    ? await resolveAdvisorUrl(githubLogin, userId)
    : ({ ok: false, reason: "no_access" } as const);

  if (result.ok) redirect(result.url);

  const [title, body] =
    result.reason === "no_access"
      ? ["You don't have access to the Advisor", "Only Owners and Admins of this org's default workspace can open it."]
      : ["The Advisor isn't configured for this org.", null];

  return (
    <div className="flex h-full min-h-screen items-center justify-center p-6 text-center">
      <div>
        <h1 className="text-lg font-semibold">{title}</h1>
        {body && <p className="mt-1 text-sm text-muted-foreground">{body}</p>}
      </div>
    </div>
  );
}
