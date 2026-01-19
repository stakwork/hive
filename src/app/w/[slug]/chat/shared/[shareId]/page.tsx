import { authOptions } from "@/lib/auth/nextauth";
import { getServerSession } from "next-auth/next";
import { redirect, notFound } from "next/navigation";
import { ChatMessage } from "@/components/dashboard/DashboardChat/ChatMessage";
import { ToolCallIndicator } from "@/components/dashboard/DashboardChat/ToolCallIndicator";

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

interface SharedConversationPageProps {
  params: Promise<{
    slug: string;
    shareId: string;
  }>;
}

async function getSharedConversation(slug: string, shareId: string, sessionToken?: string) {
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  
  const headers: HeadersInit = {
    "Content-Type": "application/json",
  };
  
  if (sessionToken) {
    headers["Cookie"] = `next-auth.session-token=${sessionToken}`;
  }

  const response = await fetch(
    `${baseUrl}/api/workspaces/${slug}/chat/shared/${shareId}`,
    {
      headers,
      cache: "no-store",
    }
  );

  return response;
}

export default async function SharedConversationPage({ params }: SharedConversationPageProps) {
  const session = await getServerSession(authOptions);
  
  // Require authentication
  if (!session?.user) {
    redirect("/auth/signin");
  }

  const { slug, shareId } = await params;

  try {
    // Fetch shared conversation from API
    const response = await getSharedConversation(slug, shareId);

    if (response.status === 404) {
      notFound();
    }

    if (response.status === 403) {
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

    if (!response.ok) {
      throw new Error("Failed to load shared conversation");
    }

    const data = await response.json();

    // Parse messages from JSON
    const messages: Message[] = (data.messages as any[]).map((msg: any) => ({
      ...msg,
      timestamp: new Date(msg.timestamp),
    }));

    const creatorName = data.createdBy?.name || data.createdBy?.email || "Unknown";
    const createdDate = new Date(data.createdAt).toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });

    return (
      <div className="min-h-screen bg-background">
        {/* Banner */}
        <div className="bg-muted/30 border-b border-border">
          <div className="max-w-4xl mx-auto px-6 py-4">
            <h1 className="text-xl font-semibold mb-1">Shared Conversation (Read-only)</h1>
            <p className="text-sm text-muted-foreground">
              Shared by {creatorName} on {createdDate}
            </p>
          </div>
        </div>

        {/* Messages */}
        <div className="max-w-4xl mx-auto px-6 py-8">
          <div className="space-y-4">
            {messages.map((message) => {
              // Render tool calls separately if they exist
              if (message.toolCalls && message.toolCalls.length > 0 && !message.content) {
                return (
                  <div key={message.id}>
                    <ToolCallIndicator toolCalls={message.toolCalls} />
                  </div>
                );
              }

              // Render regular message
              if (message.content) {
                return <ChatMessage key={message.id} message={message} isStreaming={false} />;
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
  } catch (error) {
    console.error("Error loading shared conversation:", error);
    return (
      <div className="flex items-center justify-center min-h-screen p-4">
        <div className="max-w-md w-full bg-background border border-border rounded-lg p-8 text-center">
          <h1 className="text-2xl font-bold mb-4">Error</h1>
          <p className="text-muted-foreground">
            Failed to load shared conversation. Please try again later.
          </p>
        </div>
      </div>
    );
  }
}
