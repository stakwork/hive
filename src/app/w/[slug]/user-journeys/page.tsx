"use client";

import { useWorkspace } from "@/hooks/useWorkspace";
import { redirect, useRouter } from "next/navigation";
import { useEffect } from "react";

export default function UserJourneysPage() {
  const router = useRouter();
  const { workspace } = useWorkspace();

  useEffect(() => {
    if (workspace?.slug) {
      router.replace(`/w/${workspace.slug}/testing`);
    }
  }, [workspace?.slug, router]);

  // Fallback redirect if workspace is not loaded yet
  redirect("/");
}
