import { authOptions } from "@/lib/auth/nextauth";
import { handleWorkspaceRedirect } from "@/lib/auth/workspace-resolver";
import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import LandingPage from "@/components/LandingPage";
import { isLandingPageEnabled } from "@/lib/auth/landing-cookie";
import { headers } from "next/headers";

export default async function HomePage() {
  const hdrs = await headers();
  const isPrefetch =
    hdrs.get("next-router-prefetch") === "1" ||
    hdrs.get("purpose") === "prefetch";
  const currentPath = hdrs.get("next-url") || "/";

  // Skip redirect logic for prefetch/flight requests and when already on mock workspace
  if (isPrefetch || currentPath.startsWith("/w/mock-stakgraph")) {
    return null;
  }

  const session = await getServerSession(authOptions);

  // If landing page is enabled and user has no session, show password gate
  if (isLandingPageEnabled() && !session?.user) {
    return <LandingPage />;
  }

  // Normal flow: user has session or landing page is off
  if (session?.user) {
    await handleWorkspaceRedirect(session);
    return null;
  } else {
    if (process.env.POD_URL) {
      redirect("/auth/signin");
    }
    redirect("/onboarding/workspace");
  }
}
