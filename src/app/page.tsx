import { authOptions } from "@/lib/auth/nextauth";
import { handleWorkspaceRedirect } from "@/lib/auth/workspace-resolver";
import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";

export default async function HomePage() {
  const session = await getServerSession(authOptions);


  if (session?.user) {
    await handleWorkspaceRedirect(session);
    return null;
  } else {
    redirect("/onboarding/workspace");
  }
}
