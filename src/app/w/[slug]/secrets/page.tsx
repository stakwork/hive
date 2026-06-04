"use client";

import { PageHeader } from "@/components/ui/page-header";
import { SecretsPanel } from "@/components/secrets/SecretsPanel";
import { KeyRound } from "lucide-react";

export default function SecretsPage() {
  return (
    <div className="flex flex-col h-full">
      <PageHeader
        title="Secrets"
        icon={KeyRound}
        description="Manage customer-scoped secrets for use in workflows"
      />
      <SecretsPanel />
    </div>
  );
}
