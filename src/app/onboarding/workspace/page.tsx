import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth/nextauth";
import { redirect } from "next/navigation";
import {
  getUserWorkspaces,
  getDefaultWorkspaceForUser,
} from "@/services/workspace";
import { OnboardingWorkspaceClient } from "@/app/onboarding/workspace/client";
import { WorkspaceWithRole } from "@/types";

export default async function OnboardingWorkspacePage() {
  const session = await getServerSession(authOptions);

  if (!session) {
    redirect("/auth/signin");
  }

  const userId = (session.user as { id: string }).id;

  // Use let so we can assign the workspaces inside the try block
  let userWorkspaces: WorkspaceWithRole[] = [];
  let defaultWorkspace = null;

  // 1. Fetch data and handle potential errors
  try {
    userWorkspaces = await getUserWorkspaces(userId);
    if (userWorkspaces.length > 0) {
      defaultWorkspace = await getDefaultWorkspaceForUser(userId);
    }
  } catch (error) {
    // Log only real data-fetching errors
    console.error("Error fetching user workspace data:", error);
    // Continue to show the form if data fetching fails
  }

  // 2. Perform redirection logic outside the try...catch
  if (userWorkspaces.length > 0) {
    if (defaultWorkspace) {
      redirect(`/w/${defaultWorkspace.slug}`);
    } else {
      // Fallback to the first workspace in the list
      redirect(`/w/${userWorkspaces[0].slug}`);
    }
  }

  // 3. If no redirect happens, render the component
  const user = {
    name: session.user?.name,
    email: session.user?.email,
    image: session.user?.image,
    id: userId,
    github: (
      session.user as {
        github?: {
          username?: string;
          publicRepos?: number;
          followers?: number;
        };
      }
    )?.github,
  };

  return <OnboardingWorkspaceClient user={user} />;
}
