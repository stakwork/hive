import { authOptions } from "@/lib/auth/nextauth";
import { getServerSession } from "next-auth/next";
import { redirect, notFound } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { LogDetailContent } from "@/components/agent-logs/LogDetailContent";
import { getBaseUrl } from "@/lib/utils";
import {
  chatMessagesToParsedMessages,
  type StoredChatMessage,
} from "@/lib/utils/chat-conversation-log";
import { parseAgentLogStats } from "@/lib/utils/agent-log-stats";
import type { ConversationDetail } from "@/types/shared-conversation";

// Minimal shape of an AI SDK `ModelMessage` as persisted in
// `settings.promptPrefix`. We only read enough to render it; the full
// type lives in the `ai` package (server-only) and we avoid importing
// it into this page.
interface PrefixMessage {
  role?: string;
  content?: unknown;
}

/**
 * Pull the system-prompt text out of a cached prefix for a friendlier
 * top-of-panel display. The system message's `content` is a plain
 * string in our prefix builders; fall back to null otherwise.
 */
function extractSystemText(prefix: PrefixMessage[]): string | null {
  const sys = prefix.find((m) => m?.role === "system");
  return typeof sys?.content === "string" ? sys.content : null;
}

interface ChatDetailPageProps {
  params: Promise<{
    slug: string;
    conversationId: string;
  }>;
  searchParams: Promise<{ from?: string }>;
}

export default async function ChatDetailPage({ params, searchParams }: ChatDetailPageProps) {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    redirect("/auth/signin");
  }

  const userId = (session.user as { id?: string }).id;
  if (!userId) {
    redirect("/auth/signin");
  }

  const { slug, conversationId } = await params;
  const { from } = await searchParams;
  // Return to whichever tab the user came from (Canvas chats link here
  // with `?from=canvas`; everything else defaults back to Chats).
  const backTab = from === "canvas" ? "canvas" : "chats";

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

  // Reuse the Agent Logs detail renderer (`LogDetailContent`) so chat
  // sessions show the SAME rich tool-call view (call args + paired
  // result + stats bar) as external agent runs. The chat messages
  // already persist every tool call's input and output — we just
  // reshape them into the `ParsedMessage[]` blob format, then run the
  // shared parser to derive the stats bar.
  const stored = ((data.messages as unknown[]) || []) as StoredChatMessage[];
  const parsedMessages = chatMessagesToParsedMessages(stored);
  const rawContent = JSON.stringify(parsedMessages);
  const { conversation, stats } = parseAgentLogStats(rawContent);

  // Cached agent prompt prefix (system prompt + pre-seeded `list_concepts`
  // results) — the exact context the model received ahead of the visible
  // conversation. Written server-side by `/api/ask/quick`; surfaced here
  // read-only (it never appears in the live chat). See
  // `ConversationSettings.promptPrefix`.
  const promptPrefix = (data.settings?.promptPrefix as PrefixMessage[]) ?? null;
  const promptSystemText = promptPrefix
    ? extractSystemText(promptPrefix)
    : null;

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-6 py-6">
        <Link
          href={`/w/${slug}/agent-logs?tab=${backTab}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="h-4 w-4" />
          Back to Agent Logs
        </Link>

        {data.title && (
          <h1 className="text-xl font-semibold mt-4">{data.title}</h1>
        )}

        {promptPrefix && promptPrefix.length > 0 && (
          <details className="mt-4 rounded-lg border border-border bg-muted/30">
            <summary className="cursor-pointer select-none px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground">
              Agent prompt context ({promptPrefix.length} messages) — cached
              prefix sent to the model each turn
            </summary>
            <div className="space-y-4 border-t border-border px-4 py-4">
              {promptSystemText && (
                <div>
                  <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    System prompt
                  </div>
                  <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-background p-3 text-xs leading-relaxed">
                    {promptSystemText}
                  </pre>
                </div>
              )}
              <div>
                <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Full prefix (incl. seeded concepts)
                </div>
                <pre className="max-h-96 overflow-auto whitespace-pre-wrap rounded bg-background p-3 text-xs leading-relaxed">
                  {JSON.stringify(promptPrefix, null, 2)}
                </pre>
              </div>
            </div>
          </details>
        )}
      </div>

      <div className="max-w-4xl mx-auto px-6 pb-8">
        {conversation.length === 0 ? (
          <div className="text-center text-muted-foreground py-8">
            No messages in this conversation.
          </div>
        ) : (
          <LogDetailContent
            conversation={conversation}
            stats={stats}
            rawContent={rawContent}
            loading={false}
            error={null}
            variant="page"
          />
        )}
      </div>
    </div>
  );
}
