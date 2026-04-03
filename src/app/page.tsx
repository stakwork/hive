import LandingPage from "@/components/LandingPage";
import {
  isLandingPageEnabled,
  LANDING_COOKIE_NAME,
  verifyCookie,
} from "@/lib/auth/landing-cookie";
import { authOptions } from "@/lib/auth/nextauth";
import { handleWorkspaceRedirect } from "@/lib/auth/workspace-resolver";
import { getServerSession } from "next-auth/next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

export default async function HomePage() {
  const session = await getServerSession(authOptions);

  if (session?.user) {
    await handleWorkspaceRedirect(session);
    return null;
  }

  if (isLandingPageEnabled()) {
    const cookieStore = await cookies();
    const landingCookie = cookieStore.get(LANDING_COOKIE_NAME);
    const hasValidCookie = landingCookie && (await verifyCookie(landingCookie.value));
    if (hasValidCookie) {
      redirect("/onboarding/workspace");
    }
    return <LandingPage />;
  }

  // Landing page disabled
  if (process.env.POD_URL) {
    redirect("/auth/signin");
  }
  redirect("/onboarding/workspace");
}
