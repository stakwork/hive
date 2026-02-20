"use client";

import { useParams } from "next/navigation";
import { LogsChat } from "@/components/logs-chat";

export default function LogsChatPage() {
  const params = useParams();
  const slug = params.slug as string;

  return (
    <div className="h-[calc(100vh-theme(spacing.20))] max-h-full">
      <LogsChat workspaceSlug={slug} />
    </div>
  );
}
