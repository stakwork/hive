"use client";

import React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import SwarmPasswordUpdateForm from "@/app/admin/components/SwarmPasswordUpdateForm";

interface WorkspaceSwarmPasswordFormProps {
  workspaceId: string;
  hasPassword: boolean;
}

export default function WorkspaceSwarmPasswordForm({
  workspaceId,
  hasPassword,
}: WorkspaceSwarmPasswordFormProps) {
  const router = useRouter();

  return (
    <SwarmPasswordUpdateForm
      workspaceId={workspaceId}
      hasPassword={hasPassword}
      onSuccess={() => {
        toast.success("Swarm password updated");
        router.refresh();
      }}
    />
  );
}
