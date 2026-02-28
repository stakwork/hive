"use client";

import { useState } from "react";
import { Copy, Check } from "lucide-react";
import { Button } from "@/components/ui/button";

interface CopySwarmPasswordButtonProps {
  workspaceId: string;
  hasPassword: boolean;
}

export default function CopySwarmPasswordButton({
  workspaceId,
  hasPassword,
}: CopySwarmPasswordButtonProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      const response = await fetch(
        `/api/admin/workspaces/${workspaceId}/swarm-password`
      );
      const data = await response.json();

      if (data.password) {
        await navigator.clipboard.writeText(data.password);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch (error) {
      console.error("Failed to copy password:", error);
    }
  };

  if (!hasPassword) {
    return <Button disabled>No password set</Button>;
  }

  if (copied) {
    return (
      <Button>
        <Check className="w-4 h-4 mr-2" />
        Copied!
      </Button>
    );
  }

  return (
    <Button onClick={handleCopy}>
      <Copy className="w-4 h-4 mr-2" />
      Copy swarm password
    </Button>
  );
}
