import { redirect } from "next/navigation";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { mintGatewayTicket } from "@/lib/helpers/gateway-ticket";

export const dynamic = "force-dynamic";

interface GatewayPageProps {
  params: Promise<{ githubLogin: string }>;
}

/** Mints a ticket and hands off to the gateway's own UI (top-level, no iframe). */
export default async function GatewayPage({ params }: GatewayPageProps) {
  const { githubLogin } = await params;
  const session = await getServerSession(authOptions);
  const userId = (session?.user as { id?: string } | undefined)?.id;

  const result = userId
    ? await mintGatewayTicket(githubLogin, userId)
    : ({ ok: false, error: "Not signed in", status: 401 } as const);

  if (result.ok) {
    redirect(`${result.url.replace(/\/$/, "")}/_plugin/ui/?ticket=${encodeURIComponent(result.ticket)}`);
  }

  return (
    <div className="flex h-full min-h-screen items-center justify-center p-6 text-center">
      <div>
        <h1 className="text-lg font-semibold">Gateway unavailable</h1>
        <p className="mt-1 text-sm text-muted-foreground">{result.error}</p>
      </div>
    </div>
  );
}
