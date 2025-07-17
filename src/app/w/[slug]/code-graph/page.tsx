"use client";

import { useSession } from "next-auth/react";
import { CodeGraphWizard } from "@/components/CodeGraphWizard";

export default function CodeGraphPage() {
  const { data: session } = useSession();
  const user = {
    name: session?.user?.name,
    email: session?.user?.email,
    image: session?.user?.image,
    github: (session?.user as { github?: { username?: string; publicRepos?: number; followers?: number } })?.github,
  };
  return <CodeGraphWizard user={user} />;
} 