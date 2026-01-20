import { authOptions } from "@/lib/auth/nextauth";
import { getServerSession } from "next-auth/next";
import { redirect, notFound } from "next/navigation";
import { ChatMessage } from "@/components/dashboard/DashboardChat/ChatMessage";
import { ToolCallIndicator } from "@/components/dashboard/DashboardChat/ToolCallIndicator";
import { db } from "@/lib/db";
import { SharedConversationData } from "@/types/shared-conversation";

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

async function getSharedConversation(
  slug: string, 
  shareId: string, 
  userId: string
): Promise<{ data?: SharedConversationData; error?: string; status: number }> {
  try {
    // Find workspace
    const workspace = await db.workspace.findFirst({
      where: {
        slug,
        deleted: false,
      },
      select: {
        id: true,
        ownerId: true,
      },
    });

    if (!workspace) {
      return { error: "Workspace not found", status: 404 };
    }

    // Check if user is a workspace member (owner or explicit member)
    const isOwner = workspace.ownerId === userId;
    const isMember = isOwner || await db.workspaceMember.findFirst({
      where: {
        workspaceId: workspace.id,
        userId,
        leftAt: null,
      },
    });

    if (!isMember) {
      return { 
        error: "Access denied. You must be a workspace member to view shared conversations.", 
        status: 403 
      };
    }

    // Fetch the shared conversation
    const sharedConversation = await db.sharedConversation.findUnique({
      where: {
        id: shareId,
      },
      select: {
        id: true,
        workspaceId: true,
        userId: true,
        title: true,
        messages: true,
        provenanceData: true,
        followUpQuestions: true,
        createdAt: true,
        updatedAt: true,
        user: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!sharedConversation) {
      return { error: "Shared conversation not found", status: 404 };
    }

    // Verify the shared conversation belongs to the workspace
    if (sharedConversation.workspaceId !== workspace.id) {
      return { error: "Shared conversation not found", status: 404 };
    }

    // Return the conversation data
    const data: SharedConversationData = {
      id: sharedConversation.id,
      workspaceId: sharedConversation.workspaceId,
      userId: sharedConversation.userId,
      title: sharedConversation.title,
      messages: sharedConversation.messages,
      provenanceData: sharedConversation.provenanceData,
      followUpQuestions: sharedConversation.followUpQuestions,
      createdAt: sharedConversation.createdAt.toISOString(),
      updatedAt: sharedConversation.updatedAt.toISOString(),
      createdBy: {
        id: sharedConversation.user.id,
        name: sharedConversation.user.name,
        email: sharedConversation.user.email,
      },
    };

    return { data, status: 200 };
  } catch (error) {
    console.error("Failed to fetch shared conversation:", error);
    return { error: "Failed to fetch shared conversation", status: 500 };
  }
}

export default async function SharedConversationPage({ params }: SharedConversationPageProps) {
  const session = await getServerSession(authOptions);
  
  // Require authentication
  if (!session?.user) {
    redirect("/auth/signin");
  }

  const userId = (session.user as { id?: string }).id;
  if (!userId) {
    redirect("/auth/signin");
  }

  const { slug, shareId } = await params;

  try {
    // Fetch shared conversation directly from database
    const result = await getSharedConversation(slug, shareId, userId);

    if (result.status === 404) {
      notFound();
    }

    if (result.status === 403) {
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

    if (!result.data) {
      throw new Error(result.error || "Failed to load shared conversation");
    }

    const data = result.data;

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
