"use client";

import React from "react";
import { Globe, LogIn } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { useWorkspace } from "@/hooks/useWorkspace";

export function PublicWorkspaceBanner() {
  const { status } = useSession();
  const { loading } = useWorkspace();

  if (status === "loading" || loading || status !== "unauthenticated") return null;

  return (
    <Alert className="rounded-none border-x-0 border-t-0 bg-blue-50 dark:bg-blue-950/20 border-blue-200 dark:border-blue-800">
      <Globe className="h-4 w-4 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
      <AlertDescription className="flex items-center justify-between w-full">
        <span className="text-blue-800 dark:text-blue-300">
          You&apos;re browsing in view-only mode. Sign in to request developer access.
        </span>
        <Button
          variant="outline"
          size="sm"
          asChild
          className="ml-4 border-blue-400 dark:border-blue-700 text-blue-800 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40"
        >
          <Link href="/auth/signin">
            <LogIn className="h-3.5 w-3.5 mr-1.5" />
            Sign In
          </Link>
        </Button>
      </AlertDescription>
    </Alert>
  );
}
