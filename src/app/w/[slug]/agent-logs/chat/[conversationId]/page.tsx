import { authOptions } from "@/lib/auth/nextauth";
import { getServerSession } from "next-auth/next";
import { redirect, notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { ChatMessage } from "@/components/dashboard/DashboardChat/ChatMessage";
import { ToolCallIndicator } from "@/components/dashboard/DashboardChat/ToolCallIndicator";
import { getBaseUrl } from "@/lib/utils";
import type { ConversationDetail } from "@/types/shared-conversation";

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
  imageData?: string;
  toolCalls?: Array<{
    id: string;
    toolName: string;
    input?: unknown;
    status: string;
    output?: unknown;
    errorText?: string;
  }>;
}

interface ChatDetailPageProps {
  params: Promise<{
    slug: string;
    conversationId: string;
  }>;
}

export default async function ChatDetailPage({ params }: ChatDetailPageProps) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/auth/signin");
  }

  const userId = (session.user as { id?: string }).id;
  if (!userId) {
    redirect("/auth/signin");
  }

  const { slug, conversationId } = await params;

  const headerList = await headers();
  const cookie = headerList.get("cookie") ?? "";
  const baseUrl = getBaseUrl(headerList.get("host"));

  const res = await fetch(
    `${baseUrl}/api/workspaces/${slug}/chat/conversations/${conversationId}`,
    {
      headers: { cookie },
      cache: "no-store",
    }
  );

  if (res.status === 404) {
    notFound();
  }

  if (res.status === 403) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="max-w-md w-full bg-background border border-border rounded-lg p-8 text-center">
          <h1 className="text-2xl font-bold mb-4">Access Denied</h1>
          <p className="text-muted-foreground mb-4">
            You do not have access to this workspace.
          </p>
          <p className="text-sm text-muted-foreground">
            Please request access from a workspace administrator.
          </p>
        </div>
      </div>
    );
  }

  if (!res.ok) {
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="max-w-md w-full bg-background border border-border rounded-lg p-8 text-center">
          <h1 className="text-2xl font-bold mb-4">Error</h1>
          <p className="text-muted-foreground">
            Failed to load conversation. Please try again later.
          </p>
        </div>
      </div>
    );
  }

  const data = (await res.json()) as ConversationDetail;

  const messages: Message[] = ((data.messages as unknown[]) || []).map(
    (msg) => {
      const m = msg as Message;
      return { ...m, timestamp: new Date(m.timestamp) };
    }
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-6 py-6">
        <Link
          href={`/w/${slug}/agent-logs?tab=chats`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to Agent Logs
        </Link>

        {data.title && (
          <h1 className="text-xl font-semibold mt-4">{data.title}</h1>
        )}
      </div>

      <div className="max-w-4xl mx-auto px-6 pb-8">
        <div className="space-y-4">
          {messages.map((message) => {
            if (
              message.toolCalls &&
              message.toolCalls.length > 0 &&
              !message.content
            ) {
              return (
                <div key={message.id}>
                  <ToolCallIndicator toolCalls={message.toolCalls} />
                </div>
              );
            }

            if (message.content) {
              return (
                <ChatMessage
                  key={message.id}
                  message={message}
                  isStreaming={false}
                />
              );
            }

            return null;
          })}

          {messages.length === 0 && (
            <div className="text-center text-muted-foreground py-8">
              No messages in this conversation.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
