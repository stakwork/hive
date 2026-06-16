"use client";

/**
 * On canvas load, checks whether a recurring automation produced a new
 * conversation the user hasn't seen yet (`GET .../automations/inbox`). If so,
 * it loads that conversation into the chat store and makes it active — so the
 * scheduled run "opens automatically" the next time the user visits the
 * canvas. Reading the inbox marks those runs seen server-side, so it fires
 * at most once per unseen run.
 *
 * Skipped when the page was opened via a `?chat=<shareId>` deep link, so an
 * explicit shared-conversation link always wins over an automation pop-in.
 */

import { useEffect, useRef } from "react";
import {
  useCanvasChatStore,
  type CanvasChatMessage,
} from "./canvasChatStore";

async function openServerConversation(
  githubLogin: string,
  conversationId: string,
): Promise<void> {
  const res = await fetch(
    `/api/orgs/${githubLogin}/chat/conversations/${conversationId}`,
  );
  if (!res.ok) return;
  const conv = await res.json();

  const rawMessages: unknown[] = Array.isArray(conv.messages)
    ? conv.messages
    : [];
  const messages: CanvasChatMessage[] = rawMessages
    .filter(
      (m): m is Record<string, unknown> =>
        !!m &&
        typeof m === "object" &&
        ((m as { role?: string }).role === "user" ||
          (m as { role?: string }).role === "assistant"),
    )
    .map((m, idx) => ({
      id: (m.id as string) || `automation-${idx}`,
      role: m.role as "user" | "assistant",
      content: typeof m.content === "string" ? m.content : "",
      timestamp: m.timestamp ? new Date(m.timestamp as string) : new Date(),
      toolCalls: m.toolCalls as CanvasChatMessage["toolCalls"],
      timeline: m.timeline as CanvasChatMessage["timeline"],
      artifactIds: m.artifactIds as string[] | undefined,
      attachments: m.attachments as CanvasChatMessage["attachments"],
      approval: m.approval as CanvasChatMessage["approval"],
      rejection: m.rejection as CanvasChatMessage["rejection"],
      approvalResult: m.approvalResult as CanvasChatMessage["approvalResult"],
      deferredCheck: m.deferredCheck as CanvasChatMessage["deferredCheck"],
      source: m.source as CanvasChatMessage["source"],
    }));

  const store = useCanvasChatStore.getState();
  const activeId = store.activeConversationId;
  const context = activeId
    ? store.conversations[activeId]?.context
    : undefined;

  const resolvedContext: Parameters<typeof store.startConversation>[0] =
    context ?? {
      orgId: "",
      githubLogin,
      workspaceSlug: null,
      workspaceSlugs: conv.settings?.extraWorkspaceSlugs ?? [],
      currentCanvasRef: "",
      currentCanvasBreadcrumb: "",
      selectedNodeId: null,
      selectedNodeIds: [],
    };

  const newId = store.startConversation(
    resolvedContext,
    messages,
    undefined,
    messages.length, // already-persisted — don't re-save
  );
  store.setServerConversationId(newId, conversationId);
}

export function useAutomationInbox(githubLogin: string): void {
  const ranRef = useRef(false);

  useEffect(() => {
    if (!githubLogin || ranRef.current) return;
    // A shared-conversation deep link takes precedence over auto-open.
    if (
      typeof window !== "undefined" &&
      new URLSearchParams(window.location.search).has("chat")
    ) {
      return;
    }
    ranRef.current = true;

    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/orgs/${githubLogin}/automations/inbox`);
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled || !data?.conversationId) return;
        await openServerConversation(githubLogin, data.conversationId);
      } catch {
        /* best-effort; auto-open is non-critical */
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [githubLogin]);
}
