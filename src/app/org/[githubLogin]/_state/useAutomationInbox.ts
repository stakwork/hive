"use client";

/**
 * Provides the unseen automation run count and a list of runs waiting
 * to be opened. Replaces the old silent auto-open behaviour: runs are
 * now only marked seen when the user explicitly opens one via `openRun`.
 *
 * Keeps the count fresh without a Pusher event (automation dispatch
 * runs with `silentPusher: true`) by polling every 30 s and refetching
 * on window focus.
 */

import { useEffect, useRef, useState, useCallback } from "react";
import {
  useCanvasChatStore,
  type CanvasChatMessage,
} from "./canvasChatStore";

export interface InboxRun {
  automationId: string;
  automationName: string;
  conversationId: string;
  lastRunAt: string | null;
}

interface InboxState {
  count: number;
  runs: InboxRun[];
}

/**
 * Fetch the conversation from the server and load it into the chat
 * store. Returns `true` on success, `false` on any failure.
 */
async function openServerConversation(
  githubLogin: string,
  conversationId: string,
): Promise<boolean> {
  try {
    const res = await fetch(
      `/api/orgs/${githubLogin}/chat/conversations/${conversationId}`,
    );
    if (!res.ok) return false;
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
    return true;
  } catch {
    return false;
  }
}

export function useAutomationInbox(
  githubLogin: string,
  opts: { chatReady: boolean },
): { count: number; runs: InboxRun[]; openRun: (run: InboxRun) => Promise<void> } {
  const { chatReady } = opts;
  const [inbox, setInbox] = useState<InboxState>({ count: 0, runs: [] });
  const fetchingRef = useRef(false);

  const fetchInbox = useCallback(async () => {
    if (!githubLogin || fetchingRef.current) return;
    fetchingRef.current = true;
    try {
      const res = await fetch(`/api/orgs/${githubLogin}/automations/inbox`);
      if (!res.ok) return;
      const data: { count: number; runs: InboxRun[] } = await res.json();
      setInbox({ count: data.count ?? 0, runs: data.runs ?? [] });
    } catch {
      /* best-effort; badge staleness is non-critical */
    } finally {
      fetchingRef.current = false;
    }
  }, [githubLogin]);

  // Fetch on mount.
  useEffect(() => {
    if (!githubLogin) return;
    fetchInbox();
  }, [githubLogin, fetchInbox]);

  // Poll every 30 s (no Pusher event for automation dispatch).
  useEffect(() => {
    if (!githubLogin) return;
    const id = setInterval(fetchInbox, 30_000);
    return () => clearInterval(id);
  }, [githubLogin, fetchInbox]);

  // Refetch on window focus so a user returning to the tab sees fresh count.
  useEffect(() => {
    if (!githubLogin) return;
    const onFocus = () => fetchInbox();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [githubLogin, fetchInbox]);

  const openRun = useCallback(
    async (run: InboxRun) => {
      // Guard: don't touch the chat store before it has been initialised.
      if (!chatReady) return;

      // Step 1: load the conversation. If this fails, leave the run unseen.
      const opened = await openServerConversation(githubLogin, run.conversationId);
      if (!opened) return;

      // Step 2: mark seen on the server. If this fails, warn and bail —
      // the conversation is open but the badge will still show this run
      // so the user can try again (state-integrity gap visible in console).
      try {
        const seenRes = await fetch(
          `/api/orgs/${githubLogin}/automations/${run.automationId}/seen`,
          { method: "POST" },
        );
        if (!seenRes.ok) {
          console.warn(
            "[useAutomationInbox] openRun: conversation opened but POST .../seen failed " +
              `(automationId=${run.automationId}). ` +
              "Run will remain in unseen list until next successful mark-seen.",
            { status: seenRes.status },
          );
          return;
        }
      } catch (err) {
        console.warn(
          "[useAutomationInbox] openRun: conversation opened but POST .../seen threw " +
            `(automationId=${run.automationId}):`,
          err,
        );
        return;
      }

      // Step 3: both succeeded — remove from local state and decrement count.
      setInbox((prev) => {
        const runs = prev.runs.filter((r) => r.automationId !== run.automationId);
        return { count: runs.length, runs };
      });
    },
    [githubLogin, chatReady],
  );

  return { count: inbox.count, runs: inbox.runs, openRun };
}
